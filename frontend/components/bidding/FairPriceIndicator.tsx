'use client';
// frontend/components/bidding/FairPriceIndicator.tsx
//
// A premium dark UI card embedded inside PlaceBidModal and CounterOfferModal.
//
// Features:
//   • Live AI fair price range (low – high ETH)
//   • Confidence badge (high / medium / low)
//   • Market trend icon
//   • Deviation badge: tells buyer if listing is 15%+ over/under fair value
//   • One-click "Autofill Recommended Bid" button
//   • Expandable breakdown of the top factors that influenced the valuation
//   • Real-time updates via useFairPrice Socket.IO subscription

import React, { useState } from 'react';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Zap,
  AlertTriangle,
  CheckCircle,
  Sparkles,
} from 'lucide-react';
import { useFairPrice, type FairPriceResult } from '@/hooks/useFairPrice';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FairPriceIndicatorProps {
  /** Campaign ID (bigint from campaigns table) */
  campaignId: string | number;
  /** Current seller ask price in ETH */
  listingPrice?: number | null;
  /** Called when user clicks "Autofill Recommended Bid" */
  onApplyFairPrice?: (recommendedBid: number) => void;
  /** Extra CSS classes for the outer wrapper */
  className?: string;
}

// ─── Style Maps ──────────────────────────────────────────────────────────────

const CONFIDENCE_STYLE: Record<string, string> = {
  high:   'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  medium: 'text-yellow-400  border-yellow-500/30  bg-yellow-500/10',
  low:    'text-orange-400  border-orange-500/30  bg-orange-500/10',
};

const TREND_ELEMENT: Record<string, React.ReactNode> = {
  rising:            <TrendingUp  size={12} className="text-emerald-400" />,
  falling:           <TrendingDown size={12} className="text-red-400" />,
  stable:            <Minus       size={12} className="text-gray-400" />,
  insufficient_data: <Minus       size={12} className="text-gray-600" />,
};

