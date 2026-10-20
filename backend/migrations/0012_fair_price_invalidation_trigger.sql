-- backend/migrations/0012_fair_price_invalidation_trigger.sql
--
-- Creates PostgreSQL functions and triggers that automatically fire
-- a NOTIFY event on the 'fair_price_invalidate' channel whenever:
--   1. A new settled trade is inserted into token_trades
--   2. A new bid is inserted/updated in token_bids
--
-- Run this in your Supabase SQL editor. Safe to run multiple times.

-- ── 1. Function for token_trades ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_fair_price_on_trade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM pg_notify(
    'fair_price_invalidate',
    json_build_object(
      'campaign_id',   NEW.campaign_id,
      'trigger_table', 'token_trades',
      'new_price',     NEW.price,
      'at',            NOW()
    )::text
  );
  RETURN NEW;
END;
$$;

-- ── 2. Function for token_bids (uses bid_price_per_token, NOT price) ──────────
CREATE OR REPLACE FUNCTION public.notify_fair_price_on_bid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM pg_notify(
    'fair_price_invalidate',
    json_build_object(
      'campaign_id',   NEW.campaign_id,
      'trigger_table', 'token_bids',
      'new_price',     NEW.bid_price_per_token,
      'at',            NOW()
    )::text
  );
  RETURN NEW;
END;
$$;

-- ── Trigger 1: New settled trade → immediate recalc ───────────────────────────
DROP TRIGGER IF EXISTS trg_invalidate_fair_price_on_trade ON public.token_trades;
CREATE TRIGGER trg_invalidate_fair_price_on_trade
  AFTER INSERT ON public.token_trades
  FOR EACH ROW
  WHEN (NEW.settlement_status = 'settled')
  EXECUTE FUNCTION public.notify_fair_price_on_trade();

-- ── Trigger 2: New bid / bid price update → debounced recalc ──────────────────
DROP TRIGGER IF EXISTS trg_invalidate_fair_price_on_bid ON public.token_bids;
CREATE TRIGGER trg_invalidate_fair_price_on_bid
  AFTER INSERT OR UPDATE OF bid_price_per_token ON public.token_bids
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.notify_fair_price_on_bid();

-- Clean up old unified function if present
DROP FUNCTION IF EXISTS public.notify_fair_price_invalidation();
