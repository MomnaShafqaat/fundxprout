'use client';

// frontend/app/investor-dashboard/my-listings/page.tsx
// Seller views their own sell listings and the bids placed on each one.
// Sellers can accept a bid from this page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getListingBids, acceptBid, rejectBid, type TokenBid } from '@/lib/bidding-api';
import { cancelSellOrder } from '@/lib/marketplace-api';
import { toast } from 'sonner';
import {
  Loader2, ChevronDown, ChevronUp, CheckCircle2, Trophy,
  Clock, AlertCircle, RotateCcw, ShieldCheck, ArrowUpDown, Filter, Trash2,
  Handshake, Sparkles, XCircle,
} from 'lucide-react';
import CounterOfferModal from '@/components/bidding/CounterOfferModal';

type Listing = {
  id: string;
  campaign_id: string;
  price: number;
  quantity: number;
  quantity_remaining: number;
  quantity_filled: number;
  status: string;
  seller_signature: string | null;
  // shafqaat implemented — Fix P3: auto-accept threshold price on listings
  auto_accept_price_per_token?: number | null;
  // Auction mode fields
  listing_mode?: 'manual' | 'auto';
  listing_deadline?: string | null;
  min_bid_price_per_token?: number | null;
  created_at: string;
  campaign?: { title: string | null; category: string | null; token_contract_address: string | null };
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function timeLeft(iso: string | null) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

// ── One Listing Row with expandable bid list ─────────────────────
function ListingRow({ listing, userId, onRefresh }: { listing: Listing; userId: string; onRefresh?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [bids, setBids] = useState<TokenBid[]>([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [bidsError, setBidsError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // shafqaat implemented — Fix P3: Counter offer modal state for seller
  const [counterModalBid, setCounterModalBid] = useState<TokenBid | null>(null);

  // Filter & Sort state for bids
  const [sortBy, setSortBy] = useState<'highest' | 'lowest' | 'newest' | 'oldest'>('highest');
  const [filterBy, setFilterBy] = useState<'all' | 'pending' | 'accepted' | 'kyc'>('all');

  async function loadBids() {
    setBidsLoading(true);
    setBidsError(null);
    try {
      const result = await getListingBids(listing.id);
      setBids(result.bids || []);
    } catch (err: any) {
      setBidsError(err.message);
    } finally {
      setBidsLoading(false);
    }
  }

  function handleToggle() {
    if (!expanded) loadBids();
    setExpanded((v) => !v);
  }

  async function handleAccept(bidId: string) {
    setAccepting(bidId);
    const toastId = toast.loading('Accepting bid…');
    try {
      await acceptBid(bidId);
      toast.success('Bid accepted! The buyer has 24 hours to confirm their purchase.', { id: toastId, duration: 6000 });
      await loadBids();
    } catch (err: any) {
      toast.error(err.message || 'Failed to accept bid.', { id: toastId });
    } finally {
      setAccepting(null);
    }
  }

  async function handleReject(bidId: string) {
    if (!confirm('Reject this bid? The buyer will be notified. This cannot be undone.')) return;
    setRejecting(bidId);
    const toastId = toast.loading('Rejecting bid…');
    try {
      await rejectBid(bidId);
      toast.success('Bid rejected. The buyer has been notified.', { id: toastId });
      await loadBids();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject bid.', { id: toastId });
    } finally {
      setRejecting(null);
    }
  }

  async function handleDelist(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delist this sell order? Any unfulfilled tokens will be released back to your available balance.')) return;
    setCancelling(true);
    const toastId = toast.loading('Delisting sell order…');
    try {
      await cancelSellOrder(listing.id);
      toast.success('Sell listing delisted successfully.', { id: toastId });
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delist order.', { id: toastId });
    } finally {
      setCancelling(false);
    }
  }

  const pendingBids = bids.filter((b) => b.status === 'pending');

  const filteredAndSortedBids = useMemo(() => {
    let list = [...bids];
    if (filterBy === 'pending') {
      list = list.filter((b) => b.status === 'pending');
    } else if (filterBy === 'accepted') {
      list = list.filter((b) => ['accepted', 'confirmed', 'completed'].includes(b.status));
    } else if (filterBy === 'kyc') {
      list = list.filter((b) => b.profiles?.identity_verified);
    }

    list.sort((a, b) => {
      if (sortBy === 'highest') return Number(b.bid_price_per_token) - Number(a.bid_price_per_token);
      if (sortBy === 'lowest') return Number(a.bid_price_per_token) - Number(b.bid_price_per_token);
      if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return 0;
    });

    return list;
  }, [bids, filterBy, sortBy]);

  return (
    <div className="rounded-3xl border border-border bg-card overflow-hidden transition shadow-sm">
      {/* Listing summary row */}
      <div className="flex w-full items-center justify-between gap-4 p-5 text-left transition hover:bg-muted/20">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={handleToggle}>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-foreground truncate">
              {listing.campaign?.title || `Campaign #${listing.campaign_id}`}
            </p>
            <span
              className="rounded-xl px-2 py-0.5 text-[10px] font-bold"
              style={
                listing.status === 'open'
                  ? { color: 'var(--chart-3)', background: 'color-mix(in srgb, var(--chart-3) 12%, transparent)' }
                  : listing.status === 'filled'
                  ? { color: 'var(--muted-foreground)', background: 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)' }
                  : { color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 10%, transparent)' }
              }
            >
              {listing.status.toUpperCase()}
            </span>
            {!listing.seller_signature && (
              <span className="flex items-center gap-1 rounded-xl bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                <AlertCircle size={9} /> Unsigned
              </span>
            )}
            {/* shafqaat implemented — Fix P3: Auto-accept threshold indicator badge */}
            {listing.auto_accept_price_per_token && (
              <span className="flex items-center gap-1 rounded-xl bg-chart-3/15 px-2 py-0.5 text-[10px] font-bold text-chart-3 border border-chart-3/30">
                <Sparkles size={9} /> Auto-Accept: {listing.auto_accept_price_per_token} ETH
              </span>
            )}
            {/* Automated auction mode indicator */}
            {listing.listing_mode === 'auto' && (
              <span className="flex items-center gap-1 rounded-xl bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-500 border border-amber-500/30">
                <Trophy size={9} /> Auto Auction {listing.listing_deadline ? `· Ends ${timeLeft(listing.listing_deadline)}` : ''}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {listing.quantity_remaining} / {listing.quantity} tokens remaining · {listing.price} ETH/token
            · {timeAgo(listing.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {['open', 'partially_filled'].includes(listing.status) && (
            <button
              onClick={handleDelist}
              disabled={cancelling}
              className="flex items-center gap-1 rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive hover:text-white disabled:opacity-50"
              title="Delist this sell order"
            >
              {cancelling ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Delist
            </button>
          )}
          {pendingBids.length > 0 && !expanded && (
            <span
              className="rounded-xl px-2.5 py-1 text-xs font-bold"
              style={{ color: 'var(--ring)', background: 'color-mix(in srgb, var(--ring) 12%, transparent)' }}
            >
              {pendingBids.length} new bid{pendingBids.length > 1 ? 's' : ''}
            </span>
          )}
          <button onClick={handleToggle} className="p-1 text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Expanded bid list */}
      {expanded && (
        <div className="border-t border-border bg-background/40 px-5 py-4">
          {/* Toolbar: Filter & Sort */}
          {bids.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <Filter size={13} className="text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">Filter:</span>
                <select
                  value={filterBy}
                  onChange={(e) => setFilterBy(e.target.value as any)}
                  className="rounded-xl border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground outline-none transition focus:border-ring"
                >
                  <option value="all">All Bids ({bids.length})</option>
                  <option value="pending">Pending Only ({bids.filter(b => b.status === 'pending').length})</option>
                  <option value="accepted">Accepted Only ({bids.filter(b => ['accepted', 'confirmed', 'completed'].includes(b.status)).length})</option>
                  <option value="kyc">KYC Verified Only ({bids.filter(b => b.profiles?.identity_verified).length})</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <ArrowUpDown size={13} className="text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="rounded-xl border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground outline-none transition focus:border-ring"
                >
                  <option value="highest">Highest Offer First</option>
                  <option value="lowest">Lowest Offer First</option>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                </select>
              </div>
            </div>
          )}

          {bidsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading bids…
            </div>
          ) : bidsError ? (
            <p className="text-sm text-destructive">{bidsError}</p>
          ) : filteredAndSortedBids.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bids match your selected filter.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Ranked header */}
              <div className="mb-1 grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>#</span>
                <span>Buyer</span>
                <span>Qty</span>
                <span>Price/Token</span>
                <span>Action</span>
              </div>

              {filteredAndSortedBids.map((bid, idx) => {
                const isAccepted = ['accepted', 'confirmed', 'completed'].includes(bid.status);
                const isCounterAccepted = bid.status === 'counter_accepted';
                const isAccepting = accepting === bid.id;
                const isRejecting = rejecting === bid.id;
                const buyer = bid.profiles;

                return (
                  <div
                    key={bid.id}
                    className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                    style={idx === 0 && bid.status === 'pending' ? {
                      borderColor: 'color-mix(in srgb, var(--chart-5) 40%, transparent)',
                    } : {}}
                  >
                    {/* Rank */}
                    <span className="text-sm font-bold" style={{ color: idx === 0 ? 'var(--chart-5)' : 'var(--muted-foreground)' }}>
                      {idx === 0 ? <Trophy size={14} /> : `#${idx + 1}`}
                    </span>

                    {/* Buyer info */}
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {buyer?.display_name || buyer?.full_name || `${bid.buyer_wallet.slice(0, 6)}…${bid.buyer_wallet.slice(-4)}`}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>
                          {bid.status === 'pending'
                            ? `Expires in ${timeLeft(bid.bid_expires_at) || 'soon'}`
                            : bid.status === 'accepted'
                            ? `Buyer has ${timeLeft(bid.accept_deadline) || '—'} to confirm`
                            : bid.status === 'confirmed'
                            ? 'Buyer is completing the on-chain tx…'
                            : bid.status}
                        </span>
                        <span>·</span>
                        {/* Standardized Lucide Icon for KYC Verification */}
                        {buyer?.identity_verified ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500 border border-emerald-500/20">
                            <ShieldCheck size={10} /> KYC Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-500 border border-amber-500/20">
                            <AlertCircle size={10} /> KYC Unverified
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quantity */}
                    <span className="text-sm font-semibold text-foreground">{bid.quantity}</span>

                    {/* Price */}
                    <span className="text-sm font-bold" style={{ color: 'var(--ring)' }}>
                      {bid.bid_price_per_token} ETH
                    </span>

                    {/* Action */}
                    <div>
                      {isAccepted ? (
                        <span className="flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-bold"
                          style={{ color: 'var(--chart-3)', background: 'color-mix(in srgb, var(--chart-3) 12%, transparent)' }}>
                          <CheckCircle2 size={11} /> Accepted
                        </span>
                      ) : isCounterAccepted ? (
                        <span className="flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-bold text-chart-3 bg-chart-3/15 border border-chart-3/30">
                          <CheckCircle2 size={11} /> Counter Accepted
                          {bid.counter_price_per_token && (
                            <span className="ml-1 opacity-75">@ {bid.counter_price_per_token} ETH</span>
                          )}
                        </span>
                      ) : bid.status === 'counter_offered' ? (
                        <span className="flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-bold text-chart-4 bg-chart-4/15 border border-chart-4/30">
                          <Handshake size={11} /> Counter Sent ({bid.counter_price_per_token} ETH)
                        </span>
                      ) : (bid.status === 'expired' || (bid.status === 'pending' && new Date(bid.bid_expires_at) < new Date())) ? (
                        <span className="flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-bold text-muted-foreground border border-border bg-muted/40">
                          Expired
                        </span>
                      ) : bid.status === 'rejected' ? (
                        <span className="flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-bold text-destructive border border-destructive/20 bg-destructive/10">
                          Rejected
                        </span>
                      ) : bid.status === 'counter_rejected' ? (
                        <span className="flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-bold text-muted-foreground border border-border bg-muted/40">
                          Buyer Declined Counter
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            onClick={() => handleAccept(bid.id)}
                            disabled={!!accepting || !!rejecting || !listing.seller_signature}
                            title={!listing.seller_signature ? 'Sign your listing first before accepting bids' : ''}
                            className="rounded-xl px-3 py-1.5 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ background: 'linear-gradient(135deg, var(--ring), var(--chart-5))' }}
                          >
                            {isAccepting ? <Loader2 size={12} className="animate-spin" /> : 'Accept'}
                          </button>

                          {/* shafqaat implemented — Fix P3: Counter-offer button */}
                          <button
                            onClick={() => setCounterModalBid(bid)}
                            disabled={!!accepting || !!rejecting}
                            className="flex items-center gap-1 rounded-xl border border-chart-4/40 bg-chart-4/10 px-2.5 py-1.5 text-xs font-semibold text-chart-4 hover:bg-chart-4/20 transition-colors"
                          >
                            <Handshake size={12} />
                            Counter
                          </button>

                          {/* Reject button — available for pending and counter_offered bids */}
                          <button
                            onClick={() => handleReject(bid.id)}
                            disabled={!!accepting || !!rejecting}
                            className="flex items-center gap-1 rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive hover:text-white transition-colors"
                          >
                            {isRejecting ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {!listing.seller_signature && (
                <div className="mt-2 flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-500">
                  <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                  <span>
                    You must sign your listing before you can accept bids. Check your wallet prompt or re-save your listing to attach an off-chain signature.
                  </span>
                </div>
              )}

              {/* shafqaat implemented — Fix P3: CounterOfferModal for sellers */}
              <CounterOfferModal
                isOpen={Boolean(counterModalBid)}
                onClose={() => setCounterModalBid(null)}
                bid={counterModalBid}
                onSuccess={loadBids}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page Component ──────────────────────────────────────────
export default function MyListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      setUserId(user.id);

      const { data, error: fetchErr } = await supabase
        .from('token_orders')
        .select(`
          id, campaign_id, price, quantity, quantity_remaining, quantity_filled,
          status, seller_signature, created_at,
          campaigns:campaign_id ( title, category, token_contract_address )
        `)
        .eq('investor_id', user.id)
        .eq('side', 'sell')
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;

      const normalized: Listing[] = (data || []).map((row: any) => ({
        ...row,
        price: Number(row.price),
        quantity: Number(row.quantity),
        quantity_remaining: Number(row.quantity_remaining),
        quantity_filled: Number(row.quantity_filled),
        campaign: Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns,
      }));

      setListings(normalized);
    } catch (err: any) {
      setError(err.message || 'Failed to load your listings');
      toast.error(err.message || 'Failed to load your listings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadListings(); }, [loadListings]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold">Secondary Marketplace</div>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-foreground">My Listings &amp; Bids</h1>
          <button
            onClick={loadListings}
            className="flex items-center gap-1.5 rounded-2xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:border-ring hover:text-foreground"
          >
            <RotateCcw size={13} /> Refresh
          </button>
        </div>
        <p className="text-sm text-muted-foreground max-w-xl">
          Review bids placed on your sell listings. Click on a listing to expand and see all bids — ranked by highest offer. Accept the best bid to notify the buyer.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-3xl border border-border bg-card p-12">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 rounded-3xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
          <AlertCircle size={18} className="flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card p-12 text-center">
          <p className="font-semibold text-foreground">No sell listings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Go to Marketplace or your Tokens page to list tokens for sale.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {listings.map((listing) => (
            <ListingRow key={listing.id} listing={listing} userId={userId || ''} onRefresh={loadListings} />
          ))}
        </div>
      )}
    </div>
  );
}
