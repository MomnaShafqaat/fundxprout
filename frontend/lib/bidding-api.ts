// frontend/lib/bidding-api.ts
// Client-side functions for the auction-style bidding system.
// All functions call the backend biddingRoutes endpoints.

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

import { createClient } from '@/utils/supabase/client';

// ── Types ────────────────────────────────────────────────────────

export type BidStatus =
  | 'pending'
  | 'auto_accepted'    // system auto-selected this bid when listing_deadline passed
  | 'counter_offered'  // shafqaat implemented — seller sent a counter-price
  | 'counter_accepted' // buyer agreed to counter → proceeds to confirm+complete
  | 'counter_rejected' // buyer turned down counter → bid ends
  | 'accepted'
  | 'confirmed'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type TokenBid = {
  id: string;
  listing_id: string;
  campaign_id: string;
  buyer_id: string;
  buyer_wallet: string;
  bid_price_per_token: number;
  quantity: number;
  status: BidStatus;
  bid_expires_at: string;
  accept_deadline: string | null;
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
  // shafqaat implemented — counter-offer fields (Fix 7)
  original_bid_price: number | null;        // Buyer's original offer (preserved on counter)
  counter_price_per_token: number | null;   // Seller's counter price
  counter_expires_at: string | null;        // Deadline for buyer to respond to counter
  counter_message: string | null;           // Optional seller note on counter
  // Joined from token_orders → campaigns
  token_orders?: {
    price: number;
    quantity_remaining: number;
    seller_wallet_address: string | null;
    seller_signature: string | null;
    seller_nonce: number | null;
    // shafqaat implemented — Fix P3: auto-accept threshold price on sell listings
    auto_accept_price_per_token?: number | null;
    // Auction mode fields
    listing_mode?: 'manual' | 'auto';
    listing_deadline?: string | null;          // ISO timestamp for auction end
    min_bid_price_per_token?: number | null;   // Floor price — bids below this are rejected
    campaigns?: {
      title: string | null;
      category: string | null;
      token_contract_address: string | null;
      token_symbol: string | null;
    } | null;
  } | null;
  // Joined from profiles (when seller views bids on their listing)
  profiles?: {
    full_name: string | null;
    display_name: string | null;
    identity_verified: boolean;
  } | null;
};

export type SettlementData = {
  seller_wallet: string;
  seller_signature: string;
  seller_nonce: number;
  token_contract_address: string;
  quantity: number;
  price_per_token: number;
  // shafqaat implemented — Fix P3: Marketplace fee breakdown
  subtotal?: number;
  platform_fee?: number;
  platform_fee_bps?: number;
};

// ── Auth helper ──────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You must be signed in.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ── API Functions ────────────────────────────────────────────────

/** Buyer: place a bid on a sell listing */
export async function placeBid(payload: {
  listing_id: string;
  bid_price_per_token: number;
  quantity: number;
  buyer_wallet: string;
  bid_expires_days?: number;
}): Promise<{ bid: TokenBid; message: string }> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to place bid');
  }
  return res.json();
}

/** Buyer: get all my bids */
export async function getMyBids(): Promise<{ bids: TokenBid[] }> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/my`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load your bids');
  return res.json();
}

/** Buyer: cancel a pending bid */
export async function cancelBid(bidId: string): Promise<{ bid: TokenBid; message: string }> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/${bidId}/cancel`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to cancel bid');
  }
  return res.json();
}

/** Buyer: confirm an accepted bid (returns settlement data needed for fillOrder) */
export async function confirmBid(bidId: string): Promise<{
  message: string;
  settlement_data: SettlementData;
}> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/${bidId}/confirm`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to confirm bid');
  }
  return res.json();
}

/** Buyer: mark bid as completed after on-chain tx succeeds */
export async function completeBid(
  bidId: string,
  tx_hash: string,
  block_number?: number
): Promise<{ message: string; tx_hash: string }> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/${bidId}/complete`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ tx_hash, block_number }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to complete bid');
  }
  return res.json();
}

/** Seller: get all bids on a specific listing */
export async function getListingBids(listingId: string): Promise<{
  listing: any;
  bids: TokenBid[];
}> {
  const res = await fetch(`${API_BASE}/api/marketplace/listings/${listingId}/bids`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load bids for listing');
  return res.json();
}

/** Seller: accept a specific bid */
export async function acceptBid(bidId: string): Promise<{
  bid: TokenBid;
  accept_deadline: string;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/${bidId}/accept`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to accept bid');
  }
  return res.json();
}

/** Seller: reject a specific bid (works for pending and counter_offered status) */
export async function rejectBid(bidId: string): Promise<{
  bid: TokenBid;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/${bidId}/reject`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to reject bid');
  }
  return res.json();
}

// shafqaat implemented — Fix 7: Counter-Offer Negotiation API functions

/** Seller: send a counter-offer price to a buyer's pending bid */
export async function counterBid(
  bidId: string,
  payload: {
    counter_price_per_token: number;
    counter_message?: string;
    counter_expires_hours?: number;
  }
): Promise<{
  bid: TokenBid;
  counter_expires_at: string;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/${bidId}/counter`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to send counter-offer');
  }
  return res.json();
}

/** Buyer: accept the seller's counter-offer — proceeds to confirm+complete flow */
export async function acceptCounter(bidId: string): Promise<{
  bid: TokenBid;
  accept_deadline: string;
  effective_price: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/${bidId}/accept-counter`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to accept counter-offer');
  }
  return res.json();
}

/** Buyer: reject the seller's counter-offer — bid ends, listing re-opens */
export async function rejectCounter(bidId: string): Promise<{
  bid: TokenBid;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/${bidId}/reject-counter`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to reject counter-offer');
  }
  return res.json();
}

export async function signListing(
  listingId: string,
  seller_signature: string,
  seller_nonce: number,
  seller_expiry?: number
): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/marketplace/listings/${listingId}/sign`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ seller_signature, seller_nonce, seller_expiry }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to sign listing');
  }
  return res.json();
}

// shafqaat implemented — Fix P3: Buyer modifies their pending bid (increase offer or quantity)
export async function modifyBid(
  bidId: string,
  payload: { new_bid_price_per_token?: number; new_quantity?: number }
): Promise<{ bid: TokenBid; auto_accepted?: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/marketplace/bids/${bidId}/modify`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to modify bid');
  }
  return res.json();
}
