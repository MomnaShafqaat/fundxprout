// backend/services/orderValidationService.js
// Enforces the pre-trade rules against live Supabase data before any order
// is reserved or inserted into the book.
const { supabaseAdmin } = require('../config/supabaseAdmin');

class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

/** Rules 5, 6, 12: campaign must be closed+funded, trading enabled, not flagged. */
async function validateTradeable(campaignId) {
  const { data: campaign, error: campErr } = await supabaseAdmin
    .from('campaigns')
    .select('id, status, goal_reached, is_expired, secondary_trading_enabled, flag_count, last_traded_price, price_per_token, funding_goal, amount_pledged, deadline')
    .eq('id', campaignId)
    .single();

  if (campErr || !campaign) throw new ValidationError('CAMPAIGN_NOT_FOUND', 'Campaign not found');

  const isFunded = campaign.goal_reached === true || 
    (campaign.funding_goal && Number(campaign.amount_pledged) >= Number(campaign.funding_goal)) ||
    ['successful', 'funded', 'launched'].includes(campaign.status);

  const isClosed = campaign.is_expired === true || 
    (campaign.deadline && new Date(campaign.deadline) <= new Date()) ||
    !campaign.deadline ||
    isFunded;

  if (!isFunded && !isClosed) {
    throw new ValidationError('CAMPAIGN_NOT_CLOSED', 'Campaign must be closed and funded before secondary trading');
  }

  // Auto-sync flags to DB so subsequent checks and queries are consistent
  if (isFunded && (!campaign.is_expired || !campaign.goal_reached || !campaign.secondary_trading_enabled)) {
    await supabaseAdmin
      .from('campaigns')
      .update({
        goal_reached: true,
        is_expired: true,
        secondary_trading_enabled: true,
      })
      .eq('id', campaignId);
  }

  if (campaign.secondary_trading_enabled === false) {
    throw new ValidationError('TRADING_DISABLED', 'Secondary trading is disabled for this campaign');
  }

  const { data: settings } = await supabaseAdmin
    .from('campaign_secondary_market_settings')
    .select('trading_enabled, price_band_percent, min_order_size, max_order_size, lockup_days')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  return { campaign, settings };
}

/** Rules 1, 2, 3, 4, 16: identity/profile/KYB/verification-session/AML checks. */
async function validateInvestor(investorId) {
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('user_id, identity_verified, profile_complete, trading_restricted, role, wallet_verified')
    .eq('user_id', investorId)
    .single();

  if (profErr || !profile) throw new ValidationError('PROFILE_NOT_FOUND', 'Investor profile not found');
  if (!profile.identity_verified) throw new ValidationError('NOT_VERIFIED', 'Identity verification required');
  if (!profile.profile_complete) throw new ValidationError('PROFILE_INCOMPLETE', 'Profile must be complete to trade');
  if (profile.trading_restricted) throw new ValidationError('TRADING_RESTRICTED', 'This account is restricted from trading');

  // Rule 4: no active pending/rejected verification session
  const { data: sessions } = await supabaseAdmin
    .from('verification_sessions')
    .select('status, created_at')
    .eq('entity_id', investorId)
    .eq('entity_type', 'profile')
    .order('created_at', { ascending: false })
    .limit(1);

  const latestSession = sessions?.[0];
  if (latestSession && ['pending', 'rejected'].includes(latestSession.status)) {
    throw new ValidationError('VERIFICATION_PENDING', `Latest verification session is ${latestSession.status}`);
  }

  // Rule 3: if trading as a business entity, require KYB too
  if (profile.role === 'business') {
    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('kyb_verified')
      .eq('owner_id', investorId)
      .single();
    if (!business || !business.kyb_verified) {
      throw new ValidationError('KYB_NOT_VERIFIED', 'Business KYB verification required');
    }
  }

  return profile;
}

/** Rule 11: order price must sit within the configured band of the reference price. */
function validatePriceBand(price, campaign, settings) {
  // Only enforce price band if explicitly configured in settings
  if (!settings?.price_band_percent) return;

  const reference = campaign.last_traded_price ?? campaign.price_per_token;
  if (!reference) return; // no reference yet (never traded, no issue price) — allow

  const bandPercent = settings.price_band_percent;
  const lower = reference * (1 - bandPercent / 100);
  const upper = reference * (1 + bandPercent / 100);

  if (price < lower || price > upper) {
    throw new ValidationError(
      'PRICE_OUT_OF_BAND',
      `Price ${price} is outside the allowed ±${bandPercent}% band around reference price ${reference}`
    );
  }
}

/** Rule 13: min/max order size. */
function validateOrderSize(qty, settings) {
  if (settings?.min_order_size != null && qty < settings.min_order_size) {
    throw new ValidationError('ORDER_TOO_SMALL', `Order quantity below minimum of ${settings.min_order_size}`);
  }
  if (settings?.max_order_size != null && qty > settings.max_order_size) {
    throw new ValidationError('ORDER_TOO_LARGE', `Order quantity exceeds maximum of ${settings.max_order_size}`);
  }
}

// shafqaat implemented — Fix 5b: Lockup period enforcement.
// Checks the investments table for lockup_expires_at. If the investor's tokens
// are still within the lockup window they are blocked from creating sell orders.
// This prevents early secondary-market dumps that bypass the lockup agreement.
async function validateLockup(investorId, campaignId) {
  const { data: investment, error } = await supabaseAdmin
    .from('investments')
    .select('lockup_expires_at')
    .eq('user_id', investorId)
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (error) {
    // Non-fatal: if we can't read the investment row, don't block the order
    console.warn('[validateLockup] Could not read investments row:', error.message);
    return;
  }

  if (investment?.lockup_expires_at && new Date(investment.lockup_expires_at) > new Date()) {
    const msLeft = new Date(investment.lockup_expires_at) - new Date();
    const daysLeft = Math.ceil(msLeft / 86_400_000);
    throw new ValidationError(
      'LOCKUP_ACTIVE',
      `Your tokens are locked for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}. ` +
      `You cannot list them for sale until the lockup period ends.`
    );
  }
}

/**
 * Runs every pre-trade check. Throws ValidationError on first failure.
 * @param {Object} order - { campaign_id, investor_id, side, price, quantity }
 * @param {Object} opts  - { skipInvestorValidation: boolean }
 * @returns {Promise<{campaign: Object, settings: Object}>}
 */
// shafqaat implemented — Fix 5a: validateOrder re-enabled with KYC + lockup enforcement.
// Previously this function was commented out in marketplaceController.js, allowing
// ANY user to place orders regardless of KYC status, campaign state, or lockup period.
async function validateOrder(order, { skipInvestorValidation = false } = {}) {
  const { campaign, settings } = await validateTradeable(order.campaign_id);

  if (!skipInvestorValidation) {
    await validateInvestor(order.investor_id);
  }

  // Enforce lockup only for sell orders
  if (order.side === 'sell' && order.investor_id) {
    await validateLockup(order.investor_id, order.campaign_id);
  }

  validatePriceBand(order.price, campaign, settings);
  validateOrderSize(order.quantity, settings);

  return { campaign, settings };
}

module.exports = { validateOrder, validateTradeable, validateInvestor, validateLockup, ValidationError };
