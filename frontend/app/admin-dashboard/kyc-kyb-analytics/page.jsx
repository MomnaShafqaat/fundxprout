import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/admin";
import { ShieldCheck } from "lucide-react";
import KYCVerificationManager from "@/components/admin/KYCVerificationManager";

export default async function AdminKYCKYBPage() {
  const supabase = await createClient();

  // shafqaat implemented — Fetch ALL non-verified KYC users (pending, declined, in-review)
  // using supabaseAdmin to bypass RLS so all user profiles and sessions are visible
  const [{ data: allUnverifiedUsers }, { data: verifiedUsers }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("identity_verified", false)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("identity_verified", true)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // Fetch KYB businesses (pending & verified) using supabaseAdmin
  const [{ data: pendingBusinesses }, { data: verifiedBusinesses }] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("*, profiles(full_name, user_id, business_reg_url, tax_cert_url, bank_statement_url)")
      .eq("kyb_verified", false)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("businesses")
      .select("*, profiles(full_name, user_id, business_reg_url, tax_cert_url, bank_statement_url)")
      .eq("kyb_verified", true)
      .order("created_at", { ascending: false }),
  ]);

  // shafqaat implemented — Fetch verification_sessions to classify unverified users into:
  // - "in_review"  → Didit returned "In Review" / "Needs Review" (admin must manually approve)
  // - "declined"   → Didit returned "Declined" / "Rejected"
  // - "pending"    → No Didit session yet, or session is Not Started
  let diditSessions = [];
  try {
    const { data: sessions, error } = await supabaseAdmin
      .from("verification_sessions")
      .select(`
        didit_session_id,
        entity_type,
        entity_id,
        session_kind,
        status,
        decision,
        created_at,
        updated_at,
        first_name,
        last_name,
        date_of_birth,
        nationality,
        document_type,
        document_number,
        personal_number,
        issuing_state,
        expiration_date,
        gender,
        liveness_score,
        liveness_status,
        face_match_score,
        face_match_status,
        aml_status,
        aml_hits,
        device_ip,
        device_country,
        device_platform,
        is_vpn,
        company_name,
        registration_number,
        company_type,
        incorporation_date,
        company_status,
        company_country,
        kyb_key_people,
        admin_override_status,
        admin_override_reason,
        admin_override_at,
        didit_decision_payload
      `)
      .order("created_at", { ascending: false });

    if (!error && sessions) {
      diditSessions = sessions;
    } else if (error) {
      console.warn("[Admin KYC/KYB] Enriched columns not found, falling back:", error.message);
      const { data: fallbackSessions } = await supabaseAdmin
        .from("verification_sessions")
        .select("didit_session_id, entity_type, entity_id, session_kind, status, decision, created_at, updated_at")
        .order("created_at", { ascending: false });
      if (fallbackSessions) diditSessions = fallbackSessions;
    }
  } catch (err) {
    console.warn("Could not query verification_sessions:", err);
  }

  // ── Auto-Sync Active Didit Sessions from Didit REST API ───────────────────
  // If Didit webhooks are blocked/tunnel was down, query Didit directly so admin sees live state
  const apiKey = process.env.DIDIT_API_KEY;
  if (apiKey && diditSessions.length > 0) {
    const { fetchAndStoreDiditDecision } = await import("@/lib/diditServer");
    // Check sessions that are not finalized or missing decision
    const checkCandidates = diditSessions.filter(
      (s) => s.status === 'Not Started' || s.status === 'In Progress' || !s.decision
    ).slice(0, 10);

    for (const s of checkCandidates) {
      try {
        const res = await fetch(`https://verification.didit.me/v3/session/${s.didit_session_id}/`, {
          headers: { 'x-api-key': apiKey },
          cache: 'no-store',
        });
        if (res.ok) {
          const diditData = await res.json();
          const statusChanged = diditData.status && (diditData.status !== s.status || diditData.decision !== s.decision);
          const needsEnrichment = !s.didit_decision_payload && diditData.status !== 'Not Started';

          if (statusChanged || needsEnrichment) {
            s.status = diditData.status || s.status;
            s.decision = diditData.decision || s.decision;
            const enrichment = await fetchAndStoreDiditDecision(s.didit_session_id);
            if (enrichment) {
              Object.assign(s, enrichment);
            }
          }
        }
      } catch (err) {
        console.warn(`[Auto-sync] Error checking session ${s.didit_session_id}:`, err);
      }
    }
  }

  // shafqaat implemented — Build userId → latest KYC session map for classification
  const userSessionMap = {};
  for (const s of diditSessions) {
    if (s.session_kind === "KYC" && s.entity_id) {
      const existing = userSessionMap[s.entity_id];
      if (!existing || new Date(s.updated_at) > new Date(existing.updated_at)) {
        userSessionMap[s.entity_id] = s;
      }
    }
  }

  // shafqaat implemented — Classify unverified users into three buckets
  const pendingUsers = [];
  const inReviewUsers = [];
  const declinedUsers = [];

  for (const u of allUnverifiedUsers || []) {
    const session = userSessionMap[u.user_id];
    if (!session) {
      pendingUsers.push({ ...u, _kyc_session_status: "No Session" });
      continue;
    }
    const effectiveStatus = session.admin_override_status
      ? session.admin_override_status.toLowerCase()
      : (session.status || "").toLowerCase();

    if (
      effectiveStatus === "in review" || effectiveStatus === "in_review" ||
      effectiveStatus === "needs review" || effectiveStatus === "needs_review" ||
      effectiveStatus === "review"
    ) {
      inReviewUsers.push({
        ...u,
        _kyc_session_status: session.status,
        _didit_session_id: session.didit_session_id,
      });
    } else if (effectiveStatus === "declined" || effectiveStatus === "rejected") {
      declinedUsers.push({
        ...u,
        _kyc_session_status: session.status,
        _didit_session_id: session.didit_session_id,
        _decline_reason: session.decision,
      });
    } else {
      pendingUsers.push({ ...u, _kyc_session_status: session.status });
    }
  }

  // Fetch Admin Actions Audit Trail
  let adminActions = [];
  try {
    const { data: actions, error: actErr } = await supabaseAdmin
      .from("admin_actions")
      .select("id, admin_id, action, target_type, target_id, reason, created_at")
      .or("target_type.in.(profile,business,verification_session),action.in.(verify_kyc,reject_kyc,revoke_kyc,verify_kyb,reject_kyb,revoke_kyb,didit_override)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!actErr && actions) {
      adminActions = actions;
    } else if (actErr) {
      console.warn("[Admin KYC/KYB] Error fetching admin_actions:", actErr.message);
    }
  } catch (err) {
    console.warn("Could not query admin_actions:", err);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 pt-24">
      {/* Top Header */}
      <div className="mb-8 border-b border-white/10 pb-6">
        <h1 className="text-3xl font-black text-white mb-2 flex items-center gap-3">
          <ShieldCheck className="text-[#a78bfa] h-8 w-8" />
          Admin Verification &amp; Governance Portal
        </h1>
        <p className="text-gray-400">
          Review KYC/KYB identity submissions, inspect Didit biometric scores, approve or reject credentials, and oversee platform integrity.
        </p>
      </div>

      {/* Main Verification Manager */}
      <KYCVerificationManager
        pendingUsers={pendingUsers}
        inReviewUsers={inReviewUsers}
        declinedUsers={declinedUsers}
        verifiedUsers={verifiedUsers || []}
        pendingBusinesses={pendingBusinesses || []}
        verifiedBusinesses={verifiedBusinesses || []}
        diditSessions={diditSessions}
        adminActions={adminActions}
      />
    </div>
  );
}
