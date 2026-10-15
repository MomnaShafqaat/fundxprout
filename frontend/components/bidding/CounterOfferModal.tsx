'use client';

// frontend/components/bidding/CounterOfferModal.tsx
// Modal allowing sellers to send a counter-offer to a prospective buyer

import { useState } from 'react';
import { X, Handshake, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { counterBid, type TokenBid } from '@/lib/bidding-api';
import FairPriceIndicator from '@/components/bidding/FairPriceIndicator';

// shafqaat implemented — Fix P3: Modal for seller to send a counter-offer to a buyer
interface CounterOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  bid: TokenBid | null;
  onSuccess: () => void;
}

export default function CounterOfferModal({
  isOpen,
  onClose,
  bid,
  onSuccess,
}: CounterOfferModalProps) {
  const [counterPrice, setCounterPrice] = useState<string>('');
  const [counterMessage, setCounterMessage] = useState<string>('');
  const [expiryHours, setExpiryHours] = useState<number>(48);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen || !bid) return null;

  const originalPrice = Number(bid.bid_price_per_token);
  const quantity = Number(bid.quantity);
  const parsedPrice = parseFloat(counterPrice || '0');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bid || parsedPrice <= 0) {
      toast.error('Please enter a valid counter price');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await counterBid(bid.id, {
        counter_price_per_token: parsedPrice,
        counter_message: counterMessage.trim() || undefined,
        counter_expires_hours: expiryHours,
      });

      toast.success(res.message || 'Counter-offer sent to buyer!');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send counter-offer');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl p-6 overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-chart-5/10 text-chart-5">
              <Handshake className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Send Counter-Offer</h2>
              <p className="text-xs text-muted-foreground">
                Negotiate terms with buyer ({bid.buyer_wallet.slice(0, 6)}...{bid.buyer_wallet.slice(-4)})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="py-4 space-y-4">
          <div className="p-3 rounded-xl bg-muted/40 border border-border/50 text-xs space-y-1.5">
            <div className="flex justify-between text-muted-foreground">
              <span>Buyer's Current Offer:</span>
              <span className="font-semibold text-foreground">{originalPrice} ETH/token</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Requested Quantity:</span>
              <span className="font-semibold text-foreground">{quantity} tokens</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Original Total:</span>
              <span className="font-semibold text-foreground">{(originalPrice * quantity).toFixed(6)} ETH</span>
            </div>
          </div>

          {/* AI Fair Price — gives seller market context before setting counter */}
          <FairPriceIndicator
            campaignId={bid.campaign_id}
            listingPrice={originalPrice}
            onApplyFairPrice={(price) => setCounterPrice(String(price))}
          />

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Your Counter Price per Token (ETH) <span className="text-destructive">*</span>
            </label>
            <input
              type="number"
              step="any"
              min="0.000001"
              placeholder="e.g. 0.05"
              value={counterPrice}
              onChange={(e) => setCounterPrice(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Message to Buyer (Optional note)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Can meet in the middle at this price..."
              value={counterMessage}
              onChange={(e) => setCounterMessage(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Counter Expiry Window (Hours)
            </label>
            <select
              value={expiryHours}
              onChange={(e) => setExpiryHours(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value={24}>24 Hours</option>
              <option value={48}>48 Hours (Recommended)</option>
              <option value={72}>72 Hours</option>
            </select>
          </div>

          {parsedPrice > 0 && (
            <div className="p-3 rounded-xl bg-chart-5/10 border border-chart-5/20 flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Total Counter Value:</span>
              <span className="font-bold text-chart-5">
                {(parsedPrice * quantity).toFixed(6)} ETH
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || parsedPrice <= 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send Counter-Offer'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
