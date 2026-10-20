// backend/services/fairPriceService.js
// AI-Powered Fair Price Engine for FundXProut Secondary Marketplace.
//
// Architecture:
//   1. HTTP GET /api/marketplace/campaigns/:id/fair-price  → getFairPrice()
//      Returns cached result if < 1h old, otherwise calls triggerFairPriceRecalculation().
//
//   2. triggerFairPriceRecalculation()
//      Called fire-and-forget from biddingController after:
//        a) placeBid()    — live bid market changed (debounced 10 s)
//        b) completeBid() — new settled trade (immediate, highest priority)
//        c) signListing() — ask price changed
//      Also triggered by Supabase realtime subscriptions below.
//
//   3. Two-tier valuation:
//      Tier 1 (≥3 settled trades in last 30 days) → VWAP of last 3 trades
//      Tier 2 (thin / no market)                  → Weighted heuristic formula
//      In both cases the full payload is sent to Gemini 1.5 Flash for
//      qualitative synthesis, verdict text, and recommended bid.
//
//   4. After calculation:
//      - Writes fair_price_* columns to campaigns table (1-hour cache)
//      - Emits fairPriceUpdated event over Socket.IO /marketplace namespace

'use strict';

const { supabaseAdmin } = require('../config/supabaseAdmin');
const axios = require('axios');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CACHE_TTL_MS   = 60 * 60 * 1000; // 1 hour
const DEBOUNCE_MS    = 10_000;          // 10 seconds between recalcs per campaign

// Map<campaignId, NodeJS.Timeout> — prevents hammering Gemini on rapid bids
const debounceTimers = new Map();

// ─── Supabase Realtime Listeners ────────────────────────────────────────────
// These fire on direct DB writes that bypass the API layer (e.g. admin updates).
// Call initRealtimeListeners() once from server.js startup.
let _realtimeInitialized = false;
function initRealtimeListeners() {
  if (_realtimeInitialized) return;
  _realtimeInitialized = true;

  supabaseAdmin
    .channel('fair_price_trade_listener')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'token_trades' }, (payload) => {
      const { campaign_id, price } = payload.new || {};
      if (campaign_id) {
        console.log(`[fairPrice] New trade for campaign ${campaign_id} at ${price} ETH — recalculating.`);
        triggerFairPriceRecalculation(campaign_id, price).catch(() => {});
      }
    })
    .subscribe();

  supabaseAdmin
    .channel('fair_price_bid_listener')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'token_bids' }, (payload) => {
      const { campaign_id } = payload.new || {};
      if (campaign_id) debouncedRecalc(campaign_id, null);
    })
    .subscribe();

  console.log('[fairPrice] Realtime listeners active on token_trades + token_bids.');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get fair price for a campaign.
 * Returns cached DB value if fresh, otherwise triggers a new calculation.
 *
 * @param {string|number} campaignId
 * @param {number|null}   listingPrice   Current ask price in ETH (optional, for UI context)
 * @returns {Promise<object|null>}
 */
async function getFairPrice(campaignId, listingPrice = null) {
  // ── 1. Try DB cache ──────────────────────────────────────────────────────
  const { data: cached, error: cacheErr } = await supabaseAdmin
    .from('campaigns')
    .select('fair_price_low, fair_price_high, fair_price_midpoint, fair_price_confidence, fair_price_rationale, fair_price_calculated_at')
    .eq('id', campaignId)
    .single();

  if (!cacheErr && cached?.fair_price_calculated_at && cached.fair_price_low) {
    const ageMs = Date.now() - new Date(cached.fair_price_calculated_at).getTime();
    if (ageMs < CACHE_TTL_MS) {
      // Return cached object with rationale flattened for easy frontend consumption
      return {
        ...cached,
        ...(cached.fair_price_rationale || {}),
        listing_price_eth: listingPrice,
        from_cache: true,
      };
    }
  }

  // ── 2. Cache miss — full recalculation ──────────────────────────────────
  return triggerFairPriceRecalculation(campaignId, listingPrice);
}

