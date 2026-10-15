//action.ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/admin";

// Helper: convert a Pinata CID to a public gateway URL
const cidToUrl = (cid: string | null | undefined) =>
  cid ? `https://gateway.pinata.cloud/ipfs/${cid}` : null;

type AppRole = "owner" | "investor";
type SignupState = {
  error: string;
  success: string;
};

const normalizeRole = (role: string | null | undefined): AppRole | null => {
  const value = (role || "").trim().toLowerCase();
  if (value === "owner" || value === "business_owner") return "owner";
  if (value === "investor") return "investor";
  return null;
};

const getRoleRedirect = (role: AppRole) =>
  role === "owner" ? "/dashboard" : "/investor-dashboard/overview";

const deriveFullName = (user: any) => {
  const fromMetadata =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    `${user?.user_metadata?.first_name || ""} ${user?.user_metadata?.last_name || ""}`.trim();

  if (fromMetadata && fromMetadata.trim()) return fromMetadata.trim();
  if (user?.email) return user.email.split("@")[0];
  return "User";
};

// 1. Google Login Action
export async function signInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      // Redirect to the callback route we created in Step 4
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (data.url) {
    redirect(data.url); // Send user to Google
  }
}

export async function completeOAuthSignIn() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false, error: "Unable to resolve signed-in user" };
  }

  if (!user.id) {
    return { ok: false, error: "Unable to resolve signed-in user" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (profileError?.code === "PGRST116") {
    return { ok: true, redirectTo: "/auth/select-role" };
  }

  if (profileError) {
    return { ok: false, error: "Unable to read user profile" };
  }

  const roleFromProfile = normalizeRole(profile?.role);
  if (!roleFromProfile) {
    return { ok: true, redirectTo: "/auth/select-role" };
  }

  return {
    ok: true,
    redirectTo: getRoleRedirect(roleFromProfile),
  };
}

export async function saveRoleFromProfileForm(
  prevState: { error?: string },
  formData: FormData,
) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: "You must be signed in to continue." };
  }

  const role = normalizeRole(formData.get("role") as string);
  if (!role) {
    return { error: "Please choose Owner or Investor." };
  }

  const fullName =
    ((formData.get("fullName") as string) || "").trim() || deriveFullName(user);

  const { error: profileError } = await supabase.from("profiles").upsert(
    [
      {
        user_id: user.id,
        role,
        full_name: fullName,
      },
    ],
    { onConflict: "user_id" },
  );

  if (profileError) {
    return { error: "Failed to save role. Please try again." };
  }

  await supabase.auth.updateUser({
    data: {
      ...(user.user_metadata || {}),
      user_role: role,
      full_name: fullName,
    },
  });

  redirect(getRoleRedirect(role));
}

// 2. Email Login Action
export async function login(prevState: string | undefined, formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("[login] Auth error:", error.message);
    return "Invalid credentials"; // Return error to frontend
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    console.error("[login] Unable to get user ID");
    return "Unable to load user session";
  }

  console.log("[login] User authenticated:", user.id);

  const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

  if (profileError?.code === "PGRST116") {
    console.log("[login] No profile found, redirecting to role selection");
    redirect("/auth/select-role");
  }

  if (profileError) {
    console.error("[login] Profile fetch error:", profileError.message);
    return "Unable to load profile";
  }

  const roleFromProfile = normalizeRole(profile?.role);
  console.log("[login] User role from profile:", profile?.role, "normalized:", roleFromProfile);

  if (!roleFromProfile) {
    console.log("[login] Invalid role, redirecting to role selection");
    redirect("/auth/select-role");
  }

  const redirectUrl = getRoleRedirect(roleFromProfile);
  console.log("[login] Redirecting to:", redirectUrl, "for role:", roleFromProfile);
  redirect(redirectUrl);
}

