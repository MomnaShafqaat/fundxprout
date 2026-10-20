// frontend/lib/marketplace-api.ts
import { createClient } from '@/utils/supabase/client';
import { ethers } from "ethers";
import CampaignABI from "@/abis/BusinessCampaign.json";

export enum CampaignState {
  Active = 0,
  Failed = 1,
  Funded = 2,
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export type OrderRequest = {
  campaign_id: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  wallet_address : string | undefined ;
  // shafqaat implemented — Fix P3: optional auto-accept threshold price
  auto_accept_price_per_token?: number;
  // Automated auction fields
  listing_mode?: 'manual' | 'auto';
  listing_deadline?: string;
  min_bid_price_per_token?: number;
};

export type OrderResponse = { order: any };

export type MarketplaceSellOrder = {
  id: string;
  campaign_id: string;
  investor_id: string;
  price: string | number;
  quantity: string | number;
  quantity_remaining: string | number;
  created_at: string;
  token_symbol: string;
  seller_wallet_address: string | null;
  // Automated auction fields
  listing_mode?: 'manual' | 'auto';
  listing_deadline?: string | null;
  min_bid_price_per_token?: number | null;
  campaign: {
    id: string;
    title: string | null;
    category: string | null;
    token_contract_address: string | null;
    secondary_trading_enabled: boolean;
  } | null;
};

async function authHeaders(walletAddress?: string) {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) throw new Error('You must be signed in to trade.');

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(walletAddress ? { 'x-wallet-address': walletAddress } : {}),
  };
}

export async function createOrder(payload: OrderRequest): Promise<OrderResponse> {
  const supabase = createClient();

  //verify campaign state to be completed 

    // 1. Fetch the campaign smart contract address from Supabase
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("contract_address, status")
    .eq("id", payload.campaign_id)
    .single();

  if (campaignError || !campaign?.contract_address) {
    throw new Error("Campaign or contract address not found.");
  }

  // 2. Query the on-chain campaign contract
  const rpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL || "https://rpc.sepolia.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const campaignContract = new ethers.Contract(
    campaign.contract_address,
    CampaignABI.abi || CampaignABI,
    provider
  );

  // 3. Read the startup struct
  const startupData = await campaignContract.startup();

  // 3. Verify on-chain completion criteria
  // Adjust these view functions based on your Campaign.sol contract:
  // e.g. checking state enum, isFinalized, checkGoalReached, or deadline
  // Destructure either by index or named property (Ethers v6 supports both)
  const state: CampaignState = Number(startupData.state ?? startupData[6]);
  const amountRaised: bigint = startupData.amountRaised ?? startupData[4];
  const fundingGoal: bigint = startupData.fundingGoal ?? startupData[2];

  // 4. Validate that the campaign is successfully funded
  const isFunded = state === CampaignState.Funded || amountRaised >= fundingGoal;

  console.log("contract state" , state, amountRaised)
  if (!isFunded) {
    throw new Error(
      "Cannot create secondary market order: Campaign is not yet successfully Funded."
    );
  }
  const walletAddress = payload.wallet_address;
  // 5. Attach normalized wallet address to payload
  const normalizedWallet = walletAddress ? walletAddress.toLowerCase() : undefined;
  const enrichedPayload: OrderRequest = {
    ...payload,
    wallet_address: normalizedWallet,
  };

  const res = await fetch(`${API_BASE}/api/marketplace/orders`, {
    method: 'POST',
    headers: await authHeaders(walletAddress),
    body: JSON.stringify(enrichedPayload),
  });

  if (!res.ok) {
    let errBody: any = null;
    try { errBody = await res.json(); } catch { /* ignore */ }
    throw new Error(errBody?.error || res.statusText || 'Marketplace API error');
  }
  return res.json();
}

export async function getOrderBook(campaignId: string) {
  const res = await fetch(`${API_BASE}/api/marketplace/orders/book/${campaignId}`);
  if (!res.ok) throw new Error('Failed to load order book');
  return res.json();
}

export async function getOpenSellOrders(): Promise<{ orders: MarketplaceSellOrder[] }> {
  const res = await fetch(`${API_BASE}/api/marketplace/orders/sell`);
  if (!res.ok) throw new Error('Failed to load marketplace listings');
  return res.json();
}

export async function cancelSellOrder(orderId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/marketplace/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    let errBody: any = null;
    try { errBody = await res.json(); } catch { /* ignore */ }
    throw new Error(errBody?.error || 'Failed to cancel order');
  }
  return res.json();
}

export async function getTokenAnalytics(campaignId: string) {
  const res = await fetch(`${API_BASE}/api/marketplace/analytics/${campaignId}`);
  if (!res.ok) throw new Error('Failed to load token analytics');
  return res.json();
}

export async function getTradeHistory(campaignId: string) {
  const res = await fetch(`${API_BASE}/api/marketplace/trades/${campaignId}`);
  if (!res.ok) throw new Error('Failed to load trade history');
  return res.json();
}

export async function getHoldings(campaignId: string): Promise<{ available_balance: number; locked_balance: number }> {
  const res = await fetch(`${API_BASE}/api/marketplace/holdings/${campaignId}`, {
    method: 'GET',
    headers: await authHeaders(),
  });

  if (!res.ok) {
    let errBody: any = null;
    try { errBody = await res.json(); } catch { /* ignore */ }
    throw new Error(errBody?.error || 'Failed to load marketplace holdings');
  }

  return res.json();
}

export async function validateSellOrderBalance(
  userId: string,
  campaignId: string,
  sellQuantityWei: bigint, // Accepts the bigint parsed by parseUnits
  decimals: number = 18
): Promise<{ isValid: boolean; availableBalanceWei: bigint; error?: string }> {
  try {
    const supabase = createClient();
    // 1. Fetch total owned tokens
    const { data: tokenHoldings, error: tokenError } = await supabase
      .from('tokens')
      .select('amount')
      .eq('user_id', userId)
      .eq('campaign_id', campaignId);

    if (tokenError) throw tokenError;

    // Convert each row amount to BigInt wei
    const totalOwnedWei = (tokenHoldings || []).reduce((acc, row) => {
      const valStr = String(row.amount ?? '0');
      return acc + ethers.parseUnits(valStr, decimals);
    }, BigInt(0));

    // 2. Fetch active sell orders
    const { data: activeOrders, error: orderError } = await supabase
      .from('token_orders')
      .select('quantity_remaining')
      .eq('investor_id', userId)
      .eq('campaign_id', campaignId)
      .eq('side', 'sell')
      .in('status', ['open', 'partially_filled']);

    if (orderError) throw orderError;

    // Convert each remaining quantity to BigInt wei
    const lockedTokensWei = (activeOrders || []).reduce((acc, row) => {
      const valStr = String(row.quantity_remaining ?? '0');
      return acc + ethers.parseUnits(valStr, decimals);
    }, BigInt(0));

    // 3. Compute available balance in wei
    const availableBalanceWei = totalOwnedWei - lockedTokensWei;

    if (sellQuantityWei > availableBalanceWei) {
      const availableReadable = ethers.formatUnits(availableBalanceWei, decimals);
      const lockedReadable = ethers.formatUnits(lockedTokensWei, decimals);

      return {
        isValid: false,
        availableBalanceWei,
        error: `Insufficient available tokens. You have ${availableReadable} available (${lockedReadable} locked in active sell orders).`,
      };
    }

    return { isValid: true, availableBalanceWei };
  } catch (err: any) {
    return {
      isValid: false,
      availableBalanceWei: BigInt(0),
      error: err.message || 'Failed to validate token balance.',
    };
  }
}