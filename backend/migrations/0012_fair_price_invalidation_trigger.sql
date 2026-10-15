-- backend/migrations/0012_fair_price_invalidation_trigger.sql
--
-- Creates PostgreSQL functions and triggers that automatically fire
-- a NOTIFY event on the 'fair_price_invalidate' channel whenever:
--   1. A new settled trade is inserted into token_trades
--   2. A new bid is inserted/updated in token_bids
--
-- The backend's Supabase realtime listener (in fairPriceService.js)
-- picks up these notifications and schedules a recalculation.
--
-- Run this in your Supabase SQL editor. Safe to run multiple times.
-- Does NOT modify any existing tables.

-- ── Function: notify on any fair-price-relevant change ───────────────────────
CREATE OR REPLACE FUNCTION public.notify_fair_price_invalidation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM pg_notify(
    'fair_price_invalidate',
    json_build_object(
      'campaign_id',  NEW.campaign_id,
      'trigger_table', TG_TABLE_NAME,
      'new_price',    CASE WHEN TG_TABLE_NAME = 'token_trades' THEN NEW.price
                           WHEN TG_TABLE_NAME = 'token_bids'   THEN NEW.bid_price_per_token
                           ELSE NULL END,
      'at',           NOW()
    )::text
  );
  RETURN NEW;
END;
$$;

-- ── Trigger 1: New settled trade → immediate high-priority recalc ────────────
DROP TRIGGER IF EXISTS trg_invalidate_fair_price_on_trade ON public.token_trades;
CREATE TRIGGER trg_invalidate_fair_price_on_trade
  AFTER INSERT ON public.token_trades
  FOR EACH ROW
  WHEN (NEW.settlement_status = 'settled')
  EXECUTE FUNCTION public.notify_fair_price_invalidation();

-- ── Trigger 2: New bid / bid price update → debounced recalc ─────────────────
DROP TRIGGER IF EXISTS trg_invalidate_fair_price_on_bid ON public.token_bids;
CREATE TRIGGER trg_invalidate_fair_price_on_bid
  AFTER INSERT OR UPDATE OF bid_price_per_token ON public.token_bids
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.notify_fair_price_invalidation();
