'use server';

import { createClient } from "@/utils/supabase/server";
import { convertUsdToEth } from "@/lib/common";

export async function updateApprovedCampaign(campaignData: {
  campaignId: string | number;
  title: string;
  description: string;
  goal: string | number;
  duration: string | number;
  category: string;
  imageUrl?: string | null;
  tokenSymbol: string;
  pricePerToken: string | number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };
  if (!campaignData.campaignId) return { error: "Missing campaign identifier." };

  // 1. Fetch current campaign to verify ownership and read approved valuation
  const { data: existing, error: fetchErr } = await supabase
    .from("campaigns")
    .select("id, status, valuation, funding_goal, equity_offered, equity_retained")
    .eq("id", campaignData.campaignId)
    .eq("owner", user.id)
    .maybeSingle();

  if (fetchErr || !existing) {
    return { error: "Campaign not found or you lack permission to modify it." };
  }

  const currentStatus = existing.status?.toLowerCase();
  if (!["approved", "adjusted"].includes(currentStatus)) {
    return { error: "This operation is only permitted for approved or adjusted campaigns." };
  }

  // 2. Lock to the compliance-approved valuation
  const verifiedValuation = Number(existing.valuation ?? 0);
  const newGoal = Number(campaignData.goal || 0);

  if (newGoal <= 0) {
    return { error: "Funding goal must be greater than zero." };
  }

  // 3. Recalculate post-money valuation and dilution
  const { ethAmount } = await convertUsdToEth(verifiedValuation);
  const postMoney = ethAmount + newGoal;
  let equityOffered = existing.equity_offered;
  let equityRetained = existing.equity_retained;

  if (postMoney > 0) {
    equityOffered = Number(((newGoal / postMoney) * 100).toFixed(4));
    equityRetained = Number((100 - equityOffered).toFixed(4));
  }

  // 4. Update editable fields without touching valuation or IPFS documents
  const { error: updateError } = await supabase
    .from("campaigns")
    .update({
      title: campaignData.title,
      description: campaignData.description,
      funding_goal: newGoal,
      duration: Number(campaignData.duration),
      category: campaignData.category,
      image_url: campaignData.imageUrl ?? null,
      token_symbol: campaignData.tokenSymbol.trim(),
      price_per_token: Number(campaignData.pricePerToken),
      // Preserve verified valuation & update dilution
      valuation: verifiedValuation,
      equity_offered: equityOffered,
      equity_retained: equityRetained,
      updated_at: new Date().toISOString(),
      postmoney_valuation_eth: postMoney,
    })
    .eq("id", campaignData.campaignId)
    .eq("owner", user.id);

  if (updateError) {
    return { error: updateError.message };
  }
  return { success: true, campaignId: campaignData.campaignId };
}