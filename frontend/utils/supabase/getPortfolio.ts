// shafqaat — Utility functions to fetch portfolio data from Supabase
import { createClient } from "@/utils/supabase/client";
import { getEthPrice } from "@/utils/getEthPrice";

export interface CategoryBreakdown {
  category: string;
  totalValueUsd: number;
  percentage: number; // e.g., 45.5 for 45.5%
}

export interface UserPortfolioMetrics {
  totalNetWorthUsd: number;
  totalEthInvested: number;
  totalCampaignsBacked: number;
  investments?: any[]; 
  categoryDistribution: Record<string, number>; // { "AI": 0.6, "FinTech": 0.4 }
  categoryBreakdownList: CategoryBreakdown[];
}

// Fetch user's portfolio data (all their investments aggregated)
export async function getUserPortfolioData(): Promise<UserPortfolioMetrics> {
  const supabase = createClient();

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) 
      return {
      totalNetWorthUsd: 0,
      totalEthInvested: 0,
      totalCampaignsBacked: 0,
      categoryDistribution: {},
      categoryBreakdownList: [],
    };

    // Fetch all investments for the user
    const { data: investments, error: invError } = await supabase
      .from("investments")
      .select(`
        *,
        campaign:campaigns(id, title, category, price_per_token,status)
      `)
      .eq("investor_id", user.id)
      .in("status", ["completed", "claimed", "active"])
      .order("invested_at", { ascending: false });

    if (invError) {
      console.error("[getUserPortfolioData] Investments fetch error:", invError);
      return {
      totalNetWorthUsd: 0,
      totalEthInvested: 0,
      totalCampaignsBacked: 0,
      categoryDistribution: {},
      categoryBreakdownList: [],
    };
    }

    // Fetch user profile redundant , profile is already fetched in another function and can be cached and displayed
    // const { data: profile, error: profileError } = await supabase
    //   .from("profiles")
    //   .select("*")
    //   .eq("user_id", user.id)
    //   .single();

    // if (profileError && profileError.code !== "PGRST116") {
    //   console.error("[getUserPortfolioData] Profile fetch error:", profileError);
    // }

    // Fetch live ETH/USD price so all values are shown in real dollars
    const ethPrice = await getEthPrice();

    // Calculate portfolio metrics — amounts in DB are ETH, multiply by live price for USD
    const totalInvestedEth = (investments ?? []).reduce(
      (sum, inv) => sum + (parseFloat(inv.amount || "0") || 0),
      0
    );
    const totalInvested = totalInvestedEth * ethPrice; // real USD

    //redundant fetching , tokens are fetched in another function and result can be cached and displayed

    // Token count — use equity_tokens if stored, else derive from amount ÷ price_per_token
    // const totalTokens = (investments ?? []).reduce((sum, inv) => {
    //   const stored = parseFloat(inv.equity_tokens || "0") || 0;
    //   if (stored > 0) return sum + stored;
    //   const campaign = Array.isArray(inv.campaign) ? inv.campaign[0] : inv.campaign;
    //   const pricePerToken = parseFloat(campaign?.price_per_token || "0") || 0;
    //   const amountEth = parseFloat(inv.amount || "0") || 0;
    //   return sum + (pricePerToken > 0 ? amountEth / pricePerToken : 0);
    // }, 0);

    // Top campaign — the one with the highest individual ETH investment
    const topInvestment = (investments ?? []).reduce<any | null>((best, inv) => {
      const amt = parseFloat(inv.amount || "0") || 0;
      return !best || amt > (parseFloat(best.amount || "0") || 0) ? inv : best;
    }, null);
    const topCampaignRaw = topInvestment
      ? Array.isArray(topInvestment.campaign) ? topInvestment.campaign[0] : topInvestment.campaign
      : null;
    const topCampaign = topCampaignRaw
      ? { name: topCampaignRaw.title ?? "Campaign", amountEth: parseFloat(topInvestment.amount || "0") || 0 }
      : null;

    const categoryTotals: Record<string, number> = {};
    let overallPortfolioValueUsd = 0;
    let totalEthInvested = 0;
    const uniqueCampaignIds = new Set<string>();

    investments.forEach((inv: any) => {
      const campaign = Array.isArray(inv.campaign) ? inv.campaign[0] : inv.campaign;
      if (!campaign) return;

      uniqueCampaignIds.add(String(campaign.id));

      // ETH contributed to this campaign
      const invAmountEth = parseFloat(inv.amount || "0") || 0;
      totalEthInvested += invAmountEth;

      // Determine token quantity (either stored equity_tokens or calculated from price)
      const pptEth = parseFloat(campaign.price_per_token || "0.001") || 0.001;
      const storedTokens = parseFloat(inv.equity_tokens || "0") || 0;
      const tokenAmount = storedTokens > 0 ? storedTokens : invAmountEth / pptEth;

      // Current USD holding value for this investment
      const holdingValueUsd = tokenAmount * pptEth * ethPrice;
      const category = campaign.category || "Uncategorized";

      categoryTotals[category] = (categoryTotals[category] || 0) + holdingValueUsd;
      overallPortfolioValueUsd += holdingValueUsd;
    });

    // 3. Calculate category percentage weights
    const categoryDistribution: Record<string, number> = {};
    const categoryBreakdownList: CategoryBreakdown[] = [];

    Object.entries(categoryTotals).forEach(([cat, val]) => {
      const ratio = overallPortfolioValueUsd > 0 ? val / overallPortfolioValueUsd : 0;
      categoryDistribution[cat] = ratio; // Vector scale 0.0 to 1.0 for recommendation engine

      categoryBreakdownList.push({
        category: cat,
        totalValueUsd: val,
        percentage: parseFloat((ratio * 100).toFixed(2)),
      });
    });

    return {
      totalNetWorthUsd:  totalInvested,
      totalEthInvested:    totalInvestedEth,
      investments,
      totalCampaignsBacked: uniqueCampaignIds.size,
      categoryDistribution,
      categoryBreakdownList,
    };
  } catch (err) {
    console.error("[getUserPortfolioData] Exception:", err);
    return {
      totalNetWorthUsd: 0,
      totalEthInvested: 0,
      totalCampaignsBacked: 0,
      categoryDistribution: {},
      categoryBreakdownList: [],
    };
  }
}