export async function signup(
  prevState: SignupState,
  formData: FormData,
) {
  const supabase = await createClient();

  // 1. Get form data
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const fullName = formData.get("fullName") as string;
  //const userRole = formData.get("userRole") as string;

  // 2. Validate role
  // const normalizedRole = normalizeRole(userRole);
  // if (!normalizedRole) {
  //   return { error: "Please select a valid account type" };
  // }

  // 3. Determine the "Redirect URL" for email confirmation
  // We need to tell Supabase where to send the user after they click the link in their email.
  const origin = (await headers()).get("origin");

  // 4. Call Supabase Sign Up
  const { data: authData, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // This ensures they come back to YOUR site, not Supabase's default
      emailRedirectTo: `${origin}/auth/callback`,
      data: {
        full_name: fullName,
        //user_role: normalizedRole, // Store role in auth metadata
      },
    },
  });

  if (error) {
    console.error(error.code + " " + error.message);
    return { error: error.message, success: "" };
  }

  // 5. Insert user profile row with user_id, full_name, and role
  if (authData?.user?.id) {
    const { error: profileError } = await supabase.from("profiles").insert([
      {
        user_id: authData.user.id,
        full_name: fullName,
        //role: normalizedRole,
      },
    ]);

    if (profileError) {
      console.error("[signup] Profile insert error:", profileError.message);
      // Don't fail signup if profile insert fails, just log it
    }
  }

  return {
    error: "",
    success: "Account created successfully. Redirecting you to the login screen...",
  };
}

export async function logOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

declare global {
  interface Window {
    ethereum?: any;
  }
}
async function ensureUserProfileExists(supabase: any, userId: string) {
  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .single();

  if (profileError && profileError.code !== "PGRST116") {
    throw profileError;
  }

  if (!existingProfile) {
    const { error: upsertError } = await supabase
      .from("profiles")
      .upsert([{ user_id: userId }], { onConflict: "user_id" });

    if (upsertError) {
      throw upsertError;
    }
  }
}

export async function saveCampaignToDb(formData: any) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  await ensureUserProfileExists(supabase, user.id);

  // Build the row — store both the raw CID and the clickable IPFS gateway URL
  const row = {
    title: formData.title,
    token_symbol: formData.tokenSymbol,
    description: formData.description,
    funding_goal: formData.goal,
    duration: formData.duration,
    category: formData.category,
    owner: user.id,
    status: "launched",
    valuation: formData.valuation ?? null,
    transaction_hash: formData.txHash,
    contract_address: formData.contractAddress , 
    token_contract_address: formData.tokenContractAddress ,
    price_per_token: formData.pricePerToken,
    image_url: formData.imageUrl ?? null,
    // ── IPFS CIDs (raw hash for on-chain verification) ─────────────
    pitch_deck_cid: formData.pitchDeckCid ?? null,
    business_plan_cid: formData.businessPlanCid ?? null,
    financials_cid: formData.financialsCid ?? null,
    use_of_funds_cid: formData.useOfFundsCid ?? null,
    product_demo_cid: formData.productDemoCid ?? null,
    // ── IPFS gateway URLs (human-readable, clickable links) ─────────
    pitch_deck_url: cidToUrl(formData.pitchDeckCid),
    business_plan_url: cidToUrl(formData.businessPlanCid),
    financials_url: cidToUrl(formData.financialsCid),
    use_of_funds_url: cidToUrl(formData.useOfFundsCid),
    product_demo_url: cidToUrl(formData.productDemoCid),
  };

  console.log(
    "[saveCampaignToDb] Inserting row:",
    JSON.stringify(row, null, 2),
  );

  const campaignQuery = formData.campaignId
    ? supabase
        .from("campaigns")
        .update(row)
        .eq("id", formData.campaignId)
        .eq("owner", user.id)
        .in("status", ["approved", "adjusted"])
        .select()
        .single()
    : supabase.from("campaigns").insert([row]).select().single();

  const { data, error } = await campaignQuery;

  if (error) {
    console.error("[saveCampaignToDb] Supabase error:", error.message);
    if (error.message?.includes("campaigns_owner_fkey")) {
      return {
        error:
          "Unable to save campaign: your Supabase profile record is missing. Please complete your creator profile first.",
      };
    }
    return { error: error.message };
  }

  console.log("[saveCampaignToDb] Saved campaign id:", data?.id);
  return { success: true, campaignId: data?.id };
}

