'use client';

import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import {
  Gavel, Clock, CheckCircle2, XCircle, AlertTriangle,
  Loader2, ChevronRight, RotateCcw, ExternalLink,
  ArrowUpCircle, Handshake, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getMyBids,
  cancelBid,
  confirmBid,
  completeBid,
  acceptCounter,
  rejectCounter,
  type TokenBid,
} from '@/lib/bidding-api';
import { useWallet } from '@/context/WalletContext';
import BidCostModal from '@/components/bidding/BidCostModal';
import ModifyBidModal from '@/components/bidding/ModifyBidModal';

// ── Status badge helper ───────────────────────────────────────────
function StatusBadge({ status }: { status: TokenBid['status'] }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    pending:          { label: 'Pending',           color: 'var(--chart-5)', bg: 'color-mix(in srgb, var(--chart-5) 12%, transparent)' },
    auto_accepted:    { label: '🏆 Auction Won!',    color: '#f59e0b',        bg: 'rgba(245,158,11,0.12)' },
    counter_offered:  { label: 'Counter-Offer!',    color: 'var(--chart-4)', bg: 'color-mix(in srgb, var(--chart-4) 15%, transparent)' },
    counter_accepted: { label: 'Counter Accepted',  color: 'var(--chart-3)', bg: 'color-mix(in srgb, var(--chart-3) 12%, transparent)' },
    counter_rejected: { label: 'Counter Declined',  color: 'var(--muted-foreground)', bg: 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)' },
    accepted:         { label: 'Accepted!',         color: 'var(--chart-3)', bg: 'color-mix(in srgb, var(--chart-3) 12%, transparent)' },
    confirmed:        { label: 'Confirming',        color: 'var(--ring)',    bg: 'color-mix(in srgb, var(--ring) 12%, transparent)' },
    completed:        { label: 'Completed',         color: '#22c55e',        bg: 'rgba(34,197,94,0.1)' },
    rejected:         { label: 'Rejected',          color: 'var(--destructive)', bg: 'color-mix(in srgb, var(--destructive) 10%, transparent)' },
    cancelled:        { label: 'Cancelled',         color: 'var(--muted-foreground)', bg: 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)' },
    expired:          { label: 'Expired',           color: 'var(--muted-foreground)', bg: 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)' },
  };
  const style = map[status] ?? map.pending;
  return (
    <span
      className="inline-flex items-center rounded-xl px-2.5 py-1 text-[11px] font-bold"
      style={{ color: style.color, background: style.bg }}
    >
      {style.label}
    </span>
  );
}