/**
 * Full recalculation pipeline:
 *   buildFullPayload → computeHeuristic → callGemini → writeCache → socketEmit
 *
 * Fire-and-forget safe: errors are caught and logged, never thrown to callers.
 */
async function triggerFairPriceRecalculation(campaignId, listingPrice = null) {
  try {
    const payload = await buildFullPayload(campaignId, listingPrice);
    if (!payload) {
      console.warn(`[fairPrice] Campaign ${campaignId} not found — skipping.`);
      return null;
    }

    // Inject heuristic computation into the payload so Gemini sees our math
    const heuristic = computeHeuristic(payload);
    Object.assign(payload.heuristic_calculation, heuristic);

    const llmResult = await callGemini(payload);
    if (!llmResult) return null;

    await writeCacheToDatabase(campaignId, llmResult);

    // Push live update to all frontend users viewing this campaign
    try {
      const { emitFairPriceUpdate } = require('../sockets/marketplaceSocket');
      emitFairPriceUpdate(campaignId, {
        ...llmResult,
        calculated_at: new Date().toISOString(),
      });
    } catch (socketErr) {
      // Socket not yet initialized on first startup call — safe to ignore
      console.warn('[fairPrice] Socket emit skipped:', socketErr.message);
    }

    return llmResult;
  } catch (err) {
    console.error('[fairPriceService] Recalculation failed for campaign', campaignId, ':', err.message);
    return null;
  }
}

/**
 * Debounced version of triggerFairPriceRecalculation.
 * Prevents hammering Gemini when many bids arrive in quick succession.
 */
function debouncedRecalc(campaignId, listingPrice, delayMs = DEBOUNCE_MS) {
  if (debounceTimers.has(campaignId)) {
    clearTimeout(debounceTimers.get(campaignId));
  }
  const timer = setTimeout(() => {
    debounceTimers.delete(campaignId);
    triggerFairPriceRecalculation(campaignId, listingPrice).catch(() => {});
  }, delayMs);
  debounceTimers.set(campaignId, timer);
}

// ─── Data Gathering ──────────────────────────────────────────────────────────

/**
 * Gather ALL signals from DB in parallel and assemble the structured payload
 * that will be sent verbatim to Gemini.
 *
 * Data sources:
 *   campaigns         → fundamentals + all 10 AI pitch scores
 *   token_trades      → last 10 settled trades
 *   valuation_snapshots → historical price milestones
 *   token_orders      → current sell listing (ask price, quantity, age)
 *   token_bids        → live pending bids (demand pressure signals)
 */
