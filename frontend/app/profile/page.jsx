"use client";
// shafqaat — Creator Profile page: KYC/KYB document upload + basic info + Cloudinary images
// Route: /profile — meets international standards (Kickstarter, GoFundMe, SECP, FBR)
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  User, FileText, CheckCircle, Loader2,
  AlertCircle, Camera, Building2, ArrowLeft, Save, ShieldCheck,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { saveCreatorProfile } from "@/lib/action";
import { getMyProfile, calcProfileCompletion } from "@/utils/supabase/getProfile";
import UserAvatar from "@/components/UserAvatar";

// shafqaat — Cloudinary Image Upload widget (Profile Picture & Business Logo)
function ImageUpload({ label, hint, currentUrl, onUploaded, isCircle = false }) {
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState(currentUrl || "");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (currentUrl) setUrl(currentUrl);
  }, [currentUrl]);

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setUrl(json.url);
      onUploaded(json.url);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wider">
        {label}
      </label>
      {hint && <p className="text-xs text-gray-600 mb-2">{hint}</p>}
      <div className="border-2 border-dashed border-white/10 rounded-xl p-4 flex flex-col items-center justify-center text-center hover:border-[#6f42c1]/40 transition bg-[#0d1117]">
        {uploading ? (
          <div className="flex flex-col items-center gap-1.5 py-2">
            <Loader2 className="h-6 w-6 text-[#a78bfa] animate-spin" />
            <p className="text-xs text-gray-400 font-medium">Uploading to Cloudinary…</p>
          </div>
        ) : url ? (
          <div className="flex flex-col items-center gap-2">
            <div className={`relative overflow-hidden border border-white/20 bg-black/40 ${isCircle ? "w-20 h-20 rounded-full" : "w-24 h-24 rounded-xl"}`}>
              <img src={url} alt={label} className="w-full h-full object-cover" />
            </div>
            <p className="text-xs text-green-400 font-semibold flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" /> Uploaded to Cloudinary ✓
            </p>
            <label className="text-xs text-[#a78bfa] hover:underline cursor-pointer font-medium mt-0.5">
              Change Image
              <input type="file" accept="image/*" className="hidden" onChange={handleChange} />
            </label>
          </div>
        ) : (
          <label className="cursor-pointer flex flex-col items-center py-2">
            <Camera className="h-6 w-6 text-gray-400 mb-1.5" />
            <span className="text-[#a78bfa] text-xs font-semibold">Click to upload image</span>
            <p className="text-[10px] text-gray-600 mt-0.5">PNG, JPG, WEBP up to 5MB</p>
            <input type="file" accept="image/*" className="hidden" onChange={handleChange} />
          </label>
        )}
      </div>
      {err && <p className="flex items-center gap-1 text-xs text-red-400 mt-1"><AlertCircle className="h-3 w-3" />{err}</p>}
    </div>
  );
}

// shafqaat — IPFS document upload widget (reused from create-campaign pattern)
function DocUpload({ fieldKey, label, hint, accept, currentUrl, onUploaded, required = false }) {
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(!!currentUrl);
  const [cid, setCid] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { if (currentUrl) setUploaded(true); }, [currentUrl]);

  const handleChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", `profile-${fieldKey}-${file.name}`);
      const res = await fetch("/api/ipfs-upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setCid(json.cid);
      setUploaded(true);
      onUploaded(fieldKey, json.cid);
    } catch (e) { setErr(e.message); }
    finally { setUploading(false); }
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wider">
        {label} {required && <span className="text-[#a78bfa]">*</span>}
      </label>
      <p className="text-xs text-gray-600 mb-2">{hint}</p>
      <div className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center hover:border-[#6f42c1]/40 transition bg-[#0d1117]">
        {uploading ? (
          <div className="flex flex-col items-center gap-1">
            <Loader2 className="h-5 w-5 text-[#a78bfa] animate-spin" />
            <p className="text-xs text-gray-400">Uploading to IPFS…</p>
          </div>
        ) : uploaded ? (
          <div className="flex flex-col items-center gap-1">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <p className="text-xs text-green-400 font-medium">
              {currentUrl && !cid ? "Already on IPFS ✓" : "Stored on IPFS ✓"}
            </p>
            {currentUrl && (
              <a href={currentUrl} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-[#a78bfa] hover:underline">View document</a>
            )}
            <label htmlFor={`prof-${fieldKey}`} className="text-xs text-gray-500 cursor-pointer mt-1">Replace</label>
          </div>
        ) : (
          <label htmlFor={`prof-${fieldKey}`} className="cursor-pointer">
            <FileText className="h-6 w-6 text-gray-600 mx-auto mb-1" />
            <span className="text-[#a78bfa] text-xs font-semibold">Click to upload</span>
            <p className="text-[10px] text-gray-600 mt-0.5">{accept.replace(/,/g, " / ")}</p>
          </label>
        )}
        <input id={`prof-${fieldKey}`} type="file" accept={accept} className="hidden" onChange={handleChange} />
      </div>
      {err && <p className="flex items-center gap-1 text-xs text-red-400 mt-1"><AlertCircle className="h-3 w-3" />{err}</p>}
    </div>
  );
}