// shafqaat — Save/update creator profile (KYC + KYB + basic info)
// Uses UPSERT so it works for both first-time create and subsequent updates
// Save Draft Campaign (without blockchain deployment)
export async function saveDraftCampaign(draftData: any) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  await ensureUserProfileExists(supabase, user.id);

  // Build the row for draft campaign
  const row = {
    title: draftData.title,
    description: draftData.description,
    funding_goal: draftData.goal,
    duration: draftData.duration,
    category: draftData.category,
    owner: user.id,
    image_url: draftData.imageUrl ?? null,
    token_symbol: draftData.tokenSymbol?.trim() || null,
    price_per_token: draftData.pricePerToken || null,
    valuation: draftData.valuation || null,
    status: "draft",
    pitch_deck_cid: draftData.pitchDeckCid ?? null,
    business_plan_cid: draftData.businessPlanCid ?? null,
    financials_cid: draftData.financialsCid ?? null,
    use_of_funds_cid: draftData.useOfFundsCid ?? null,
    product_demo_cid: draftData.productDemoCid ?? null,
    pitch_deck_url: cidToUrl(draftData.pitchDeckCid),
    business_plan_url: cidToUrl(draftData.businessPlanCid),
    financials_url: cidToUrl(draftData.financialsCid),
    use_of_funds_url: cidToUrl(draftData.useOfFundsCid),
    product_demo_url: cidToUrl(draftData.productDemoCid),
  };

  // When editing an existing draft, update that row instead of inserting a new one
  if (draftData.campaignId) {
    console.log(
      "[saveDraftCampaign] Updating draft row:",
      JSON.stringify(row, null, 2),
    );

    const { error } = await supabase
      .from("campaigns")
      .update(row)
      .eq("id", draftData.campaignId)
      .eq("owner", user.id)
      .eq("status", "draft");

    if (error) {
      console.error("[saveDraftCampaign] Supabase update error:", error.message);
      return { error: error.message };
    }

    console.log("[saveDraftCampaign] Updated draft campaign id:", draftData.campaignId);
    return { success: true, campaignId: draftData.campaignId };
  }

  console.log(
    "[saveDraftCampaign] Inserting draft row:",
    JSON.stringify(row, null, 2),
  );

  const { data, error } = await supabase
    .from("campaigns")
    .insert([row])
    .select()
    .single();

  if (error) {
    console.error("[saveDraftCampaign] Supabase error:", error.message);
    if (error.message?.includes("campaigns_owner_fkey")) {
      return {
        error:
          "Unable to save draft: your Supabase profile record is missing. Please complete your creator profile first.",
      };
    }
    return { error: error.message };
  }

  console.log("[saveDraftCampaign] Saved draft campaign id:", data?.id);
  return { success: true, campaignId: data?.id };
}

export async function submitCampaignForReview(campaignId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };
  if (!campaignId) return { error: "Campaign ID is required" };

  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: "in_review" })
    .eq("id", campaignId)
    .eq("owner", user.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Only an owned draft campaign can be submitted for review." };

  revalidatePath("/dashboard");
  revalidatePath("/create-campaign");
  return { success: true };
}

export async function getCampaignForLaunch(campaignId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const { data, error } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaignId)
    .eq("owner", user.id)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Campaign not found." };
  return { status: data.status };
}

