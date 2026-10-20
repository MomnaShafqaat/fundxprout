-- backend/migrations/0013_automated_auction_deadline.sql
-- Implements automated auction deadline-based bidding:
-- 1. Adds listing_mode, listing_deadline, min_bid_price_per_token to token_orders
-- 2. Adds 'auto_accepted' status to token_bids
-- 3. Creates fn_process_auction_deadlines() pg_cron function
-- Run this in your Supabase SQL Editor.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A: Extend token_orders with auction fields
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.token_orders
  -- 'manual': seller picks the winner manually at any time
  -- 'auto':   system picks the highest bidder when listing_deadline passes
  ADD COLUMN IF NOT EXISTS listing_mode text NOT NULL DEFAULT 'manual'
    CHECK (listing_mode IN ('manual', 'auto')),

  -- Only used when listing_mode = 'auto'. Bidding closes at this timestamp.
  ADD COLUMN IF NOT EXISTS listing_deadline timestamp with time zone,

  -- Set to true after fn_process_auction_deadlines fires for this listing.
  -- Prevents double-processing if cron runs again before the next minute.
  ADD COLUMN IF NOT EXISTS deadline_processed boolean NOT NULL DEFAULT false,

  -- Optional floor price. Bids below this are rejected at the API level.
  ADD COLUMN IF NOT EXISTS min_bid_price_per_token numeric;

-- Index for fast auction deadline sweep
CREATE INDEX IF NOT EXISTS idx_token_orders_auto_deadline
  ON public.token_orders(listing_deadline)
  WHERE listing_mode = 'auto' AND deadline_processed = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART B: Add 'auto_accepted' to token_bids status CHECK
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.token_bids
  DROP CONSTRAINT IF EXISTS token_bids_status_check;

ALTER TABLE public.token_bids
  ADD CONSTRAINT token_bids_status_check
  CHECK (status = ANY (ARRAY[
    'pending',
    'auto_accepted',    -- system auto-selected this bid at listing_deadline
    'counter_offered',
    'counter_accepted',
    'counter_rejected',
    'accepted',
    'confirmed',
    'completed',
    'rejected',
    'cancelled',
    'expired'
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- PART C: fn_process_auction_deadlines — runs every minute via pg_cron
-- Finds auto-mode listings whose deadline has passed, picks the highest bid,
-- marks it auto_accepted, expires all other pending bids on that listing.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_process_auction_deadlines()
RETURNS void AS $$
DECLARE
  listing RECORD;
  winning_bid RECORD;
BEGIN
  -- Loop over all auto-mode listings whose deadline has passed and not yet processed
  FOR listing IN
    SELECT id, campaign_id
    FROM public.token_orders
    WHERE listing_mode = 'auto'
      AND listing_deadline IS NOT NULL
      AND listing_deadline < now()
      AND deadline_processed = false
      AND status IN ('open', 'partially_filled')
  LOOP
    -- Find the highest-priced pending bid (tie-break: earliest created_at wins)
    SELECT * INTO winning_bid
    FROM public.token_bids
    WHERE listing_id = listing.id
      AND status = 'pending'
    ORDER BY bid_price_per_token DESC, created_at ASC
    LIMIT 1;

    IF FOUND THEN
      -- Mark winning bid as auto_accepted — buyer has 24 hours to confirm & pay
      UPDATE public.token_bids
      SET status        = 'auto_accepted',
          accept_deadline = now() + INTERVAL '24 hours',
          updated_at    = now()
      WHERE id = winning_bid.id;

      -- Expire all other pending bids on this listing
      UPDATE public.token_bids
      SET status     = 'expired',
          updated_at = now()
      WHERE listing_id = listing.id
        AND status     = 'pending'
        AND id        != winning_bid.id;
    END IF;

    -- Mark listing deadline as processed regardless (even if no bids — prevents infinite retry)
    UPDATE public.token_orders
    SET deadline_processed = true,
        updated_at         = now()
    WHERE id = listing.id;

  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_process_auction_deadlines() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_process_auction_deadlines() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART D: Schedule fn_process_auction_deadlines every 1 minute via pg_cron
-- Requires pg_cron extension to be enabled in Supabase project settings.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT cron.unschedule('process-auction-deadlines') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-auction-deadlines'
);

SELECT cron.schedule(
  'process-auction-deadlines',
  '* * * * *',
  $$ SELECT public.fn_process_auction_deadlines(); $$
);