// shafqaat — Reusable text input
function Field({ label, name, value, onChange, type = "text", placeholder, hint, required = false, textarea = false }) {
  const cls = "w-full px-4 py-3 bg-[#0d1117] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6f42c1] transition text-sm";
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wider">
        {label} {required && <span className="text-[#a78bfa]">*</span>}
      </label>
      {hint && <p className="text-xs text-gray-600 mb-2">{hint}</p>}
      {textarea ? (
        <textarea name={name} value={value} onChange={onChange} placeholder={placeholder} rows={3} className={cls + " resize-none"} />
      ) : (
        <input type={type} name={name} value={value} onChange={onChange} placeholder={placeholder} className={cls} />
      )}
    </div>
  );
}

// shafqaat — Section wrapper
function Section({ icon: Icon, title, description, children }) {
  return (
    <div className="bg-[#1a2030] rounded-2xl border border-white/5 p-6 space-y-5">
      <div className="flex items-center gap-3 pb-4 border-b border-white/10">
        <div className="p-2 rounded-xl bg-[#6f42c1]/20">
          <Icon className="h-5 w-5 text-[#a78bfa]" />
        </div>
        <div>
          <h2 className="text-base font-bold text-white">{title}</h2>
          {description && <p className="text-xs text-gray-500">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [userId, setUserId] = useState(null);
  const [verifying, setVerifying] = useState(null); // 'kyc' | 'kyb' | null
  const [verificationSuccessMsg, setVerificationSuccessMsg] = useState("");
  const [docCids, setDocCids] = useState({});  // shafqaat — tracks newly uploaded doc CIDs

  const [form, setForm] = useState({
    full_name: "", display_name: "", bio: "", phone: "",
    country: "", city: "", website_url: "", linkedin_url: "",
    avatar_url: "", business_logo_url: "",
  });

  // shafqaat — Load existing profile, handle URL return callbacks, and listen for cross-tab sync
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/"); return; }
      setUserId(user.id);

      // 1. Listen for cross-tab verification completion events from child tab
      const handleStorageChange = async (e) => {
        if (e.key === "didit_verified_event") {
          const updated = await getMyProfile();
          if (updated) {
            setProfile(updated);
            setVerifying(false);
            setVerificationSuccessMsg("Verification completed in popup tab! Profile updated automatically.");
          }
        }
      };
      window.addEventListener("storage", handleStorageChange);

      // 2. Check URL query parameters if this tab is the return callback from Didit
      if (typeof window !== "undefined") {
        const searchParams = new URLSearchParams(window.location.search);
        const kycParam = searchParams.get("kyc");
        const kybParam = searchParams.get("kyb");
        const statusParam = searchParams.get("status");
        const sessionIdParam = searchParams.get("verificationSessionId");

        if (statusParam === 'Approved' || kycParam === 'complete' || kybParam === 'complete' || sessionIdParam) {
          setVerificationSuccessMsg('Didit verification completed! Syncing your status from Didit...');

          // shafqaat implemented — Do NOT blindly set identity_verified=true here.
          // The URL callback fires regardless of Didit's actual decision (Approved/Declined/In Review).
          // Always use sync-status to get the real result from the Didit API.
          try {
            const syncRes = await fetch('/api/didit/sync-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: user.id }),
            });
            const syncData = await syncRes.json();
            if (syncData.updated) {
              setVerificationSuccessMsg('Identity verified successfully! Your profile has been updated.');
            } else {
              // Not approved yet — may be In Review or Declined. Let the user see real status.
              setVerificationSuccessMsg(
                'Verification submission received! Your status will update when our review is complete. Check your notifications for updates.'
              );
            }
          } catch (e) {
            console.error('[profile callback] sync-status call failed:', e);
          }

          // Broadcast sync event to parent/original profile tab
          localStorage.setItem(
            'didit_verified_event',
            JSON.stringify({ type: kybParam === 'complete' ? 'kyb' : 'kyc', timestamp: Date.now() })
          );

          if (window.opener && window.opener !== window) {
            setTimeout(() => {
              window.close();
            }, 1500);
          }

          pollUntilVerified(kybParam === 'complete' ? 'kyb' : 'kyc');
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }

      const existing = await getMyProfile();
      if (existing) {
        setProfile(existing);
        setForm({
          full_name: existing.full_name ?? "",
          display_name: existing.display_name ?? "",
          bio: existing.bio ?? "",
          phone: existing.phone ?? "",
          country: existing.country ?? "",
          city: existing.city ?? "",
          website_url: existing.website_url ?? "",
          linkedin_url: existing.linkedin_url ?? "",
          avatar_url: existing.avatar_url ?? "",
          business_logo_url: existing.business_logo_url ?? "",
        });
      }
      setLoading(false);

      return () => {
        window.removeEventListener("storage", handleStorageChange);
      };
    }
    load();
  }, []);

  const handleInput = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleDocUploaded = (key, cid) => {
    setDocCids((prev) => ({ ...prev, [key]: cid }));
  };

  // shafqaat — Merge form + new + existing CIDs then upsert to Supabase
  const handleSave = async () => {
    setSaving(true); setError(""); setSaved(false);
    const payload = {
      ...form,
      national_id_cid: docCids.national_id_cid || profile?.national_id_cid || null,
      passport_cid: docCids.passport_cid || profile?.passport_cid || null,
      selfie_cid: docCids.selfie_cid || profile?.selfie_cid || null,
      proof_of_address_cid: docCids.proof_of_address_cid || profile?.proof_of_address_cid || null,
      business_reg_cid: docCids.business_reg_cid || profile?.business_reg_cid || null,
      tax_cert_cid: docCids.tax_cert_cid || profile?.tax_cert_cid || null,
      bank_statement_cid: docCids.bank_statement_cid || profile?.bank_statement_cid || null,
      business_logo_url: form.business_logo_url || profile?.business_logo_url || null,
      avatar_url: form.avatar_url || profile?.avatar_url || null,
    };
    const result = await saveCreatorProfile(payload);
    if (result?.error) { setError(result.error); }
    else {
      setSaved(true);
      const updated = await getMyProfile();
      setProfile(updated);
    }
    setSaving(false);
  };

  const pollUntilVerified = async (type, attempts = 0) => {
    try {
      if (userId) {
        await fetch('/api/didit/sync-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
      }
    } catch (e) {
      console.error("[pollUntilVerified] Sync error:", e);
    }

    const updated = await getMyProfile();
    const isKycVerified = !!updated?.identity_verified;
    const isKybVerified = Array.isArray(updated?.businesses)
      ? !!updated?.businesses[0]?.kyb_verified
      : !!updated?.businesses?.kyb_verified;

    if (type === 'kyc' && isKycVerified) {
      setProfile(updated);
      setVerifying(null);
      setVerificationSuccessMsg("Biometric identity verified successfully via Didit!");
      return;
    }
    if (type === 'kyb' && isKybVerified) {
      setProfile(updated);
      setVerifying(null);
      setVerificationSuccessMsg("Business verified successfully via Didit!");
      return;
    }
    if (attempts < 15) {
      setTimeout(() => pollUntilVerified(type, attempts + 1), 2000);
    } else {
      setVerifying(null);
      setProfile(updated);
    }
  };

  const startDiditVerification = async (type) => {
    try {
      const currentHasBusiness = Array.isArray(profile?.businesses)
        ? profile?.businesses.length > 0
        : !!profile?.businesses;

      if (type === 'kyb' && !currentHasBusiness) {
        setVerificationSuccessMsg("Creating business profile first...");
        await handleSave();
      }

      setVerifying(type);
      setError("");
      setVerificationSuccessMsg(`Starting ${type.toUpperCase()} verification session...`);
      // Connect via internal Next.js API route with external backend fallback
      let res;
      try {
        res = await fetch(`/api/didit/${type}/create-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
      } catch (err) {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
        res = await fetch(`${apiBase}/api/didit/${type}/create-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
      }
      const data = await res.json();

      if (!res.ok || !data.url) {
        throw new Error(data.error || "Failed to create verification session");
      }

      window.open(data.url, "_blank");
      setVerificationSuccessMsg(`Didit ${type.toUpperCase()} verification opened in a new tab! Complete verification on your phone or tab, and your status will automatically update here...`);
      pollUntilVerified(type);
    } catch (err) {
      console.error(err);
      setVerifying(null);
      setVerificationSuccessMsg("");
      const message = err?.message || "Error starting Didit verification.";
      setError(message);
      alert(`Didit Verification Error: ${message}`);
    }
  };

  const completion = calcProfileCompletion(profile);
  const isKycVerified = !!profile?.identity_verified;
  const isKybVerified = Array.isArray(profile?.businesses)
    ? !!profile?.businesses[0]?.kyb_verified
    : !!profile?.businesses?.kyb_verified;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#181A2A] flex items-center justify-center">
        <Loader2 className="h-10 w-10 text-[#6f42c1] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#181A2A] py-8 pt-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">

        {/* shafqaat — Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/dashboard")} className="text-gray-400 hover:text-white transition">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3">
              <UserAvatar
                src={form.avatar_url || profile?.avatar_url}
                name={form.display_name || form.full_name || "User"}
                size={44}
              />
              <div>
                <h1 className="text-2xl font-black text-white">
                  {form.display_name || form.full_name || "Profile Settings"}
                </h1>
                <p className="text-gray-400 text-xs">KYC/KYB verification &amp; profile management</p>
              </div>
            </div>
          </div>
        </div>

        {/* shafqaat — Completion progress bar */}
        <div className="bg-[#1a2030] rounded-2xl border border-white/5 p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#a78bfa]" />
              <span className="text-sm font-semibold text-white">Verification Progress</span>
            </div>
            <span className="text-sm font-bold text-[#a78bfa]">{completion}%</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div className="bg-gradient-to-r from-[#6f42c1] to-[#a78bfa] h-2 rounded-full transition-all duration-700"
              style={{ width: `${completion}%` }} />
          </div>
          <p className="text-xs text-gray-600 mt-2">Complete profile increases investor trust and campaign visibility</p>
        </div>

        {/* shafqaat — Banners */}
        {verificationSuccessMsg && (
          <div className="flex items-center gap-2 p-4 bg-green-500/15 border border-green-500/30 rounded-xl text-green-400 text-sm font-semibold shadow-lg">
            <CheckCircle className="h-5 w-5 flex-shrink-0" /> {verificationSuccessMsg}
          </div>
        )}
        {saved && (
          <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-sm">
            <CheckCircle className="h-4 w-4" /> Profile saved successfully!
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}

        {/* ── Section 1: Basic Info ── */}
        <Section icon={User} title="Basic Information" description="Your public creator identity and profile picture">
          {/* Profile Picture (Avatar) Upload */}
          <div className="mb-4 pb-4 border-b border-white/10">
            <ImageUpload
              label="Profile Picture (Avatar)"
              hint="Upload your personal profile photo — visible across dashboards and listings"
              currentUrl={form.avatar_url || profile?.avatar_url}
              onUploaded={(url) => setForm((prev) => ({ ...prev, avatar_url: url }))}
              isCircle
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full Legal Name" name="full_name" value={form.full_name} onChange={handleInput}
              placeholder="As on government ID" required hint="Must match your identity documents" />
            <Field label="Display Name" name="display_name" value={form.display_name} onChange={handleInput}
              placeholder="Public name shown to investors" />
            <Field label="Phone" name="phone" value={form.phone} onChange={handleInput}
              placeholder="+92 300 1234567" type="tel" />
            <Field label="Country" name="country" value={form.country} onChange={handleInput} placeholder="Pakistan" />
            <Field label="City" name="city" value={form.city} onChange={handleInput} placeholder="Lahore" />
            <Field label="LinkedIn URL" name="linkedin_url" value={form.linkedin_url} onChange={handleInput}
              placeholder="https://linkedin.com/in/yourname" />
            <Field label="Website" name="website_url" value={form.website_url} onChange={handleInput}
              placeholder="https://yourcompany.com" />
          </div>
          <Field label="Bio / About" name="bio" value={form.bio} onChange={handleInput}
            placeholder="Brief description of you and your business for investors"
            textarea hint="Shown on your campaign pages — 2-3 sentences recommended" />
        </Section>

        {/* ── Section 2: KYC (Identity Verification) ── */}
        <Section icon={ShieldCheck} title="Identity Verification (KYC)"
          description="Required by AML/KYC standards — Kickstarter, Indiegogo, FCA, SECP">
          <div className="mb-4">
            {isKycVerified ? (
              <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl text-sm font-medium">
                <CheckCircle className="h-5 w-5" /> Biometric Identity Verified (Didit) ✓
              </div>
            ) : (
              <div className="space-y-2">
                <button onClick={(e) => { e.preventDefault(); startDiditVerification('kyc'); }} 
                  disabled={verifying === 'kyc'}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#6f42c1] hover:bg-[#5a3599] disabled:opacity-50 text-white rounded-xl text-sm font-bold transition shadow-lg shadow-[#6f42c1]/20">
                  {verifying === 'kyc' ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                  {verifying === 'kyc' ? "Verifying..." : "Verify Identity with Didit"}
                </button>
                <p className="text-xs text-gray-400">
                  Secured by Didit. Scans government-issued ID and performs live liveness check automatically.
                </p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-4">
            <DocUpload fieldKey="national_id_cid" label="National ID / CNIC" required
              hint="Both sides — primary identity document" accept=".pdf,.jpg,.jpeg,.png"
              currentUrl={profile?.national_id_url} onUploaded={handleDocUploaded} />
            <DocUpload fieldKey="passport_cid" label="Passport (Optional)"
              hint="Photo page — boosts international investor trust" accept=".pdf,.jpg,.jpeg,.png"
              currentUrl={profile?.passport_url} onUploaded={handleDocUploaded} />
            <DocUpload fieldKey="selfie_cid" label="Selfie with ID" required
              hint="Hold your ID next to your face — standard Kickstarter requirement" accept=".jpg,.jpeg,.png"
              currentUrl={profile?.selfie_url} onUploaded={handleDocUploaded} />
            <DocUpload fieldKey="proof_of_address_cid" label="Proof of Address" required
              hint="Utility bill or bank letter dated within last 3 months" accept=".pdf,.jpg,.jpeg,.png"
              currentUrl={profile?.proof_of_address_url} onUploaded={handleDocUploaded} />
          </div>
        </Section>

        {/* ── Section 3: KYB (Business Verification) ── */}
        {profile?.role !== "investor" && (
          <Section icon={Building2} title="Business Verification (KYB)"
            description="SEC, FCA, SECP, FBR standards — required for investor-facing campaigns">
            <div className="mb-4">
              {isKybVerified ? (
                <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl text-sm font-medium">
                  <CheckCircle className="h-5 w-5" /> Business Verified (Didit) ✓
                </div>
              ) : (
                <div>
                  <button onClick={(e) => { e.preventDefault(); startDiditVerification('kyb'); }} 
                    disabled={verifying === 'kyb'}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-[#6f42c1] hover:bg-[#5a3599] disabled:opacity-50 text-white rounded-xl text-sm font-bold transition shadow-lg shadow-[#6f42c1]/20">
                    {verifying === 'kyb' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Building2 className="h-5 w-5" />}
                    {verifying === 'kyb' ? "Verifying..." : "Verify Business with Didit"}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <DocUpload fieldKey="business_reg_cid" label="Business Registration" required
                hint="Certificate of Incorporation / SECP registration" accept=".pdf"
                currentUrl={profile?.business_reg_url} onUploaded={handleDocUploaded} />
              <DocUpload fieldKey="tax_cert_cid" label="Tax Registration Certificate" required
                hint="NTN Certificate (Pakistan) or equivalent" accept=".pdf"
                currentUrl={profile?.tax_cert_url} onUploaded={handleDocUploaded} />
              <DocUpload fieldKey="bank_statement_cid" label="Bank Statement (3 months)" required
                hint="Shows financial activity — required by AML standards" accept=".pdf"
                currentUrl={profile?.bank_statement_url} onUploaded={handleDocUploaded} />
              
              {/* Business Logo Upload via Cloudinary */}
              <ImageUpload
                label="Business Logo"
                hint="Company or startup logo displayed on your campaigns"
                currentUrl={form.business_logo_url || profile?.business_logo_url}
                onUploaded={(url) => setForm((prev) => ({ ...prev, business_logo_url: url }))}
                isCircle={false}
              />
            </div>
          </Section>
        )}

        {/* shafqaat — Save + Back buttons */}
        <div className="flex gap-3 pb-8">
          <button onClick={handleSave} disabled={saving || !form.full_name}
            className="flex-1 bg-[#6f42c1] hover:bg-[#5a3599] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-full transition flex items-center justify-center gap-2 text-sm"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <><Save className="h-4 w-4" />Save Profile</>}
          </button>
          <button onClick={() => router.push("/dashboard")}
            className="px-6 py-3 border border-white/10 text-gray-300 hover:text-white rounded-full transition text-sm font-semibold"
          >
            Back to Dashboard
          </button>
        </div>

      </div>
    </div>
  );
}