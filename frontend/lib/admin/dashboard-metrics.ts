import { unstable_cache } from "next/cache";
import { createClient } from "@/utils/supabase/client";
import { ethers } from "ethers";

export const getAdminMetrics = unstable_cache(
  async () => {
    const supabase = await createClient();

    const [
      { count: pendingCount },
      { data: liveCampaigns, count: liveCount },
      { count: fundedCount },
      { data: escrowRows },
      { data: tradingData },
      { data: pendingCampaigns },
    ] = await Promise.all([
      supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("status", "in_review"),
      supabase.from("campaigns").select("id, contract_address", { count: "exact" }).eq("status", "launched"),
      supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("goal_reached", true),
      supabase.from("escrow_accounts").select("balance"),
      supabase.from("marketplace_daily_volume").select("trade_date, volume_usd, trade_count").order("trade_date", { ascending: true }).limit(30),
      supabase.from("campaigns").select("id, title, owner, funding_goal, valuation, created_at, status").eq("status", "in_review").order("created_at", { ascending: false }),
    ]);

    // On-chain RPC balances
    const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL);
    const validAddresses = (liveCampaigns ?? []).filter(
      (c): c is { id: string; contract_address: string } =>
        Boolean(c.contract_address && ethers.isAddress(c.contract_address))
    );

    const balances = await Promise.all(
      validAddresses.map(async (c) => {
        try {
          return await provider.getBalance(c.contract_address);
        } catch {
          return BigInt(0);
        }
      })
    );

    const totalEscrowWei = balances.reduce((acc, bal) => acc + bal, BigInt(0));
    const totalEscrowEth = ethers.formatEther(totalEscrowWei);

    return {
      pendingCount: pendingCount ?? 0,
      liveCount: liveCount ?? 0,
      fundedCount: fundedCount ?? 0,
      totalEscrowEth,
      tradingData: tradingData ?? [],
      pendingCampaigns: pendingCampaigns ?? [],
      lastUpdated: new Date().toISOString(),
    };
  },
  ["admin-dashboard-metrics"], // Cache key
  {
    revalidate: 300, // Background refresh every 5 minutes (TTL safety net)
    tags: ["admin-metrics"], // Cache tag for instant purging
  }
);