export async function saveCreatorProfile(profileData: any) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  // Get user role from auth metadata
  const userRole = normalizeRole(user.user_metadata?.user_role) || "investor";

  // shafqaat — Helper to convert CID to full Pinata gateway URL
  const cidToUrl = (cid: string | null | undefined) =>
    cid ? `https://gateway.pinata.cloud/ipfs/${cid}` : null;

  const row = {
    user_id: user.id,
    role: userRole,
    // Basic info
    full_name: profileData.full_name ?? null,
    display_name: profileData.display_name ?? null,
    bio: profileData.bio ?? null,
    phone: profileData.phone ?? null,
    country: profileData.country ?? null,
    city: profileData.city ?? null,
    website_url: profileData.website_url ?? null,
    linkedin_url: profileData.linkedin_url ?? null,
    // KYC — raw CIDs + gateway URLs
    national_id_cid: profileData.national_id_cid ?? null,
    national_id_url: cidToUrl(profileData.national_id_cid),
    passport_cid: profileData.passport_cid ?? null,
    passport_url: cidToUrl(profileData.passport_cid),
    selfie_cid: profileData.selfie_cid ?? null,
    selfie_url: cidToUrl(profileData.selfie_cid),
    proof_of_address_cid: profileData.proof_of_address_cid ?? null,
    proof_of_address_url: cidToUrl(profileData.proof_of_address_cid),
    // KYB
    business_reg_cid: profileData.business_reg_cid ?? null,
    business_reg_url: cidToUrl(profileData.business_reg_cid),
    tax_cert_cid: profileData.tax_cert_cid ?? null,
    tax_cert_url: cidToUrl(profileData.tax_cert_cid),
    bank_statement_cid: profileData.bank_statement_cid ?? null,
    bank_statement_url: cidToUrl(profileData.bank_statement_cid),
    business_logo_url: profileData.business_logo_url ?? null,
    avatar_url: profileData.avatar_url ?? null,
    // shafqaat — Mark profile complete if core KYC fields are filled
    profile_complete: !!(
      profileData.full_name &&
      profileData.national_id_cid &&
      profileData.selfie_cid
    ),
    updated_at: new Date().toISOString(),
  };

  // shafqaat — Upsert into the existing 'profiles' table (not creator_profiles)
  let { error } = await supabase
    .from("profiles")
    .upsert([row], { onConflict: "user_id" });

  if (error && (error.message?.includes("avatar_url") || error.message?.includes("business_logo_url"))) {
    console.warn("[saveCreatorProfile] Column missing from Supabase profiles schema cache, retrying without avatar/logo columns:", error.message);
    const { avatar_url, business_logo_url, ...fallbackRow } = row;
    const retry = await supabase
      .from("profiles")
      .upsert([fallbackRow], { onConflict: "user_id" });
    error = retry.error;
  }

  if (error) {
    console.error("[saveCreatorProfile] Supabase error:", error.message);
    return { error: error.message };
  }

  // shafqaat — If user has owner role or business documents are provided, upsert into 'businesses' table for KYB
  const { data: profileRole } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (
    (profileRole?.role && profileRole.role !== "investor") ||
    profileData.business_reg_cid ||
    profileData.tax_cert_cid ||
    profileData.bank_statement_cid
  ) {
    const businessRow = {
      owner_id: user.id,
      business_name: profileData.display_name || profileData.full_name || "My Business",
    };

    const { data: existingBusiness } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", user.id)
      .maybeSingle();

    let businessError;
    if (existingBusiness) {
      const { error } = await supabase
        .from("businesses")
        .update(businessRow)
        .eq("id", existingBusiness.id);
      businessError = error;
    } else {
      const { error } = await supabase
        .from("businesses")
        .insert([businessRow]);
      businessError = error;
    }

    if (businessError) {
      console.error("[saveCreatorProfile] Business table error:", businessError.message);
      // We don't fail the whole profile save just for this, but log it
    }
  }

  return { success: true };
}

// ── Admin Actions ────────────────────────────────────────────────────────────

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