async function buildFullPayload(campaignId, listingPrice) {
  const [campaignRes, tradesRes, snapshotsRes, listingRes, bidsRes] = await Promise.all([
    // ── Campaign + all AI pitch scores ──────────────────────────────────────
    supabaseAdmin
      .from('campaigns')
      .select([
        'id', 'title', 'category',
        'price_per_token', 'funding_goal', 'amount_pledged',
        'investor_count', 'goal_reached', 'deadline', 'last_traded_price',
        // AI Pitch Review columns (populated by ai/score_campaigns.py)
        'risk_score', 'credibility', 'business_model', 'idea_clarity',
        'differentiation', 'gtm_strategy', 'problem_statement',
        'proof_of_capability', 'vagueness', 'ai_reasons',
      ].join(', '))
      .eq('id', campaignId)
      .single(),

    // ── Last 10 settled secondary market trades ──────────────────────────
    supabaseAdmin
      .from('token_trades')
      .select('price, quantity, executed_at, settlement_status')
      .eq('campaign_id', campaignId)
      .eq('settlement_status', 'settled')
      .order('executed_at', { ascending: false })
      .limit(10),

    // ── All valuation snapshots (primary issue + manual revaluations) ────
    supabaseAdmin
      .from('valuation_snapshots')
      .select('price, source, recorded_at')
      .eq('campaign_id', campaignId)
      .order('recorded_at', { ascending: false })
      .limit(20),

    // ── Current cheapest sell listing (the "ask") ────────────────────────
    supabaseAdmin
      .from('token_orders')
      .select('id, price, quantity_remaining, created_at, auto_accept_price_per_token')
      .eq('campaign_id', campaignId)
      .eq('side', 'sell')
      .in('status', ['open', 'partially_filled'])
      .order('price', { ascending: true })  // cheapest first
      .limit(1),

    // ── All pending bids on this campaign ────────────────────────────────
    supabaseAdmin
      .from('token_bids')
      .select('bid_price_per_token, created_at, status')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ]);

  const campaign = campaignRes.data;
  if (!campaign) return null;

  const trades      = tradesRes.data     || [];
  const snapshots   = snapshotsRes.data  || [];
  const listing     = listingRes.data?.[0] || null;
  const activeBids  = bidsRes.data       || [];

  // Derived signals
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent30dTrades = trades.filter(t => new Date(t.executed_at) > thirtyDaysAgo);

  const bidPrices = activeBids.map(b => Number(b.bid_price_per_token));
  const highestBid = bidPrices.length ? Math.max(...bidPrices) : null;
  const averageBid = bidPrices.length ? bidPrices.reduce((a, b) => a + b, 0) / bidPrices.length : null;

  const daysSinceFunding = campaign.deadline
    ? Math.floor((Date.now() - new Date(campaign.deadline).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const fundingGoal   = Number(campaign.funding_goal)   || 1;
  const amountPledged = Number(campaign.amount_pledged)  || 0;

  return {
    campaign: {
      title:                   campaign.title,
      category:                campaign.category,
      price_per_token_eth:     Number(campaign.price_per_token),
      funding_goal_eth:        fundingGoal,
      amount_pledged_eth:      amountPledged,
      funding_ratio:           amountPledged / fundingGoal,
      investor_count:          campaign.investor_count,
      goal_reached:            campaign.goal_reached,
      deadline:                campaign.deadline,
      days_since_funding_closed: daysSinceFunding,
      last_traded_price_eth:   campaign.last_traded_price ? Number(campaign.last_traded_price) : null,
    },

    // ── All 10 AI pitch scores ────────────────────────────────────────────
    ai_scores: {
      risk_score:         campaign.risk_score,        // 0–10, higher = riskier
      credibility:        campaign.credibility,        // 0–10, team trustworthiness
      business_model:     campaign.business_model,     // 0–10, revenue model strength
      idea_clarity:       campaign.idea_clarity,       // 0–10, pitch clarity
      differentiation:    campaign.differentiation,    // 0–10, competitive moat
      gtm_strategy:       campaign.gtm_strategy,       // 0–10, go-to-market plan
      problem_statement:  campaign.problem_statement,  // 0–10, problem-solution fit
      proof_of_capability: campaign.proof_of_capability, // 0–10, team track record
      vagueness:          campaign.vagueness,          // 0–10, higher = vaguer (red flag)
      ai_reasons:         campaign.ai_reasons,         // LLM's textual critique of the pitch
    },

    market_history: {
      trade_count_30d:    recent30dTrades.length,
      trade_count_all_time: trades.length,
      // Full trade history (up to last 5 for prompt brevity)
      recent_trades: trades.slice(0, 5).map(t => ({
        price_eth:    Number(t.price),
        quantity:     Number(t.quantity),
        executed_at:  t.executed_at,
      })),
      // Valuation snapshots: primary issue, last_trade, manual_revaluation
      valuation_snapshots: snapshots.slice(0, 5).map(s => ({
        price_eth:    Number(s.price),
        source:       s.source,
        recorded_at:  s.recorded_at,
      })),
    },

    current_listing: listing
      ? {
          asking_price_eth:          Number(listing.price),
          quantity_available:        Number(listing.quantity_remaining),
          listed_at:                 listing.created_at,
          days_on_market:            Math.floor((Date.now() - new Date(listing.created_at).getTime()) / (1000 * 60 * 60 * 24)),
          auto_accept_threshold_eth: listing.auto_accept_price_per_token
                                       ? Number(listing.auto_accept_price_per_token)
                                       : null,
        }
      : { asking_price_eth: listingPrice },

    live_bid_market: {
      active_bid_count:    activeBids.length,
      highest_bid_eth:     highestBid,
      average_bid_eth:     averageBid,
      most_recent_bid_at:  activeBids[0]?.created_at || null,
    },

    // heuristic_calculation will be populated by computeHeuristic()
    heuristic_calculation: {
      tier_used: recent30dTrades.length >= 3 ? 1 : 2,
    },
  };
}

// ─── Heuristic Formula ───────────────────────────────────────────────────────

/**
 * Tier 1 (≥3 settled trades in last 30 days):
 *   VWAP of last 3 trades: (3×P1 + 2×P2 + 1×P3) / 6
 *
 * Tier 2 (thin / no recent market):
 *   Weighted adjustment of original price_per_token using 5 factors:
 *     - fundingRatio      (overfunding → premium, up to +20%)
 *     - credibility score (+/-10% range)
 *     - risk score        (up to -25% penalty)
 *     - business_model    (+/-8% range)
 *     - vagueness         (up to -15% penalty)
 *
 * Returns heuristic metadata merged into payload.heuristic_calculation.
 */
function computeHeuristic(payload) {
  const { campaign, ai_scores, market_history } = payload;
  const base = campaign.price_per_token_eth;

  // ── Tier 1: real market data (VWAP) ──────────────────────────────────────
  if (payload.heuristic_calculation.tier_used === 1) {
    const trades = market_history.recent_trades;
    // Need at least 3 — slice already ensured by caller but guard anyway
    const [t1, t2, t3] = trades;
    const vwap = (3 * t1.price_eth + 2 * t2.price_eth + 1 * (t3?.price_eth ?? t2.price_eth)) / 6;
    const mid  = Math.round(vwap * 1e4) / 1e4;
    return {
      tier_used:             1,
      basis:                 'volume_weighted_average_last_3_trades',
      heuristic_midpoint_eth: mid,
      heuristic_low_eth:      Math.round(mid * 0.95 * 1e4) / 1e4,
      heuristic_high_eth:     Math.round(mid * 1.05 * 1e4) / 1e4,
    };
  }

  // ── Tier 2: multi-factor heuristic ───────────────────────────────────────
  const fundingRatio       = campaign.funding_ratio ?? 1;
  const credibility        = ai_scores.credibility    ?? 5;
  const riskScore          = ai_scores.risk_score     ?? 5;
  const businessModel      = ai_scores.business_model ?? 5;
  const vagueness          = ai_scores.vagueness      ?? 5;

  const fundingMultiplier        = 1 + Math.max(-0.10, Math.min(0.20, (fundingRatio - 1) * 0.15));
  const credibilityMultiplier    = 1 + ((credibility  - 5) / 5) * 0.10;
  const riskMultiplier           = 1 - (riskScore / 10) * 0.25;
  const businessModelMultiplier  = 1 + ((businessModel - 5) / 5) * 0.08;
  const vaguenessMultiplier      = 1 - Math.min(0.15, (vagueness / 10) * 0.10);

  const mid = base
    * fundingMultiplier
    * credibilityMultiplier
    * riskMultiplier
    * businessModelMultiplier
    * vaguenessMultiplier;

  return {
    tier_used:                 2,
    basis:                     'multi_factor_heuristic',
    funding_multiplier:        Math.round(fundingMultiplier       * 1e4) / 1e4,
    credibility_multiplier:    Math.round(credibilityMultiplier   * 1e4) / 1e4,
    risk_multiplier:           Math.round(riskMultiplier          * 1e4) / 1e4,
    business_model_multiplier: Math.round(businessModelMultiplier * 1e4) / 1e4,
    vagueness_multiplier:      Math.round(vaguenessMultiplier     * 1e4) / 1e4,
    heuristic_midpoint_eth:    Math.round(mid        * 1e4) / 1e4,
    heuristic_low_eth:         Math.round(mid * 0.92 * 1e4) / 1e4,
    heuristic_high_eth:        Math.round(mid * 1.08 * 1e4) / 1e4,
  };
}

// ─── Gemini 1.5 Flash API Call ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial analyst AI embedded in FundXProut, a blockchain-based startup equity crowdfunding platform.

A secondary token market listing has been submitted for fair price analysis. You will receive:
1. Campaign fundamentals (original price, funding success, investor count, etc.)
2. 10 AI pitch review scores (risk, credibility, business model, etc.) from our scoring system
3. Real secondary market trade history (prices, timestamps, volumes)
4. The seller's current listing price and how long it has been on market
5. Active buyer bids on this campaign (demand pressure signals)
6. A pre-computed heuristic fair price range (our internal model's estimate)

Your job:
- Validate or refine the heuristic range using ALL available market signals
- Give the buyer a clear, honest verdict: is this listing fair, overpriced, or underpriced?
- Give the seller practical guidance on their pricing strategy
- Identify the top 4 factors most influencing fair value
- Recommend a specific bid price the buyer should open with

CRITICAL: Return ONLY valid JSON. No markdown fences, no extra text, no explanation outside the JSON.

Return exactly this structure:
{
  "fair_price_low": number (ETH),
  "fair_price_high": number (ETH),
  "fair_price_midpoint": number (ETH),
  "confidence": "high" | "medium" | "low",
  "confidence_reason": "single sentence explaining confidence level",
  "buyer_verdict": "1-2 sentences — is this listing fair/overpriced/underpriced relative to fair value?",
  "seller_guidance": "1-2 sentences — advice to seller about their pricing strategy",
  "breakdown_bullets": [
    { "factor": "factor name", "impact": "+X.X% or -X.X%", "direction": "positive" | "negative" | "neutral" }
  ],
  "market_trend": "rising" | "falling" | "stable" | "insufficient_data",
  "recommended_bid_eth": number (your recommended opening bid in ETH)
}`;

async function callGemini(payload) {
  if (!GEMINI_API_KEY) {
    console.warn('[fairPrice] GEMINI_API_KEY not set — returning heuristic result only.');
    const h = payload.heuristic_calculation;
    return {
      fair_price_low:      h.heuristic_low_eth  ?? 0,
      fair_price_high:     h.heuristic_high_eth ?? 0,
      fair_price_midpoint: h.heuristic_midpoint_eth ?? 0,
      confidence:          'low',
      confidence_reason:   'AI analysis unavailable — showing heuristic estimate only.',
      buyer_verdict:       'Fair price estimate based on campaign metrics.',
      seller_guidance:     'Consider pricing near the fair midpoint to attract buyers.',
      breakdown_bullets:   [],
      market_trend:        'insufficient_data',
      recommended_bid_eth: h.heuristic_midpoint_eth ?? 0,
    };
  }

  const userMessage = `Please analyze this secondary token market listing and return the JSON valuation:\n\n${JSON.stringify(payload, null, 2)}`;

  const requestBody = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 1024,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

  const response = await axios.post(url, requestBody, {
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  });

  const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned empty content');

  const parsed = JSON.parse(rawText);

  // Validate required fields — fall back gracefully on partial response
  if (typeof parsed.fair_price_midpoint !== 'number') {
    throw new Error('Gemini response missing fair_price_midpoint');
  }

  return parsed;
}

// ─── DB Cache Write ───────────────────────────────────────────────────────────

async function writeCacheToDatabase(campaignId, llmResult) {
  const { error } = await supabaseAdmin
    .from('campaigns')
    .update({
      fair_price_low:           llmResult.fair_price_low,
      fair_price_high:          llmResult.fair_price_high,
      fair_price_midpoint:      llmResult.fair_price_midpoint,
      fair_price_confidence:    llmResult.confidence,
      fair_price_rationale:     llmResult,                      // full JSON blob
      fair_price_calculated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  if (error) {
    console.error('[fairPrice] Failed to write cache to DB:', error.message);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  getFairPrice,
  triggerFairPriceRecalculation,
  debouncedRecalc,
  initRealtimeListeners,
};