const DIRECTION_CLASS: Record<string, string> = {
  positive: 'text-emerald-400 font-mono',
  negative: 'text-red-400     font-mono',
  neutral:  'text-gray-400    font-mono',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function FairPriceIndicator({
  campaignId,
  listingPrice,
  onApplyFairPrice,
  className = '',
}: FairPriceIndicatorProps) {
  const { data, loading, error, refresh } = useFairPrice(
    campaignId,
    listingPrice ?? undefined,
  );
  const [expanded, setExpanded] = useState(false);

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className={`rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 flex items-center gap-3 ${className}`}
        role="status"
        aria-label="Loading AI fair price"
      >
        <Brain size={14} className="shrink-0 animate-pulse text-[#a78bfa]" />
        <span className="text-xs text-gray-500">Calculating AI fair price…</span>
      </div>
    );
  }

  // ── Error / unavailable ──────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div
        className={`rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center justify-between gap-2 ${className}`}
      >
        <span className="text-xs text-gray-500">
          AI fair price unavailable
        </span>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1.5 text-[11px] text-[#a78bfa] hover:text-white transition"
        >
          <RefreshCw size={11} />
          Retry
        </button>
      </div>
    );
  }

  // ── Deviation calculation ────────────────────────────────────────────────
  const hasListing = listingPrice != null && data.fair_price_midpoint > 0;
  const deviation = hasListing
    ? ((listingPrice! - data.fair_price_midpoint) / data.fair_price_midpoint) * 100
    : 0;
  const isOverpriced  = hasListing && deviation >  15;
  const isUnderpriced = hasListing && deviation < -15;
  const isFair        = hasListing && !isOverpriced && !isUnderpriced;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className={`rounded-2xl border border-[#a78bfa]/20 bg-[#a78bfa]/5 p-4 space-y-3 transition-all ${className}`}
      aria-label="AI Fair Price Indicator"
    >
      {/* ── Row 1: Header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={14} className="shrink-0 text-[#a78bfa]" />
          <span className="text-xs font-bold text-white tracking-wide">
            AI Fair Valuation
          </span>
          {TREND_ELEMENT[data.market_trend] ?? TREND_ELEMENT.insufficient_data}
          {data.from_cache && (
            <span className="text-[9px] text-gray-600 font-mono ml-1">cached</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Confidence badge */}
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CONFIDENCE_STYLE[data.confidence] ?? CONFIDENCE_STYLE.low}`}
          >
            ● {data.confidence}
          </span>

          {/* Manual refresh */}
          <button
            type="button"
            onClick={refresh}
            title="Refresh fair price analysis"
            className="text-gray-600 hover:text-gray-300 transition"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Row 2: Price band ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xl font-black text-white leading-tight">
            {data.fair_price_low.toFixed(4)}
            <span className="text-base text-gray-400 font-semibold mx-1.5">–</span>
            {data.fair_price_high.toFixed(4)}
          </span>
          <span className="text-[11px] text-gray-500">ETH / token</span>
          <span className="text-[11px] text-gray-500">
            (mid: {data.fair_price_midpoint.toFixed(4)})
          </span>
        </div>
        <p className="mt-1 text-[11px] text-gray-500 leading-relaxed">
          {data.confidence_reason}
        </p>
      </div>

      {/* ── Row 3: Deviation badge ────────────────────────────────────────── */}
      {hasListing && (
        <>
          {isOverpriced && (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
              <AlertTriangle size={13} className="shrink-0 text-red-400 mt-0.5" />
              <p className="text-[11px] text-red-300 leading-relaxed">
                Listing is{' '}
                <strong className="text-red-200">{Math.abs(deviation).toFixed(0)}% above</strong>{' '}
                AI fair value — consider bidding closer to the midpoint.
              </p>
            </div>
          )}

          {isUnderpriced && (
            <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
              <Sparkles size={13} className="shrink-0 text-emerald-400 mt-0.5" />
              <p className="text-[11px] text-emerald-300 leading-relaxed">
                Listing is{' '}
                <strong className="text-emerald-200">{Math.abs(deviation).toFixed(0)}% below</strong>{' '}
                AI fair value — this may be a strong opportunity.
              </p>
            </div>
          )}

          {isFair && (
            <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
              <CheckCircle size={12} className="shrink-0 text-gray-400" />
              <p className="text-[11px] text-gray-400">
                Listing is within the AI fair value range
                {deviation !== 0 && ` (${deviation > 0 ? '+' : ''}${deviation.toFixed(0)}%)`}.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Row 4: Buyer verdict ─────────────────────────────────────────── */}
      {data.buyer_verdict && (
        <p className="text-[11px] text-gray-300 leading-relaxed">{data.buyer_verdict}</p>
      )}

      {/* ── Row 5: Autofill button ───────────────────────────────────────── */}
      {onApplyFairPrice && data.recommended_bid_eth > 0 && (
        <button
          type="button"
          id="fair-price-autofill-btn"
          onClick={() => onApplyFairPrice(data.recommended_bid_eth)}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition hover:opacity-90 active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, rgba(167,139,250,0.18), rgba(139,92,246,0.12))',
            border: '1px solid rgba(167,139,250,0.3)',
            color: '#a78bfa',
          }}
        >
          <Zap size={12} />
          Autofill AI Recommended Bid — {data.recommended_bid_eth.toFixed(4)} ETH
        </button>
      )}

      {/* ── Row 6: Expandable breakdown ──────────────────────────────────── */}
      {data.breakdown_bullets && data.breakdown_bullets.length > 0 && (
        <>
          <button
            type="button"
            id="fair-price-breakdown-toggle"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition w-full text-left"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {expanded ? 'Hide' : 'View'} valuation factor breakdown
          </button>

          {expanded && (
            <div className="space-y-2 border-t border-white/10 pt-3">
              {data.breakdown_bullets.map((bullet, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-400 flex-1 pr-4">{bullet.factor}</span>
                  <span className={DIRECTION_CLASS[bullet.direction] ?? DIRECTION_CLASS.neutral}>
                    {bullet.impact}
                  </span>
                </div>
              ))}

              {data.seller_guidance && (
                <div className="border-t border-white/10 pt-2">
                  <p className="text-[10px] text-gray-500 italic leading-relaxed">
                    <span className="text-gray-600 not-italic font-semibold">Seller guidance: </span>
                    {data.seller_guidance}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