async function sendSystemNotification(payload: {
  userId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  metadata?: any;
}) {
  try {
    // 1. Always persist directly to Supabase notifications table
    await supabaseAdmin.from('notifications').insert([
      {
        user_id: payload.userId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        link: payload.link || '/profile',
        metadata: payload.metadata || {},
      },
    ]);

    // 2. Also attempt real-time Socket.IO emission if backend is available
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
    await fetch(`${apiUrl}/api/notifications/system-emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-system-key": process.env.SYSTEM_NOTIF_KEY || "fxp-system-secret",
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (err) {
    console.error("[sendSystemNotification] error sending system notification:", err);
  }
}

export async function adminVerifyKYC(userId: string) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("profiles")
    .update({ identity_verified: true })
    .eq("user_id", userId);

  if (error) return { error: error.message };

  await logAdminAction(supabase, adminUser.id, "verify_kyc", "profile", userId, "Admin manually approved KYC");

  await sendSystemNotification({
    userId,
    type: "kyc_status",
    title: "Identity Verified",
    message: "Your KYC identity verification has been approved! You can now participate in primary campaigns and secondary trading.",
    link: "/dashboard/profile",
  });

  revalidatePath("/admin-dashboard");
  return { success: true };
}

export async function adminVerifyKYB(businessId: string) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("businesses")
    .update({ kyb_verified: true })
    .eq("id", businessId);

  if (error) return { error: error.message };

  await logAdminAction(supabase, adminUser.id, "verify_kyb", "business", businessId, "Admin manually approved KYB");

  // Fetch business owner to send notification
  const { data: business } = await supabase
    .from("businesses")
    .select("owner_id")
    .eq("id", businessId)
    .maybeSingle();

  if (business?.owner_id) {
    await sendSystemNotification({
      userId: business.owner_id,
      type: "kyb_status",
      title: "Business Verified",
      message: "Your KYB business verification has been approved! You can now launch fundraising campaigns.",
      link: "/dashboard/profile",
    });
  }

  revalidatePath("/admin-dashboard");
  return { success: true };
}

// ── Admin Campaign Actions ────────────────────────────────────────────────────

export async function adminApproveCampaign(campaignId: number) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  // Fetch campaign details before updating
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("owner, title")
    .eq("id", campaignId)
    .single();

  const { error } = await supabase
    .from("campaigns")
    .update({ status: "approved" })
    .eq("id", campaignId);

  if (error) return { error: error.message };

  await logAdminAction(supabase, adminUser.id, "approve_campaign", "campaign", String(campaignId), "Admin approved campaign");

  if (campaign?.owner) {
    await sendSystemNotification({
      userId: campaign.owner,
      type: "campaign_approved",
      title: "Campaign Approved",
      message: `Your campaign "${campaign.title || "Equity Raising"}" has been approved by admin and is now live!`,
      link: `/campaign/${campaignId}`,
      metadata: { campaign_id: campaignId },
    });
  }

  revalidatePath("/admin-dashboard/campaigns");
  return { success: true };
}

export async function adminRejectCampaign(campaignId: number, reason: string) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  // Fetch campaign details before updating
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("owner, title")
    .eq("id", campaignId)
    .single();

  const { error } = await supabase
    .from("campaigns")
    .update({ status: "rejected" })
    .eq("id", campaignId);

  if (error) return { error: error.message };

  await logAdminAction(supabase, adminUser.id, "reject_campaign", "campaign", String(campaignId), reason || "Admin rejected campaign");

  if (campaign?.owner) {
    await sendSystemNotification({
      userId: campaign.owner,
      type: "campaign_rejected",
      title: "Campaign Verification Update",
      message: `Your campaign "${campaign.title || "Equity Raising"}" was rejected. Reason: ${reason || "Does not meet guidelines"}`,
      link: "/dashboard",
      metadata: { campaign_id: campaignId, reason },
    });
  }

  revalidatePath("/admin-dashboard/campaigns");
  return { success: true };
}


export async function adminRevokeKYC(userId: string) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("profiles")
    .update({ identity_verified: false })
    .eq("user_id", userId);

  if (error) return { error: error.message };
  await logAdminAction(supabase, adminUser.id, "revoke_kyc", "profile", userId, "Admin revoked KYC status");
  revalidatePath("/admin-dashboard");
  return { success: true };
}

export async function adminRevokeKYB(businessId: string) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("businesses")
    .update({ kyb_verified: false })
    .eq("id", businessId);

  if (error) return { error: error.message };
  await logAdminAction(supabase, adminUser.id, "revoke_kyb", "business", businessId, "Admin revoked KYB status");
  revalidatePath("/admin-dashboard");
  return { success: true };
}

export async function adminRejectKYC(userId: string, reason: string = "Submitted documents did not meet verification criteria") {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("profiles")
    .update({ identity_verified: false })
    .eq("user_id", userId);

  if (error) return { error: error.message };

  // Update any linked Didit verification session
  try {
    await supabase
      .from("verification_sessions")
      .update({
        status: "Declined",
        decision: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("entity_id", userId)
      .eq("session_kind", "KYC");
  } catch (e) {
    // Non-fatal if table/row missing
  }

  await logAdminAction(supabase, adminUser.id, "reject_kyc", "profile", userId, `Admin rejected KYC: ${reason}`);

  await sendSystemNotification({
    userId,
    type: "kyc_status",
    title: "KYC Verification Rejected",
    message: `Your KYC identity verification could not be approved: ${reason}. Please re-submit your documents or complete verification via Didit.`,
    link: "/profile",
  });

  revalidatePath("/admin-dashboard");
  revalidatePath("/admin-dashboard/kyc-kyb-analytics");
  return { success: true };
}

export async function adminRejectKYB(businessId: string, reason: string = "Submitted business registration documents did not meet criteria") {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("businesses")
    .update({ kyb_verified: false })
    .eq("id", businessId);

  if (error) return { error: error.message };

  // Update any linked Didit verification session
  try {
    await supabase
      .from("verification_sessions")
      .update({
        status: "Declined",
        decision: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("entity_id", businessId)
      .eq("session_kind", "KYB");
  } catch (e) {
    // Non-fatal if table/row missing
  }

  await logAdminAction(supabase, adminUser.id, "reject_kyb", "business", businessId, `Admin rejected KYB: ${reason}`);

  // Fetch business owner to send notification
  const { data: business } = await supabase
    .from("businesses")
    .select("owner_id, business_name")
    .eq("id", businessId)
    .maybeSingle();

  if (business?.owner_id) {
    await sendSystemNotification({
      userId: business.owner_id,
      type: "kyb_status",
      title: "KYB Business Verification Rejected",
      message: `Your business verification for "${business.business_name || 'Business'}" was rejected: ${reason}. Please update your business documentation.`,
      link: "/profile",
    });
  }

  revalidatePath("/admin-dashboard");
  revalidatePath("/admin-dashboard/kyc-kyb-analytics");
  return { success: true };
}

// ── Admin Didit Session Override ──────────────────────────────────────────────
export async function adminSetDiditOverride(
  sessionId: string,
  overrideStatus: "Approved" | "Declined" | null,
  reason?: string
) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("verification_sessions")
    .update({
      admin_override_status: overrideStatus,
      admin_override_reason: reason || null,
      admin_override_by: adminUser.id,
      admin_override_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("didit_session_id", sessionId);

  if (error) return { error: error.message };

  await logAdminAction(
    supabase,
    adminUser.id,
    "didit_override",
    "verification_session",
    sessionId,
    `Admin set Didit override: ${overrideStatus ?? "cleared"} — ${reason || ""}`
  );

  revalidatePath("/admin-dashboard/kyc-kyb-analytics");
  return { success: true };
}

// ── Admin: Send a custom or template notification to a user about their KYC/KYB ──
export async function adminSendKYCNotification(
  userId: string,
  title: string,
  message: string,
  link: string = "/profile",
  notifType: string = "kyc_status"
) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  await sendSystemNotification({ userId, type: notifType, title, message, link });

  await logAdminAction(
    supabase,
    adminUser.id,
    "send_kyc_notification",
    "profile",
    userId,
    `Admin sent notification: "${title}" — ${message.slice(0, 80)}`
  );

  revalidatePath("/admin-dashboard/kyc-kyb-analytics");
  return { success: true };
}

// ── Admin: Approve KYC with custom notification message ──────────────────────
export async function adminApproveKYCWithMessage(
  userId: string,
  customMessage?: string
) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("profiles")
    .update({ identity_verified: true })
    .eq("user_id", userId);

  if (error) return { error: error.message };

  // Also update any In Review session to Approved
  await supabase
    .from("verification_sessions")
    .update({
      admin_override_status: "Approved",
      admin_override_by: adminUser.id,
      admin_override_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("entity_id", userId)
    .eq("session_kind", "KYC");

  await logAdminAction(supabase, adminUser.id, "verify_kyc", "profile", userId, "Admin manually approved KYC after Didit review");

  const msg = customMessage?.trim() ||
    "Your KYC identity verification has been approved by our compliance team! You can now invest in campaigns and trade tokens on the secondary market.";

  await sendSystemNotification({
    userId,
    type: "kyc_status",
    title: "Identity Verified ✓",
    message: msg,
    link: "/profile",
  });

  revalidatePath("/admin-dashboard/kyc-kyb-analytics");
  return { success: true };
}

// ── Admin: Decline KYC with reason and custom message ────────────────────────
export async function adminDeclineKYCWithMessage(
  userId: string,
  reason: string,
  customMessage?: string
) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("profiles")
    .update({ identity_verified: false })
    .eq("user_id", userId);

  if (error) return { error: error.message };

  await supabase
    .from("verification_sessions")
    .update({
      status: "Declined",
      decision: reason,
      admin_override_status: "Declined",
      admin_override_reason: reason,
      admin_override_by: adminUser.id,
      admin_override_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("entity_id", userId)
    .eq("session_kind", "KYC");

  await logAdminAction(supabase, adminUser.id, "reject_kyc", "profile", userId, `Admin declined KYC: ${reason}`);

  const msg = customMessage?.trim() ||
    `Your KYC identity verification could not be approved. Reason: ${reason}. Please re-submit with updated documents or contact our support team.`;

  await sendSystemNotification({
    userId,
    type: "kyc_status",
    title: "KYC Verification Declined",
    message: msg,
    link: "/profile",
  });

  revalidatePath("/admin-dashboard/kyc-kyb-analytics");
  return { success: true };
}


export async function adminRefetchDiditSession(sessionId: string) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  try {
    const { fetchAndStoreDiditDecision } = await import("@/lib/diditServer");
    const result = await fetchAndStoreDiditDecision(sessionId);
    if (!result) {
      return {
        error: "Didit API returned no data. The user has likely not started or submitted their verification on Didit yet.",
      };
    }
    revalidatePath("/admin-dashboard/kyc-kyb-analytics");
    return { success: true, data: result };
  } catch (err: any) {
    return { error: err.message || "Could not re-fetch Didit session" };
  }
}

export async function adminSyncAllDiditSessions() {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  try {
    const { syncAllDiditSessions } = await import("@/lib/diditServer");
    const result = await syncAllDiditSessions();
    revalidatePath("/admin-dashboard/kyc-kyb-analytics");
    return { success: true, ...result };
  } catch (err: any) {
    return { error: err.message || "Failed to sync Didit sessions" };
  }
}

export async function adminToggleSecondaryTrading(campaignId: number, enabled: boolean) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("campaigns")
    .update({ secondary_trading_enabled: enabled })
    .eq("id", campaignId);

  if (error) return { error: error.message };
  await logAdminAction(supabase, adminUser.id, "toggle_secondary_trading", "campaign", String(campaignId), `Secondary trading set to ${enabled}`);
  revalidatePath("/admin-dashboard/campaigns");
  return { success: true };
}

export async function adminTriggerRiskAnalysis(campaignId: number) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/campaigns/${campaignId}/analyze`, {
      method: 'POST',
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      return { error: errJson.error || 'Failed to trigger AI risk analysis' };
    }
    await logAdminAction(supabase, adminUser.id, "trigger_risk_analysis", "campaign", String(campaignId), "Admin manually triggered AI Risk Assessment");
    revalidatePath("/admin-dashboard/campaigns");
    return { success: true };
  } catch (err: any) {
    return { error: err.message || 'Failed to connect to AI server' };
  }
}

export async function adminCancelTradeOrder(orderId: string) {
  const supabase = await createClient();
  const adminUser = await checkAdmin(supabase);
  if (!adminUser) return { error: "Unauthorized: Admins only" };

  const { error } = await supabase
    .from("token_orders")
    .update({ status: "cancelled" })
    .eq("id", orderId);

  if (error) return { error: error.message };

  // Also cancel all pending bids on this order
  await supabase
    .from("token_bids")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("listing_id", orderId)
    .eq("status", "pending");

  await logAdminAction(supabase, adminUser.id, "cancel_trade_order", "token_order", orderId, "Admin cancelled trade order");
  revalidatePath("/admin-dashboard/marketplace");
  return { success: true };
}

export async function adminAuthenticateAction(email: string, secretKey: string, password?: string) {
  const supabase = await createClient();

  const expectedSecret = process.env.ADMIN_SECRET_KEY || "FXP_ADMIN_2026_SECRET";
  if (secretKey.trim() !== expectedSecret) {
    return { error: "Invalid Admin Secret Key. Access denied." };
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = password?.trim() || "";

  let userToElevate: any = null;

  // Step 1: Try standard password login
  if (cleanPassword) {
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword,
    });

    if (!signInErr && signInData?.user) {
      userToElevate = signInData.user;
    }
  }

  // Step 2: If sign in failed or no active session, check if user exists in Supabase Auth via admin client
  if (!userToElevate) {
    try {
      const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = userList?.users?.find((u) => u.email?.toLowerCase() === cleanEmail);

      if (existingUser) {
        // User already exists (e.g. Google OAuth or previous registration).
        // Update user metadata to is_admin: true and update password if provided.
        const updatePayload: any = {
          user_metadata: { ...existingUser.user_metadata, is_admin: true },
        };
        if (cleanPassword) {
          updatePayload.password = cleanPassword;
        }

        const { data: updated, error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
          existingUser.id,
          updatePayload,
        );

        if (updateErr) throw updateErr;
        userToElevate = updated.user;

        // Sign in to create browser cookies session
        if (cleanPassword) {
          await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: cleanPassword,
          });
        }
      } else {
        // Brand new user -> create via signUp
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: cleanEmail,
          password: cleanPassword || "AdminPass2026!",
          options: {
            data: { full_name: "Admin User", is_admin: true },
          },
        });

        if (signUpErr || !signUpData.user) {
          return { error: signUpErr?.message || "Failed to create new admin account." };
        }
        userToElevate = signUpData.user;
      }
    } catch (adminErr: any) {
      console.error("[adminAuthenticateAction] Admin resolution fallback error:", adminErr);
      return { error: adminErr.message || "Failed to authenticate admin user." };
    }
  }

  // Step 3: Elevate user_metadata on current session client
  try {
    await supabase.auth.updateUser({
      data: { is_admin: true },
    });
  } catch (e) {
    console.warn("[adminAuthenticateAction] session updateUser warning:", e);
  }

  // Step 4: Ensure profile row exists in profiles table
  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .upsert([{
      user_id: userToElevate.id,
      full_name: userToElevate.user_metadata?.full_name || "Admin User",
      identity_verified: true,
      profile_complete: true,
      updated_at: new Date().toISOString(),
    }], { onConflict: "user_id" });

  if (updateError) {
    console.warn("[adminAuthenticateAction] Note: profile upsert warning:", updateError.message);
  }

  await logAdminAction(supabase, userToElevate.id, "claim_admin_role", "profile", userToElevate.id, "Admin secret key claimed");

  revalidatePath("/admin-dashboard");
  return { success: true, redirectTo: "/admin-dashboard" };
}