// shafqaat implemented — Fix P2: Dynamic live 24-hour countdown timer ticking every second
function CountdownTimer({ deadline, label = 'Window' }: { deadline: string | null; label?: string }) {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) return;

    function update() {
      const diff = Math.floor((new Date(deadline!).getTime() - Date.now()) / 1000);
      setSecondsRemaining(diff > 0 ? diff : 0);
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (!deadline || secondsRemaining === null) return null;

  if (secondsRemaining <= 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-destructive/15 text-destructive text-xs font-semibold">
        <AlertTriangle size={11} /> Expired
      </span>
    );
  }

  const h = Math.floor(secondsRemaining / 3600);
  const m = Math.floor((secondsRemaining % 3600) / 60);
  const s = secondsRemaining % 60;

  const isUrgent = h < 2;
  const isWarning = h < 12;

  const cls = isUrgent
    ? 'bg-destructive/15 text-destructive border border-destructive/30 animate-pulse'
    : isWarning
    ? 'bg-chart-4/15 text-chart-4 border border-chart-4/30'
    : 'bg-chart-3/15 text-chart-3 border border-chart-3/30';

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-mono text-xs font-bold ${cls}`}>
      <Clock size={12} />
      <span>{label}: {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>
    </div>
  );
}

function timeLeft(isoDate: string | null) {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

// ABI for the existing fillOrder() function
const MARKETPLACE_ABI = [
  'function fillOrder(address seller, address tokenAddress, uint256 tokenAmount, uint256 pricePerToken, uint256 nonce, uint256 expiry, bytes calldata sellerOrderSignature, uint256 kycDeadline, bytes calldata kycSignature) payable',
];

// ── Main component ───────────────────────────────────────────────
export default function MyBidsPage() {
  const { walletAddress, connectWallet } = useWallet();
  const [bids, setBids] = useState<TokenBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<Record<string, string>>({});
  // shafqaat implemented — modals state for cost breakdown and offer increase
  const [costModalBid, setCostModalBid] = useState<TokenBid | null>(null);
  const [modifyModalBid, setModifyModalBid] = useState<TokenBid | null>(null);
  const [walletBalanceEth, setWalletBalanceEth] = useState<string | null>(null);

  useEffect(() => {
    async function checkBalance() {
      if (walletAddress && typeof window !== 'undefined' && window.ethereum) {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const bal = await provider.getBalance(walletAddress);
          setWalletBalanceEth(parseFloat(ethers.formatEther(bal)).toFixed(4));
        } catch (e) {
          console.warn('Could not fetch wallet balance', e);
        }
      }
    }
    checkBalance();
  }, [walletAddress]);

  const loadBids = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getMyBids();
      setBids(result.bids || []);
    } catch (err: any) {
      const msg = err.message || 'Failed to load your bids';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBids(); }, [loadBids]);

  function setStep(bidId: string, msg: string) {
    setProgressMsg((prev) => ({ ...prev, [bidId]: msg }));
  }
  function clearStep(bidId: string) {
    setProgressMsg((prev) => { const n = { ...prev }; delete n[bidId]; return n; });
  }

  // ── Cancel a pending bid ────────────────────────────────────
  async function handleCancel(bidId: string) {
    setProcessingId(bidId);
    const toastId = toast.loading('Cancelling your bid…');
    try {
      await cancelBid(bidId);
      setBids((prev) => prev.map((b) => b.id === bidId ? { ...b, status: 'cancelled' } : b));
      toast.success('Bid cancelled successfully.', { id: toastId });
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel bid.', { id: toastId });
    } finally {
      setProcessingId(null);
    }
  }

  // shafqaat implemented — Fix P3: Accept seller's counter-offer
  async function handleAcceptCounter(bidId: string) {
    setProcessingId(bidId);
    const toastId = toast.loading('Accepting counter-offer…');
    try {
      await acceptCounter(bidId);
      toast.success('Counter-offer accepted! You can now proceed to confirm your purchase.', { id: toastId });
      await loadBids();
    } catch (err: any) {
      toast.error(err.message || 'Failed to accept counter-offer', { id: toastId });
    } finally {
      setProcessingId(null);
    }
  }

  // shafqaat implemented — Fix P3: Decline seller's counter-offer
  async function handleRejectCounter(bidId: string) {
    setProcessingId(bidId);
    const toastId = toast.loading('Declining counter-offer…');
    try {
      await rejectCounter(bidId);
      toast.success('Counter-offer declined.', { id: toastId });
      await loadBids();
    } catch (err: any) {
      toast.error(err.message || 'Failed to decline counter-offer', { id: toastId });
    } finally {
      setProcessingId(null);
    }
  }

  // ── Confirm purchase (accepted bid) → call fillOrder() on-chain ──
  async function handleConfirmPurchase(bid: TokenBid) {
    if (!walletAddress) {
      await connectWallet();
      toast.info('Wallet connected — click Confirm Purchase again.');
      return;
    }

    const marketplaceAddress = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS;
    if (!marketplaceAddress || !ethers.isAddress(marketplaceAddress)) {
      toast.error('Marketplace contract not configured. Contact support.');
      return;
    }

    setProcessingId(bid.id);
    const toastId = toast.loading('Preparing settlement…');
    try {
      // 1. Get settlement data from backend (marks bid as 'confirmed')
      setStep(bid.id, 'Getting KYC authorization…');
      toast.loading('Getting KYC authorization from server…', { id: toastId });
      const { settlement_data } = await confirmBid(bid.id);

      const {
        seller_wallet,
        seller_signature,
        seller_nonce,
        token_contract_address,
        quantity,
        price_per_token,
      } = settlement_data;

      if (!seller_signature) throw new Error('Seller has not signed this listing yet. Contact the seller.');
      if (!token_contract_address) throw new Error('Token contract address is missing from this listing.');

      // 2. Expiry guard: seller signed with a 7-day window from listing creation
      //    We use listing_created_at if available; otherwise recompute safely.
      const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
      const tokenAmount = ethers.parseUnits(String(quantity), 18);
      const pricePerToken = ethers.parseEther(String(price_per_token));
      const totalEth = (tokenAmount * pricePerToken) / ethers.WeiPerEther;

      // 3. Get KYC authorization signature from backend
      toast.loading('Verifying KYC credentials…', { id: toastId });
      const kycRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/marketplace/kyc-signature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await (await import('@/utils/supabase/client')).createClient().auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({
          buyer_wallet: walletAddress,
          seller_wallet,
          chain_id: 11155111,
        }),
      });
      if (!kycRes.ok) {
        const kycErr = await kycRes.json().catch(() => ({}));
        throw new Error(kycErr.error || 'KYC authorization failed — ensure both you and the seller are KYC-verified.');
      }
      const { kycSignature, kycDeadline } = await kycRes.json();

      toast.loading('Please confirm in MetaMask…', { id: toastId });
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const marketplace = new ethers.Contract(marketplaceAddress, MARKETPLACE_ABI, signer);

      const tx = await marketplace.fillOrder(
        seller_wallet,
        token_contract_address,
        tokenAmount,
        pricePerToken,
        seller_nonce,
        expiry,
        seller_signature,
        kycDeadline,
        kycSignature,
        { value: totalEth },
      );

      toast.loading('Waiting for on-chain confirmation…', { id: toastId });
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        toast.loading('Syncing database…', { id: toastId });
        await completeBid(bid.id, tx.hash, receipt.blockNumber);
        setBids((prev) => prev.map((b) => b.id === bid.id ? { ...b, status: 'completed', tx_hash: tx.hash } : b));
        toast.success(
          <span className="flex items-center gap-2">
            Trade complete!{' '}
            <a
              href={`https://sepolia.etherscan.io/tx/${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline flex items-center gap-1"
            >
              View on Etherscan <ExternalLink size={11} />
            </a>
          </span>,
          { id: toastId, duration: 8000 },
        );
      }
    } catch (err: any) {
      console.error('[handleConfirmPurchase]', err);
      // Handle MetaMask user rejection gracefully
      const msg = err.code === 4001 || err.code === 'ACTION_REJECTED'
        ? 'Transaction cancelled in MetaMask.'
        : err.message || 'Transaction failed.';
      toast.error(msg, { id: toastId });
      await loadBids();
    } finally {
      setProcessingId(null);
      clearStep(bid.id);
    }
  }

  // Helper to check if deadline/expiry has passed
  const isBidExpired = (b: any) => {
    if (b.status === 'expired') return true;
    if (['accepted', 'confirmed', 'counter_accepted', 'auto_accepted'].includes(b.status) && b.accept_deadline) {
      return new Date(b.accept_deadline).getTime() < Date.now();
    }
    if (b.status === 'counter_offered' && b.counter_expires_at) {
      return new Date(b.counter_expires_at).getTime() < Date.now();
    }
    if (b.status === 'pending' && b.bid_expires_at) {
      return new Date(b.bid_expires_at).getTime() < Date.now();
    }
    return false;
  };

  // ── Render ───────────────────────────────────────────────────
  // shafqaat implemented — active bids include counter states and auto_accepted
  const activeBids = bids.filter(
    (b) => ['pending', 'auto_accepted', 'accepted', 'confirmed', 'counter_offered', 'counter_accepted'].includes(b.status) && !isBidExpired(b)
  );
  const historicBids = bids.filter(
    (b) => ['completed', 'rejected', 'cancelled', 'expired', 'counter_rejected'].includes(b.status) || isBidExpired(b)
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold">Secondary Marketplace</div>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-foreground">My Bids</h1>
          <button
            onClick={loadBids}
            className="flex items-center gap-1.5 rounded-2xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:border-ring hover:text-foreground"
          >
            <RotateCcw size={13} />
            Refresh
          </button>
        </div>
        <p className="text-sm text-muted-foreground max-w-xl">
          Track all bids you have placed on token listings. When a seller accepts your bid, you will see a <strong className="text-foreground">Confirm Purchase</strong> button here.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-3xl border border-border bg-card p-12">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 rounded-3xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
          <AlertTriangle size={18} className="flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : bids.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card p-12 text-center">
          <Gavel size={36} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-semibold text-foreground">No bids yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Go to the Marketplace and click "Place Bid" on any listing to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Active bids */}
          {activeBids.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Active Bids</h2>
              <div className="flex flex-col gap-3">
                {activeBids.map((bid) => {
                  const campaign = bid.token_orders?.campaigns;
                  const isAccepted = ['accepted', 'confirmed', 'counter_accepted', 'auto_accepted'].includes(bid.status);
                  const isAutoWon = bid.status === 'auto_accepted';
                  const isCounterOffered = bid.status === 'counter_offered';
                  const isProcessing = processingId === bid.id;
                  const step = progressMsg[bid.id];
                  const effectivePrice = isAccepted && bid.counter_price_per_token
                    ? Number(bid.counter_price_per_token)
                    : Number(bid.bid_price_per_token);

                  return (
                    <div
                      key={bid.id}
                      className="rounded-3xl border border-border bg-card p-5 transition"
                      style={isAccepted ? {
                        borderColor: 'color-mix(in srgb, var(--chart-3) 40%, transparent)',
                        boxShadow: '0 0 24px color-mix(in srgb, var(--chart-3) 12%, transparent)',
                      } : isCounterOffered ? {
                        borderColor: 'color-mix(in srgb, var(--chart-4) 40%, transparent)',
                        boxShadow: '0 0 24px color-mix(in srgb, var(--chart-4) 12%, transparent)',
                      } : {}}
                    >
                      {/* Auction Won banner — shown for auto_accepted bids */}
                      {isAutoWon && (
                        <div
                          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm font-semibold"
                          style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}
                        >
                          <div className="flex items-center gap-2">
                            <span>🏆</span>
                            <span>You won the auction! Confirm &amp; Pay within 24 hours to receive your tokens.</span>
                          </div>
                          <CountdownTimer deadline={bid.accept_deadline} label="Pay Before" />
                        </div>
                      )}

                      {/* Accepted banner with live countdown timer (manual accept) */}
                      {isAccepted && !isAutoWon && (
                        <div
                          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm font-semibold"
                          style={{ background: 'color-mix(in srgb, var(--chart-3) 12%, transparent)', color: 'var(--chart-3)' }}
                        >
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={16} />
                            <span>Your offer was accepted! Complete purchase before deadline.</span>
                          </div>
                          <CountdownTimer deadline={bid.accept_deadline} label="Time Left" />
                        </div>
                      )}

                      {/* shafqaat implemented — Fix 7 & P3: Counter-Offer Negotiation Panel */}
                      {isCounterOffered && (
                        <div className="mb-4 rounded-2xl border border-chart-4/30 bg-chart-4/10 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-chart-4 font-bold text-sm">
                              <Handshake size={16} />
                              <span>Seller Sent a Counter-Offer!</span>
                            </div>
                            <CountdownTimer deadline={bid.counter_expires_at} label="Counter Expires" />
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs bg-background/60 p-3 rounded-xl border border-border/40">
                            <div>
                              <span className="text-muted-foreground block text-[11px]">Your Original Offer</span>
                              <span className="font-semibold text-foreground text-sm">
                                {bid.original_bid_price || bid.bid_price_per_token} ETH/token
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground block text-[11px]">Seller's Counter Price</span>
                              <span className="font-bold text-chart-4 text-sm">
                                {bid.counter_price_per_token} ETH/token
                              </span>
                            </div>
                          </div>

                          {bid.counter_message && (
                            <p className="text-xs text-muted-foreground italic bg-muted/30 p-2.5 rounded-lg border border-border/30">
                              &ldquo;{bid.counter_message}&rdquo;
                            </p>
                          )}

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => handleAcceptCounter(bid.id)}
                              disabled={isProcessing}
                              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                              {isProcessing ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                              Accept Counter Offer
                            </button>
                            <button
                              onClick={() => handleRejectCounter(bid.id)}
                              disabled={isProcessing}
                              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                            >
                              {isProcessing ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                              Decline Counter
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">
                            {campaign?.title || 'Token listing'}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {campaign?.category || 'Uncategorized'} · {bid.quantity} tokens @ {effectivePrice} ETH/token
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Total Outlay: <strong className="text-foreground">{(bid.quantity * effectivePrice).toFixed(6)} ETH</strong>
                          </p>
                        </div>
                        <StatusBadge status={bid.status} />
                      </div>

                      {/* Expiry info */}
                      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                        <Clock size={12} />
                        {isAutoWon ? (
                          <span>Pay deadline: {timeLeft(bid.accept_deadline)}</span>
                        ) : isAccepted ? (
                          <span>Accept deadline: {timeLeft(bid.accept_deadline)}</span>
                        ) : isCounterOffered ? (
                          <span>Response deadline: {timeLeft(bid.counter_expires_at)}</span>
                        ) : (
                          <span>Bid expires: {timeLeft(bid.bid_expires_at)}</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {isAccepted && (
                          <button
                            onClick={() => setCostModalBid(bid)}
                            disabled={isProcessing}
                            className="flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-60 shadow-md hover:opacity-95"
                            style={{ background: 'linear-gradient(135deg, var(--chart-3), var(--ring))' }}
                          >
                            {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                            {isProcessing ? (step || 'Processing…') : (bid.status === 'confirmed' ? 'Complete Purchase' : 'Review & Confirm Purchase')}
                          </button>
                        )}

                        {bid.status === 'pending' && (
                          <>
                            {/* shafqaat implemented — Fix P3: Increase Offer button */}
                            <button
                              onClick={() => setModifyModalBid(bid)}
                              disabled={isProcessing}
                              className="flex items-center gap-1.5 rounded-2xl border border-primary/40 bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20"
                            >
                              <ArrowUpCircle size={13} />
                              Increase Offer
                            </button>

                            <button
                              onClick={() => handleCancel(bid.id)}
                              disabled={isProcessing}
                              className="flex items-center gap-1.5 rounded-2xl border border-border px-3.5 py-2 text-xs text-muted-foreground transition hover:border-destructive hover:text-destructive disabled:opacity-60"
                            >
                              {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={13} />}
                              Cancel Bid
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* History */}
          {historicBids.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Bid History</h2>
              <div className="flex flex-col gap-2">
                {historicBids.map((bid) => {
                  const campaign = bid.token_orders?.campaigns;
                  return (
                    <div key={bid.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card/60 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {campaign?.title || 'Token listing'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {bid.quantity} tokens @ {bid.bid_price_per_token} ETH/token
                          {bid.tx_hash && (
                            <a
                              href={`https://sepolia.etherscan.io/tx/${bid.tx_hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 inline-flex items-center gap-0.5 text-ring hover:underline"
                            >
                              Tx <ExternalLink size={10} />
                            </a>
                          )}
                        </p>
                      </div>
                      <StatusBadge status={bid.status} />
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* shafqaat implemented — Fix P2: Total cost breakdown modal with gas estimate */}
      <BidCostModal
        isOpen={Boolean(costModalBid)}
        onClose={() => setCostModalBid(null)}
        onConfirm={() => {
          if (costModalBid) {
            const b = costModalBid;
            setCostModalBid(null);
            handleConfirmPurchase(b);
          }
        }}
        quantity={costModalBid?.quantity || 1}
        pricePerToken={
          costModalBid?.counter_price_per_token
            ? Number(costModalBid.counter_price_per_token)
            : Number(costModalBid?.bid_price_per_token || 0)
        }
        campaignTitle={costModalBid?.token_orders?.campaigns?.title || 'Token Listing'}
        userWalletBalanceEth={walletBalanceEth}
        isLoading={processingId === costModalBid?.id}
        actionLabel="Execute Settlement On-Chain"
        isSettlement={true}
      />

      {/* shafqaat implemented — Fix P3: Modify bid (increase offer) modal */}
      <ModifyBidModal
        isOpen={Boolean(modifyModalBid)}
        onClose={() => setModifyModalBid(null)}
        bid={modifyModalBid}
        onSuccess={loadBids}
      />
    </div>
  );
}
