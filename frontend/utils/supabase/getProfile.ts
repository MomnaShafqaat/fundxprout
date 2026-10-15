// shafqaat — Profile utilities: reads/writes to the existing 'profiles' table in Supabase
import { createClient } from "@/utils/supabase/client";

const normalizeRole = (role?: string | null) => {
    const value = (role || "").trim().toLowerCase();
    if (value === "owner" || value === "business_owner") return "owner";
    if (value === "investor") return "investor";
    return null;
};

// shafqaat — Get user role from auth metadata
export async function getUserRole() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // const metadataRole = normalizeRole(user.user_metadata?.user_role);
    // if (metadataRole) return metadataRole;

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();

    return normalizeRole(profile?.role);
}

// shafqaat — Fetch the profile row for the currently logged-in user
// Queries the existing 'profiles' table (already in Supabase)
export async function getMyProfile() {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
        .from("profiles")          // shafqaat — use the existing profiles table
        .select("*, businesses(*)")
        .eq("user_id", user.id)
        .single();

    if (error) {
        // shafqaat — PGRST116 = no row found (first-time user), ignore this error
        if (error.code !== "PGRST116") {
            console.error("[getMyProfile] Supabase error:", error.message);
        }
        return null;
    }

    return data;
}

// ── Update investor profile in Supabase ─────────────────────────────
export async function updateProfile(fields: {
    full_name?: string;
    display_name?: string;
    bio?: string;
    phone?: string;
    country?: string;
    website_url?: string;
    wallet_address?: string;
    avatar_url?: string;
    business_logo_url?: string;
}) {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };

    // Upsert so it works for first-time profiles too
    let { error } = await supabase
        .from('profiles')
        .upsert({ user_id: user.id, ...fields }, { onConflict: 'user_id' });

    if (error && (error.message?.includes('avatar_url') || error.message?.includes('business_logo_url'))) {
        console.warn('[updateProfile] Column missing from Supabase profiles schema cache, retrying without avatar/logo columns:', error.message);
        const { avatar_url, business_logo_url, ...fallbackFields } = fields;
        const retry = await supabase
            .from('profiles')
            .upsert({ user_id: user.id, ...fallbackFields }, { onConflict: 'user_id' });
        error = retry.error;
    }

    if (error) {
        console.error('[updateProfile] Supabase error:', error.message);
        return { error: error.message };
    }
    return { success: true };
}

// ── Change notification preferences (stored in profile row) ─────────
export async function updateNotificationPrefs(prefs: Record<string, boolean>) {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };

    const { error } = await supabase
        .from('profiles')
        .upsert({ user_id: user.id, notification_prefs: prefs }, { onConflict: 'user_id' });

    if (error) {
        console.error('[updateNotificationPrefs] Supabase error:', error.message);
        return { error: error.message };
    }
    return { success: true };
}

// shafqaat — Calculate profile completion % based on filled fields
// Returns 0-100 based on how many key fields are non-empty
export function calcProfileCompletion(profile: Record<string, any> | null): number {
    if (!profile) return 0;

    const role = (profile.role || "").trim().toLowerCase();
    const isKycVerified = !!profile.identity_verified;

    if (role === "investor") {
        const investorFields = [
            profile.full_name,
            profile.display_name,
            profile.bio,
            profile.phone,
            profile.country,
            profile.website_url,
            isKycVerified,
        ];
        const filled = investorFields.filter((f) => f && String(f).trim() !== "" && f !== false).length;
        return Math.round((filled / investorFields.length) * 100);
    }

    const isKybVerified = !!(profile.businesses?.[0]?.kyb_verified || profile.businesses?.kyb_verified);
    const ownerFields = [
        profile.full_name,
        profile.display_name,
        profile.bio,
        profile.phone,
        profile.country,
        profile.website_url,
        isKycVerified,
        isKybVerified,
        profile.business_reg_cid,
        profile.tax_cert_cid,
        profile.bank_statement_cid,
    ];

    const filled = ownerFields.filter((f) => f && String(f).trim() !== "" && f !== false).length;
    return Math.round((filled / ownerFields.length) * 100);
}