// Fetch token holdings with aggregation
export async function getUserTokenHoldings() {
  const supabase = createClient();

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // 1. Fetch claimed tokens joined with campaign details
    const { data: userTokens, error } = await supabase
      .from("tokens")
      .select(`
        *,
        campaign:campaigns(id, title, category, price_per_token, contract_address, token_symbol, postmoney_valuation_eth)
      `)
      .eq("user_id", user.id);

    if (error) {
      console.error("[getUserTokenHoldings] Supabase error:", error);
      return [];
    }

    // 2. Fetch live ETH/USD price for fiat value calculation
    const ethPrice = await getEthPrice();

    // 3. Fetch trade history for campaigns
    const campaignIds = Array.from(new Set((userTokens ?? []).map(t => t.campaign_id)));
    const { data: allTrades } = campaignIds.length > 0
      ? await supabase.from("token_trades").select("campaign_id, price, executed_at").in("campaign_id", campaignIds).order("executed_at", { ascending: true })
      : { data: [] };

    // 4. Group token holdings by campaign_id
    const holdingsMap = new Map<string, any>();

    (userTokens ?? []).forEach((tokenRecord) => {
      const campaignId = String(tokenRecord.campaign_id);
      const campaign = Array.isArray(tokenRecord.campaign)
        ? tokenRecord.campaign[0]
        : tokenRecord.campaign;

      const campaignTitle = campaign?.title || "Unknown";
      const symbol = tokenRecord.token_symbol || campaign?.token_symbol || campaignTitle.split(" ")[0].toUpperCase();
      
      const pptEth = parseFloat(campaign?.price_per_token || "0.001") || 0.001;
      const pricePerTokenUsd = pptEth * ethPrice;
      const tokenAmount = parseFloat(tokenRecord.amount || "0") || 0;

      // Extract real trades for this campaign
      const campTrades = (allTrades ?? []).filter(t => String(t.campaign_id) === campaignId);
      const priceHistory = campTrades.map(t => ({
        price: Number(t.price) * ethPrice,
        priceEth: Number(t.price),
        time: new Date(t.executed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));

      if (priceHistory.length === 0) {
        priceHistory.push({ price: pricePerTokenUsd, priceEth: pptEth, time: 'Launch' });
      }

      const latestPrice = priceHistory[priceHistory.length - 1].price;
      const firstPrice = priceHistory[0].price;
      const realChange24h = firstPrice > 0 ? ((latestPrice - firstPrice) / firstPrice) * 100 : 0;

      if (!holdingsMap.has(campaignId)) {
        holdingsMap.set(campaignId, {
          id: campaignId,
          name: campaignTitle,
          symbol: symbol,
          contractAddress: campaign?.contract_address,
          balance: 0,
          price: latestPrice,       // USD per token
          priceEth: pptEth,          // ETH per token
          pricePerToken: pptEth, //ETH per token
          ethPrice,                  // Live ETH/USD rate
          value: 0,
          amount: tokenAmount,
          change24h: Number(realChange24h.toFixed(2)),
          color: generateColorForToken(campaignId),
          priceHistory,
          campaignId,
          totalInvested: 0,
          postmoneyValuation: parseFloat(String(campaign?.postmoney_valuation_eth || "0")),
        });
      }

      const holding = holdingsMap.get(campaignId)!;
      holding.balance += tokenAmount;
      holding.value = holding.balance * holding.price;
      holding.totalInvested += tokenAmount * pricePerTokenUsd;
    });

    return Array.from(holdingsMap.values());
  } catch (err) {
    console.error("[getUserTokenHoldings] Exception:", err);
    return [];
  }
}

// Generate mock price history for charts (in production, fetch from price oracle)
function generateMockPriceHistory(): number[] {
  const history = [];
  let price = 100;
  for (let i = 0; i < 30; i++) {
    price += (Math.random() - 0.48) * 10;
    history.push(Math.max(price, 10));
  }
  return history;
}

// Generate consistent color for each token based on ID
function generateColorForToken(tokenId: string): string {
  const colors = [
    "#FF6B6B",
    "#4ECDC4",
    "#45B7D1",
    "#FFA07A",
    "#98D8C8",
    "#F7DC6F",
    "#BB8FCE",
    "#85C1E2",
    "#F8B88B",
    "#AED6F1",
  ];
  const hash = tokenId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// Calculate portfolio allocation by campaign
export async function getPortfolioAllocation() {
  const supabase = createClient();

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: investments, error } = await supabase
      .from("investments")
      .select(`
        amount,
        campaign:campaigns(title)
      `)
      .eq("investor_id", user.id)
      .eq("status", "completed");

    if (error) {
      console.error("[getPortfolioAllocation] Supabase error:", error);
      return [];
    }

    const totalValue = (investments ?? []).reduce(
      (sum, inv) => sum + (parseFloat(inv.amount || "0") || 0),
      0
    );

    return (investments ?? []).map((inv) => {
      const campaign = Array.isArray(inv.campaign) ? inv.campaign[0] : inv.campaign;
      return {
        name: campaign?.title || "Unknown",
        value: parseFloat(inv.amount || "0") || 0,
        percentage: totalValue > 0 ? ((parseFloat(inv.amount || "0") || 0) / totalValue) * 100 : 0,
      };
    });
  } catch (err) {
    console.error("[getPortfolioAllocation] Exception:", err);
    return [];
  }
}

// Calculate portfolio value over time (mock data for charts)
export function generatePortfolioTimeSeries(investments: any[]): any[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];
  const baseValue = investments.reduce((sum, inv) => sum + (parseFloat(inv.amount || "0") || 0), 0);

  return months.map((month, index) => ({
    month,
    value: baseValue * (1 + (index * 0.02 + (Math.random() - 0.5) * 0.05)), // Mock growth
  }));
}
