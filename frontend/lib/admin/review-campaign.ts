'use server'
import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

export async function adminReviewCampaign(
  campaignId: string,
  decision: "approve" | "adjust" | "reject",
  adjustedValuation?: string,
  rejectionReason?: string,
  internalNotes?: string,
) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };
  if (!campaignId) return { error: "Campaign ID is required" };

  if (decision === "adjust") {
    const parsedValuation = Number(adjustedValuation);
    if (!adjustedValuation || !Number.isFinite(parsedValuation) || parsedValuation <= 0) {
      return { error: "Enter a valuation greater than zero before adjusting the cap." };
    }
  }

  if (decision === "reject" && !rejectionReason?.trim()) {
    return { error: "A rejection reason is required." };
  }

  // 1. Fetch current campaign details for financial dilution calculations
  const { data: campaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("funding_goal, valuation")
    .eq("id", campaignId)
    .single();

  if (fetchError || !campaign) {
    return { error: "Campaign not found: unable to calculate equity breakdown." };
  }

  // 2. Compute equity metrics if decision is 'approve' or 'adjust'
  let update: Record<string, any> = {};

  if (decision === "reject") {
    update = { status: "rejected" };
  } else {
    const preMoneyValuation = decision === "adjust"
      ? Number(adjustedValuation)
      : Number(campaign.valuation ?? 0);

    const fundingGoal = Number(campaign.funding_goal ?? 0);
    const postMoneyValuation = preMoneyValuation + fundingGoal;

    let equityOffered = 0;
    let equityRetained = 100;

    if (postMoneyValuation > 0) {
      // Standard post-money dilution formula
      equityOffered = Number(((fundingGoal / postMoneyValuation) * 100).toFixed(4));
      equityRetained = Number((100 - equityOffered).toFixed(4));
    }

    update = {
      status: decision === "adjust" ? "adjusted" : "approved",
      valuation: preMoneyValuation,
      equity_offered: equityOffered,
      equity_retained: equityRetained,
    };
  }

  // 3. Persist campaign status and metrics
  const { data, error } = await supabase
    .from("campaigns")
    .update(update)
    .eq("id", campaignId)
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Only campaigns awaiting review can be changed." };

  const action = decision === "approve"
    ? "approved"
    : decision === "adjust"
      ? "approved_override"
      : "rejected";

  await logAdminAction(
    supabase,
    adminUser.id,
    action,
    "campaign",
    campaignId,
    decision === "adjust"
      ? `Admin adjusted campaign valuation cap to ${adjustedValuation}`
      : `Admin ${decision}d campaign valuation`,
  );

  // 4. Insert immutable audit trail into campaign_reviews
  const { error: reviewError } = await supabase
    .from('campaign_reviews')
    .insert({
      campaign_id: campaignId,
      admin_id: adminUser.id,
      action: action,
      rejection_reason: decision === "reject" ? rejectionReason?.trim() || null : null,
      internal_notes: internalNotes?.trim() || null,
      valuation_verified: decision !== "reject" ? update.valuation : null,
    });

  if (reviewError) {
    console.error("[adminReviewCampaign] Review audit log error:", reviewError);
  }

  revalidatePath("/admin-dashboard/audit-log");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/dashboard");
  return { success: true };
}

async function checkAdmin(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  if (user.user_metadata?.is_admin === true) return user;
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  return profile?.role === 'admin' ? user : null;
}

async function logAdminAction(supabase: any, adminId: string, action: string, targetType: string, targetId: string, reason?: string) {
  try {
    await supabase.from("admin_actions").insert([{
      admin_id: adminId,
      action,
      target_type: targetType,
      target_id: targetId,
      reason: reason || "Manual admin override",
    }]);
  } catch (e) {
    console.error("[logAdminAction] Error logging audit:", e);
  }
}