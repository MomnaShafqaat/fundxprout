'use client';

import { useState } from 'react';
import { X, Gavel, AlertCircle, CheckCircle, Loader2, Trophy, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useWallet } from '@/context/WalletContext';
import { placeBid } from '@/lib/bidding-api';
import type { MarketplaceSellOrder } from '@/lib/marketplace-api';
import FairPriceIndicator from '@/components/bidding/FairPriceIndicator';

type Props = {
  order: MarketplaceSellOrder;
  onClose: () => void;
  onBidPlaced: () => void;
};

export default function PlaceBidModal({ order, onClose, onBidPlaced }: Props) {
  const { walletAddress, connectWallet } = useWallet();
  const [bidPrice, setBidPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expiryDays, setExpiryDays] = useState('7');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isAuto = order.listing_mode === 'auto';
  const askingPrice = Number(order.price);
  const minBidFloor = order.min_bid_price_per_token ? Number(order.min_bid_price_per_token) : null;
  const maxQty = Number(order.quantity_remaining);
  const bidPriceNum = Number(bidPrice);
  const quantityNum = Number(quantity);
  const totalEth = bidPriceNum > 0 && quantityNum > 0
    ? (bidPriceNum * quantityNum).toFixed(6)
    : '—';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!walletAddress) {
      await connectWallet();
      setError('Wallet connected. Please submit your bid again.');
      return;
    }

    if (!bidPrice || bidPriceNum <= 0) {
      setError('Enter a valid bid price per token.');
      return;
    }
    if (minBidFloor && bidPriceNum < minBidFloor) {
      setError(`Bid must be at least the seller floor price of ${minBidFloor} ETH per token.`);
      return;
    }
    if (!quantity || quantityNum <= 0 || quantityNum > maxQty) {
      setError(`Enter a quantity between 1 and ${maxQty}.`);
      return;
    }

    try {
      setSubmitting(true);
      await placeBid({
        listing_id: order.id,
        bid_price_per_token: bidPriceNum,
        quantity: quantityNum,
        buyer_wallet: walletAddress,
        bid_expires_days: Number(expiryDays) || 7,
      });
      setSuccess(true);
      toast.success(
        isAuto
          ? 'Bid placed! The highest bid when the auction deadline ends will automatically win.'
          : 'Bid placed! The seller will review and notify you if accepted.',
        { duration: 6000 }
      );
      setTimeout(() => {
        onBidPlaced();
        onClose();
      }, 2000);
    } catch (err: any) {
      const msg = err.message || 'Failed to place bid. Please try again.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-2xl"
              style={{ background: 'color-mix(in srgb, var(--ring) 18%, transparent)' }}
            >
              <Gavel size={17} style={{ color: 'var(--ring)' }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Place a Bid</h2>
              <p className="text-xs text-muted-foreground truncate max-w-[220px]">
                {order.campaign?.title || 'Token listing'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* Automated Auction Banner */}
        {isAuto && (
          <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-1 text-xs">
            <div className="flex items-center justify-between font-bold text-amber-500">
              <span className="flex items-center gap-1.5">
                <Trophy size={14} /> Automated Auction
              </span>
              {order.listing_deadline && (
                <span className="flex items-center gap-1 font-normal opacity-90">
                  <Clock size={12} />
                  Ends: {new Date(order.listing_deadline).toLocaleString()}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              When the deadline passes, the highest bid wins automatically. The winner will then be able to Confirm & Pay for tokens.
            </p>
            {minBidFloor && (
              <p className="text-[11px] font-semibold text-foreground pt-0.5">
                Minimum bid floor: {minBidFloor} ETH/token
              </p>
            )}
          </div>
        )}

        {/* Listing reference price */}
        <div
          className="mb-4 rounded-2xl border px-4 py-3 text-sm"
          style={{
            borderColor: 'color-mix(in srgb, var(--ring) 25%, transparent)',
            background: 'color-mix(in srgb, var(--ring) 6%, transparent)',
            color: 'var(--ring)',
          }}
        >
          Seller asking: <strong>{askingPrice} ETH/token</strong> · {maxQty} tokens available
        </div>

        {/* AI Fair Price Panel */}
        <FairPriceIndicator
          campaignId={order.campaign_id}
          listingPrice={askingPrice}
          onApplyFairPrice={(price) => setBidPrice(String(price))}
          className="mb-5"
        />

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle size={40} style={{ color: 'var(--chart-3)' }} />
            <p className="font-semibold text-foreground">Bid placed!</p>
            <p className="text-sm text-muted-foreground">
              {isAuto
                ? 'The highest bid at the auction deadline will automatically win the auction!'
                : 'The seller will review your bid and notify you if accepted.'}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Bid Price */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Your Bid Price (ETH per token)
              </label>
              <input
                type="number"
                step="0.000001"
                min={minBidFloor || 0.000001}
                placeholder={`e.g. ${minBidFloor || askingPrice}`}
                value={bidPrice}
                onChange={(e) => setBidPrice(e.target.value)}
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring"
                required
                suppressHydrationWarning
              />
              {/* Live deviation hint vs AI fair value */}
              {bidPriceNum > 0 && (
                <p className="mt-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                  {minBidFloor && bidPriceNum < minBidFloor
                    ? `⚠️ Below minimum floor of ${minBidFloor} ETH`
                    : bidPriceNum > askingPrice * 1.15
                    ? '⚠️ Your bid is well above the listing price'
                    : bidPriceNum < askingPrice * 0.50
                    ? '📉 Very low vs listing'
                    : bidPriceNum >= askingPrice
                    ? '✅ High bid — strong chance of winning auction'
                    : '💡 Bid placed in auction pool'}
                </p>
              )}
            </div>

            {/* Quantity */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quantity (max {maxQty})
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max={maxQty}
                placeholder={`1 – ${maxQty}`}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            {/* Expiry */}
            {!isAuto ? (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Bid valid for (days)
                </label>
                <select
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-ring"
                >
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 px-3.5 py-2.5 rounded-xl border border-border/50">
                <Clock size={13} className="text-amber-500 flex-shrink-0" />
                <span>
                  Bid window closes automatically at the auction deadline (
                  {order.listing_deadline ? new Date(order.listing_deadline).toLocaleDateString() : 'scheduled'}
                  ).
                </span>
              </div>
            )}

            {/* Total Preview */}
            <div className="rounded-2xl border border-border bg-background/60 px-4 py-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Estimated total you'll pay</span>
                <span className="font-bold text-foreground">{totalEth} ETH</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                ETH is only sent if the seller accepts your bid and you confirm the purchase.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Wallet warning */}
            {!walletAddress && (
              <p className="text-xs text-muted-foreground text-center">
                You'll be asked to connect your wallet when submitting.
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full rounded-2xl py-3 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, var(--ring), var(--chart-5))' }}
            >
              {submitting ? <><Loader2 size={14} className="animate-spin" /> Placing bid…</> : 'Place Bid'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
