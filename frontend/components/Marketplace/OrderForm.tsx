'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '@/context/WalletContext';
import { createOrder, validateSellOrderBalance } from '@/lib/marketplace-api';
import { signListing } from '@/lib/bidding-api';
import { useAuth } from '@/context/auth-context';

const ERC20_ABI = ['function approve(address spender, uint256 value) returns (bool)'];

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
  const { user } = useAuth();
  const [price, setPrice] = useState('0.001');
  const [quantity, setQuantity] = useState('1');
  // shafqaat implemented — Fix P3: Auto-accept threshold price on sell listings
  const [autoAcceptPrice, setAutoAcceptPrice] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const marketplaceAddress = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS;

  async function placeOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);

    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!window.ethereum) return setStatusMessage('Please install MetaMask.');
    if (!tokenAddress || !ethers.isAddress(tokenAddress)) return setStatusMessage('This campaign does not have a valid token contract address.');

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

        // ── Step 2: Approve marketplace to transfer tokens on-chain ───
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        setStatusMessage('Step 1/3 — Approving marketplace to transfer your tokens (one-time gas cost)…');
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
        const approval = await token.approve(marketplaceAddress, amount);
        await approval.wait();
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-muted-foreground">Price per token (ETH)
            <input required type="number" min="0" step="any" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-2 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Quantity
            <input required type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-2 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
        </div>
        {/* shafqaat implemented — Fix P3: Optional auto-accept price field for sellers */}
        {side === 'sell' && (
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
