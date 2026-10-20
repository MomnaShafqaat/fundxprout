'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '@/context/WalletContext';
import { createOrder, validateSellOrderBalance } from '@/lib/marketplace-api';
import { signListing } from '@/lib/bidding-api';
import { useAuth } from '@/context/auth-context';

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

type OrderFormProps = {
  campaignId: string;
  tokenAddress?: string | null;
  defaultSide?: 'buy' | 'sell';
  wallet_address?: string;
};

// EIP-712 domain and type definitions matching the smart contract exactly.
// The seller signs this off-chain — zero gas, just a MetaMask popup.
// The signature is stored in DB so buyers can call fillOrder() later.
const EIP712_DOMAIN = {
  name: 'EquityMarketplace',
  version: '1',
  chainId: 11155111, // Sepolia
  verifyingContract: process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined,
};

const ORDER_TYPES = {
  Order: [
    { name: 'seller',         type: 'address'  },
    { name: 'tokenAddress',   type: 'address'  },
    { name: 'tokenAmount',    type: 'uint256'  },
    { name: 'pricePerToken',  type: 'uint256'  },
    { name: 'nonce',          type: 'uint256'  },
    { name: 'expiry',         type: 'uint256'  },
  ],
};

export default function OrderForm({ campaignId, tokenAddress, defaultSide = 'buy' }: OrderFormProps) {
  const { walletAddress, connectWallet } = useWallet();
  const [side, setSide] = useState<'buy' | 'sell'>(defaultSide);
  const { user } = useAuth();  const [price, setPrice] = useState('0.001');
  const [quantity, setQuantity] = useState('1');
  // shafqaat implemented — Fix P3: Auto-accept threshold price on sell listings
  const [autoAcceptPrice, setAutoAcceptPrice] = useState('');
  // Automated auction mode controls
  const [listingMode, setListingMode] = useState<'manual' | 'auto'>('manual');
  const [listingDeadline, setListingDeadline] = useState('');
  const [minBidPrice, setMinBidPrice] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const marketplaceAddress = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS;

  function setPresetDeadline(hours: number) {
    const d = new Date(Date.now() + hours * 3600 * 1000);
    // Format to YYYY-MM-DDTHH:mm for datetime-local
    const pad = (n: number) => String(n).padStart(2, '0');
    const localIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setListingDeadline(localIso);
  }

  async function placeOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);

    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!window.ethereum) return setStatusMessage('Please install MetaMask.');
    if (!tokenAddress || !ethers.isAddress(tokenAddress)) return setStatusMessage('This campaign does not have a valid token contract address.');

    if (side === 'sell' && listingMode === 'auto') {
      if (!listingDeadline) {
        setStatusMessage('Please select an auction end deadline for automated auction mode.');
        return;
      }
      if (new Date(listingDeadline).getTime() <= Date.now()) {
        setStatusMessage('Auction deadline must be a future date and time.');
        return;
      }
    }

    try {
      setIsSubmitting(true);
      const amount = ethers.parseUnits(quantity, 18);
      const pricePerToken = ethers.parseEther(price);
      if (amount <= BigInt(0) || pricePerToken <= BigInt(0)) throw new Error('Price and quantity must be greater than zero.');

      if (side === 'sell') {
        // ── Step 1: Validate available token balance ──────────────────
        const validation = await validateSellOrderBalance(user!.id, campaignId, amount);
        console.log('Sell order validation result:', validation);

        if (!validation.isValid) {
          setStatusMessage(validation.error || 'Insufficient available tokens.');
          setIsSubmitting(false);
          return;
        }

        if (!marketplaceAddress || !ethers.isAddress(marketplaceAddress)) {
          throw new Error('Marketplace contract address is not configured.');
        }

        // ── Step 2: Approve marketplace to transfer tokens on-chain (if not already approved) ───
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
        const currentAllowance: bigint = await token.allowance(walletAddress, marketplaceAddress).catch(() => BigInt(0));

        if (currentAllowance < amount) {
          setStatusMessage('Step 1/3 — Approving marketplace to transfer your tokens (one-time gas cost)…');
          const approval = await token.approve(marketplaceAddress, amount);
          await approval.wait();
        }
      }

      // ── Step 3: Save the order to DB ──────────────────────────────
      setStatusMessage(side === 'sell' ? 'Step 2/3 — Saving sell order to marketplace…' : 'Saving buy order to marketplace…');
      const { order: dbOrder } = await createOrder({
        campaign_id: campaignId,
        side,
        price: Number(price),
        quantity: Number(quantity),
        wallet_address: walletAddress,
        // shafqaat implemented — Fix P3: pass auto_accept_price_per_token to marketplace order
        auto_accept_price_per_token: autoAcceptPrice ? Number(autoAcceptPrice) : undefined,
        // Automated auction flow parameters
        listing_mode: side === 'sell' ? listingMode : 'manual',
        listing_deadline: (side === 'sell' && listingMode === 'auto' && listingDeadline) ? new Date(listingDeadline).toISOString() : undefined,
        min_bid_price_per_token: (side === 'sell' && minBidPrice) ? Number(minBidPrice) : undefined,
      });

      // ── Step 4 (sell only): Sign the order with MetaMask — EIP-712 ─
      // This is FREE (no gas). The signature is stored in the DB.
      // Without this, bids placed on this listing cannot be settled on-chain.
      if (side === 'sell' && dbOrder?.id) {
        try {
          if (!marketplaceAddress || !ethers.isAddress(marketplaceAddress)) {
            throw new Error('Marketplace contract address missing — cannot sign listing.');
          }

          setStatusMessage('Step 3/3 — Sign your listing with MetaMask to enable bid settlement (free, no gas)…');
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();

          // Nonce = timestamp-based; unique per listing
          const nonce = Date.now();
          // Expiry = 30 days from now
          const expiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

          const orderValue = {
            seller:        walletAddress,
            tokenAddress:  tokenAddress,
            tokenAmount:   amount,
            pricePerToken: pricePerToken,
            nonce:         BigInt(nonce),
            expiry:        BigInt(expiry),
          };

          const domain = {
            ...EIP712_DOMAIN,
            chainId: (await provider.getNetwork()).chainId,
            verifyingContract: marketplaceAddress as `0x${string}`,
          };

          const signature = await signer.signTypedData(domain, ORDER_TYPES, orderValue);

          // Save signature to DB with expiry for backend EIP-712 verification
          // shafqaat implemented — Fix P1: Pass expiry to signListing
          await signListing(dbOrder.id, signature, nonce, expiry);
          setStatusMessage('✅ Listing signed and saved. Buyers can now place bids on your listing!');
        } catch (signErr: any) {
          // Non-blocking: order exists but without signature. Show warning.
          console.warn('[OrderForm] Seller rejected signing:', signErr);
          setStatusMessage(
            '⚠️ Sell order saved but not signed. Go to My Listings to sign it later — buyers cannot complete purchases until you sign.',
          );
        }
      } else {
        setStatusMessage(
          side === 'sell'
            ? 'Sell order saved. Sign your listing in My Listings to enable bid settlement.'
            : 'Buy order placed in the order book. Matching happens automatically when a sell order crosses your price.',
        );
      }
    } catch (error) {
      console.error('Order placement failed:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Order transaction failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-6">
      <div className="mb-5">
        <div className="text-sm font-semibold text-foreground">Place a marketplace order</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {side === 'sell'
            ? 'Sell orders require a token approval + an off-chain signature (both prompted by MetaMask). The signature enables bid settlement without extra on-chain steps later.'
            : 'Buy orders are placed in the order book and auto-match when a sell order crosses your price.'}
        </p>
      </div>
      <form className="space-y-4" onSubmit={placeOrder}>
        <label className="block text-xs font-semibold text-muted-foreground">Side
          <select value={side} onChange={(event) => setSide(event.target.value as 'buy' | 'sell')} className="mt-2 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="buy">Buy</option><option value="sell">Sell</option>
          </select>
        </label>

        {/* Sell Mode Selector: Manual vs Automated Auction */}
        {side === 'sell' && (
          <div className="rounded-2xl border border-border/80 bg-background/50 p-3.5 space-y-3">
            <label className="block text-xs font-semibold text-muted-foreground">Listing Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setListingMode('manual')}
                className={`rounded-xl px-3 py-2 text-xs font-bold transition flex items-center justify-center gap-1.5 border ${
                  listingMode === 'manual'
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                Manual Pick
              </button>
              <button
                type="button"
                onClick={() => {
                  setListingMode('auto');
                  if (!listingDeadline) setPresetDeadline(72); // default 3 days
                }}
                className={`rounded-xl px-3 py-2 text-xs font-bold transition flex items-center justify-center gap-1.5 border ${
                  listingMode === 'auto'
                    ? 'border-amber-500 bg-amber-500 text-white shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                🏆 Auto Auction
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {listingMode === 'manual'
                ? 'Manual: You will review incoming bids and choose the winning bid yourself at any time.'
                : 'Automated: The system automatically picks the highest bidder when the deadline passes!'}
            </p>

            {/* Auction Deadline & Floor settings when Auto is selected */}
            {listingMode === 'auto' && (
              <div className="space-y-3 pt-2 border-t border-border/50">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-foreground">Auction End Deadline</label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPresetDeadline(24)}
                        className="px-2 py-0.5 rounded-lg border border-border text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition"
                      >
                        +24h
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresetDeadline(72)}
                        className="px-2 py-0.5 rounded-lg border border-border text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition"
                      >
                        +3d
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresetDeadline(168)}
                        className="px-2 py-0.5 rounded-lg border border-border text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition"
                      >
                        +7d
                      </button>
                    </div>
                  </div>
                  <input
                    type="datetime-local"
                    required
                    value={listingDeadline}
                    onChange={(e) => setListingDeadline(e.target.value)}
                    className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Minimum Bid Floor Price (ETH) — <span className="font-normal opacity-80">Optional</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="e.g. 0.001 (bids lower than this will be rejected)"
                    value={minBidPrice}
                    onChange={(e) => setMinBidPrice(e.target.value)}
                    className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-muted-foreground">Price per token (ETH)
            <input required type="number" min="0" step="any" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-2 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Quantity
            <input required type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-2 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
        </div>
        {/* shafqaat implemented — Fix P3: Optional auto-accept price field for sellers */}
        {side === 'sell' && listingMode === 'manual' && (
          <label className="block text-xs font-semibold text-muted-foreground">
            Auto-Accept Threshold Price (ETH) — <span className="font-normal opacity-80">Optional</span>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 0.002 (bids at or above this are accepted instantly)"
              value={autoAcceptPrice}
              onChange={(event) => setAutoAcceptPrice(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
        )}
        <button type="submit" disabled={isSubmitting} className="inline-flex w-full items-center justify-center rounded-3xl bg-ring px-4 py-3 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-60">
          {isSubmitting ? 'Submitting…' : `Place ${side} order`}
        </button>
        {statusMessage && <div className="rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm text-foreground">{statusMessage}</div>}
      </form>
    </div>
  );
}
