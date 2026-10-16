'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Search, Gavel } from 'lucide-react';
import PlaceBidModal from '@/components/Marketplace/PlaceBidModal';
import { getOpenSellOrders, type MarketplaceSellOrder } from '@/lib/marketplace-api';

function numeric(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortAddress(address: string | null) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Unknown';
}

function ListingCard({
  order,
  onBidPlaced,
}: {
  order: MarketplaceSellOrder;
  onBidPlaced: () => void;
}) {
  const [showBidModal, setShowBidModal] = useState(false);
  const quantity = numeric(order.quantity_remaining);
  const price = numeric(order.price);
  const isAuto = order.listing_mode === 'auto';

  return (
    <>
      <article className="overflow-hidden rounded-3xl border border-border bg-card p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-foreground">{order.campaign?.title || 'Token listing'}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {order.campaign?.category || 'Uncategorized'} · seller {shortAddress(order.seller_wallet_address)}
              </p>
              {!order.seller_wallet_address && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Seller must link their wallet before this order can be traded.
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {isAuto && (
                <span className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-500">
                  🏆 Auto Auction
                </span>
              )}
              <span className="rounded-2xl border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                For sale
              </span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border bg-background/80 p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Tokens</div>
              <div className="mt-1 font-semibold text-foreground">{quantity}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/80 p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Asking Price</div>
              <div className="mt-1 font-semibold text-foreground">{price} ETH</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/80 p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {order.min_bid_price_per_token ? 'Min Bid Floor' : 'Total'}
              </div>
              <div className="mt-1 font-semibold text-foreground">
                {order.min_bid_price_per_token ? `${numeric(order.min_bid_price_per_token)} ETH` : `${(quantity * price).toFixed(6)} ETH`}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => setShowBidModal(true)}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold shadow-md transition hover:opacity-90 active:scale-[0.99]"
            style={{
              background: 'var(--ring)',
              color: 'var(--primary-foreground, #ffffff)',
            }}
          >
            <Gavel size={16} />
            Place Bid
          </button>

          <Link
            href={`/investor-dashboard/marketplace/${order.campaign_id}`}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:border-ring hover:text-foreground"
          >
            Market <ArrowRight size={15} />
          </Link>
        </div>
      </article>

      {showBidModal && (
        <PlaceBidModal
          order={order}
          onClose={() => setShowBidModal(false)}
          onBidPlaced={() => {
            setShowBidModal(false);
            onBidPlaced();
          }}
        />
      )}
    </>
  );
}

export default function InvestorMarketplacePage() {
  const [orders, setOrders] = useState<MarketplaceSellOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getOpenSellOrders();
      setOrders(result.orders || []);
    } catch (err) {
      console.error(err);
      setError('Unable to load token listings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) =>
      [order.campaign?.title, order.campaign?.category, order.campaign?.token_contract_address]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [orders, search]);

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold">Investor Marketplace</div>
        <h1 className="text-3xl font-bold text-foreground">Tokens for sale</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Browse active sell orders. Place a bid with your own offer to win tokens via automated auction or seller review.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search token listings…" className="w-full rounded-3xl border border-border bg-card px-12 py-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring" />
        </div>
        <div className="text-sm text-muted-foreground">{filteredOrders.length} listing{filteredOrders.length === 1 ? '' : 's'} available</div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-border bg-card p-8 text-center text-muted-foreground">Loading token listings…</div>
      ) : error ? (
        <div className="rounded-3xl border border-border bg-card p-8 text-center text-destructive">{error}</div>
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card p-8 text-center text-muted-foreground">No active token sell orders match your search.</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredOrders.map((order) => (
            <ListingCard
              key={order.id}
              order={order}
              onBidPlaced={loadOrders}
            />
          ))}
        </div>
      )}
    </div>
  );
}
