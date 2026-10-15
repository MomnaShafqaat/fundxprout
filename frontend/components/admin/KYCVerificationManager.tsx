'use client';

import { useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import {
  CheckCircle,
  XCircle,
  Clock,
  ShieldCheck,
  Building2,
  User,
  FileText,
  UserX,
  ExternalLink,
  AlertTriangle,
  Fingerprint,
  Info,
  X,
  Loader2,
  FileCheck2,
  Eye,
  RefreshCw,
  Globe,
  Smartphone,
  Activity,
  BarChart2,
  Lock,
  Unlock,
  Hash,
  Calendar,
  MapPin,
  Users,
  CreditCard,
  Shield,
  Edit3,
  Search,
  History,
  ListFilter,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import {
  adminVerifyKYC,
  adminVerifyKYB,
  adminRevokeKYC,
  adminRevokeKYB,
  adminRejectKYC,
  adminRejectKYB,
  adminSetDiditOverride,
  adminRefetchDiditSession,
  adminSyncAllDiditSessions,
} from '@/lib/action';
import AdminUserReviewModal, { type DiditSession } from './AdminUserReviewModal';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminAction {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  created_at: string;
}

interface Profile {
  user_id: string;
  full_name?: string | null;
  national_id_url?: string | null;
  passport_url?: string | null;
  selfie_url?: string | null;
  proof_of_address_url?: string | null;
  wallet_address?: string | null;
  created_at?: string | null;
  identity_verified?: boolean;
}

interface Business {
  id: string;
  business_name: string;
  owner_id: string;
  kyb_verified?: boolean;
  created_at?: string | null;
  profiles?: {
    full_name?: string | null;
    user_id?: string | null;
    business_reg_url?: string | null;
    tax_cert_url?: string | null;
    bank_statement_url?: string | null;
  } | null;
}


interface KYCVerificationManagerProps {
  pendingUsers: Profile[];
  inReviewUsers?: Profile[]; // shafqaat implemented — users whose Didit session is In Review
  declinedUsers?: Profile[]; // shafqaat implemented — users whose Didit session was Declined
  verifiedUsers: Profile[];
  pendingBusinesses: Business[];
  verifiedBusinesses?: Business[];
  diditSessions?: DiditSession[];
  adminActions?: AdminAction[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DIDIT_KYC_REASONS = [
  'Low image quality / Blurry ID document',
  'Document expired or invalid',
  'Facial liveness / Selfie mismatch',
  'Name or ID number mismatch with profile',
  'Proof of address older than 3 months',
  'Suspected forged or altered document',
  'Other / Custom reason',
];

const DIDIT_KYB_REASONS = [
  'Certificate of Incorporation invalid or unverified',
  'Tax registration / NTN certificate mismatch',
  'Business ownership or signatory authority unverified',
  'Bank statement older than 90 days or incomplete',
  'Company inactive or not in good standing',
  'Other / Custom reason',
];

// ─────────────────────────────────────────────────────────────────────────────
// Score pill
// ─────────────────────────────────────────────────────────────────────────────
function ScorePill({ score, label }: { score: number | null | undefined; label: string }) {
  if (score == null) return null;
  const pct = Math.round(score * (score <= 1 ? 100 : 1));
  const color =
    pct >= 80 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
    pct >= 50 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                'text-red-400 bg-red-500/10 border-red-500/20';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-mono font-semibold ${color}`}>
      <BarChart2 size={10} />
      {label}: {pct}%
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const config = s.includes('approv') || s.includes('complet')
    ? { cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: <CheckCircle size={11} /> }
    : s.includes('declin') || s.includes('reject')
    ? { cls: 'text-red-400 bg-red-500/10 border-red-500/20', icon: <XCircle size={11} /> }
    : s.includes('progress') || s.includes('started')
    ? { cls: 'text-blue-400 bg-blue-500/10 border-blue-500/20', icon: <Activity size={11} /> }
    : { cls: 'text-gray-400 bg-white/5 border-white/10', icon: <Clock size={11} /> };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-semibold ${config.cls}`}>
      {config.icon}
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Didit Rich Data Panel (shown in modal)
// ─────────────────────────────────────────────────────────────────────────────
function DiditDataPanel({
  session,
  onClose,
}: {
  session: DiditSession;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<'Approved' | 'Declined' | ''>('');
  const [overrideReason, setOverrideReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [refetching, setRefetching] = useState(false);

  const hasPersonalData = session.first_name || session.last_name || session.document_number;
  const hasCompanyData = session.company_name || session.registration_number;
  const hasScores =
    session.liveness_score != null || session.face_match_score != null || session.aml_status;
  const hasDevice = session.device_ip || session.device_country || session.device_platform;

  const handleRefetch = async () => {
    setRefetching(true);
    setMsg(null);
    const res = await adminRefetchDiditSession(session.didit_session_id);
    setRefetching(false);
    if (res?.error) setMsg(`Error: ${res.error}`);
    else setMsg('✓ Data refreshed from Didit API. Reload the page to see updates.');
  };

  const handleOverrideSubmit = () => {
    if (!overrideStatus) return;
    startTransition(async () => {
      const res = await adminSetDiditOverride(
        session.didit_session_id,
        overrideStatus as 'Approved' | 'Declined',
        overrideReason.trim() || undefined
      );
      if (res?.error) setMsg(`Error: ${res.error}`);
      else {
        setMsg(`✓ Override set to "${overrideStatus}" — reload page to see updated status.`);
        setOverrideMode(false);
      }
    });
  };

  const handleClearOverride = () => {
    startTransition(async () => {
      const res = await adminSetDiditOverride(session.didit_session_id, null, undefined);
      if (res?.error) setMsg(`Error: ${res.error}`);
      else setMsg('✓ Override cleared — Didit status is now the effective status.');
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl mt-8 mb-8 rounded-3xl border border-white/10 bg-[#141a2e] text-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-4 bg-white/[0.015]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={18} className="text-[#a78bfa]" />
              <h3 className="text-lg font-bold text-white">Didit Verification Report</h3>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                session.session_kind === 'KYC'
                  ? 'text-violet-300 bg-violet-500/10 border-violet-500/20'
                  : 'text-blue-300 bg-blue-500/10 border-blue-500/20'
              }`}>
                {session.session_kind}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 font-mono break-all">{session.didit_session_id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-xl hover:bg-white/5 shrink-0 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status row */}
        <div className="p-4 border-b border-white/5 flex flex-wrap gap-2 items-center bg-white/[0.01]">
          <span className="text-xs text-gray-500">Didit status:</span>
          <StatusBadge status={session.status} />
          {session.admin_override_status && (
            <>
              <span className="text-xs text-gray-500 ml-1">→ Admin override:</span>
              <StatusBadge status={session.admin_override_status} />
            </>
          )}
          {session.created_at && (
            <span className="text-[11px] text-gray-500 ml-auto">
              Submitted {new Date(session.created_at).toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="p-5 space-y-5">
          {/* Message toast */}
          {msg && (
            <div className={`text-xs p-3 rounded-2xl border flex items-start gap-2 ${
              msg.startsWith('Error')
                ? 'text-red-400 bg-red-500/10 border-red-500/20'
                : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
            }`}>
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>{msg}</span>
            </div>
          )}

          {/* ── KYC Personal Identity Data ─────────────────────────── */}
          {hasPersonalData && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <User size={14} className="text-[#a78bfa]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">Identity Details</h4>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { label: 'First Name', value: session.first_name, icon: <User size={11} /> },
                  { label: 'Last Name', value: session.last_name, icon: <User size={11} /> },
                  { label: 'Date of Birth', value: session.date_of_birth, icon: <Calendar size={11} /> },
                  { label: 'Nationality', value: session.nationality, icon: <Globe size={11} /> },
                  { label: 'Gender', value: session.gender, icon: <Users size={11} /> },
                  { label: 'Document Type', value: session.document_type, icon: <FileText size={11} /> },
                  { label: 'Document No.', value: session.document_number, icon: <Hash size={11} /> },
                  { label: 'Personal No.', value: session.personal_number, icon: <CreditCard size={11} /> },
                  { label: 'Issuing State', value: session.issuing_state, icon: <MapPin size={11} /> },
                  { label: 'Expiry Date', value: session.expiration_date, icon: <Calendar size={11} /> },
                ].filter(f => f.value).map(({ label, value, icon }) => (
                  <div key={label} className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-1">
                      {icon}{label}
                    </p>
                    <p className="text-xs text-gray-200 font-medium break-words">{value}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── KYB Company Data ──────────────────────────────────── */}
          {hasCompanyData && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Building2 size={14} className="text-blue-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">Company Details</h4>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { label: 'Company Name', value: session.company_name },
                  { label: 'Reg. No.', value: session.registration_number },
                  { label: 'Type', value: session.company_type },
                  { label: 'Incorporated', value: session.incorporation_date },
                  { label: 'Status', value: session.company_status },
                  { label: 'Country', value: session.company_country },
                ].filter(f => f.value).map(({ label, value }) => (
                  <div key={label} className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{label}</p>
                    <p className="text-xs text-gray-200 font-medium">{value}</p>
                  </div>
                ))}
              </div>

              {/* Key People (Officers/UBOs) */}
              {session.kyb_key_people && Array.isArray(session.kyb_key_people) && session.kyb_key_people.length > 0 && (
                <div className="mt-3 p-3 rounded-2xl bg-white/[0.02] border border-white/5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-2">
                    <Users size={12} className="text-blue-400" /> Key People / Officers
                  </p>
                  <div className="space-y-1.5">
                    {session.kyb_key_people.map((person: Record<string, unknown>, i: number) => {
                      const name = String(person.name || person.full_name || `Person ${i + 1}`);
                      const role = person.role ? String(person.role) : null;
                      const nationality = person.nationality ? String(person.nationality) : null;
                      const ubo = person.ubo_percentage ? String(person.ubo_percentage) : null;
                      return (
                        <div key={i} className="flex flex-wrap gap-2 text-[11px] text-gray-300 py-1.5 border-t border-white/5 first:border-0">
                          <span className="font-semibold">{name}</span>
                          {role && <span className="text-gray-500">· {role}</span>}
                          {nationality && <span className="text-gray-500">· {nationality}</span>}
                          {ubo && <span className="text-violet-400">· {ubo}% UBO</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Verification Check Scores ─────────────────────────── */}
          {hasScores && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Activity size={14} className="text-emerald-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">Verification Checks</h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {/* Liveness */}
                {(session.liveness_score != null || session.liveness_status) && (
                  <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Eye size={10} />Liveness Check
                    </p>
                    <ScorePill score={session.liveness_score} label="Score" />
                    {session.liveness_status && (
                      <p className="mt-1.5"><StatusBadge status={session.liveness_status} /></p>
                    )}
                  </div>
                )}

                {/* Face Match */}
                {(session.face_match_score != null || session.face_match_status) && (
                  <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Fingerprint size={10} />Face Match
                    </p>
                    <ScorePill score={session.face_match_score} label="Score" />
                    {session.face_match_status && (
                      <p className="mt-1.5"><StatusBadge status={session.face_match_status} /></p>
                    )}
                  </div>
                )}

                {/* AML */}
                {session.aml_status && (
                  <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Shield size={10} />AML Screening
                    </p>
                    <StatusBadge status={session.aml_status} />
                    {(session.aml_hits ?? 0) > 0 && (
                      <p className="mt-1.5 text-[11px] text-red-400">⚠ {session.aml_hits} hit(s) found</p>
                    )}
                    {(session.aml_hits ?? 0) === 0 && (
                      <p className="mt-1.5 text-[11px] text-emerald-400">No hits</p>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Device / IP Information ───────────────────────────── */}
          {hasDevice && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Smartphone size={14} className="text-amber-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">Device & IP Analysis</h4>
              </div>
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {session.device_ip && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase mb-1">IP Address</p>
                    <p className="text-xs text-gray-200 font-mono">{session.device_ip}</p>
                  </div>
                )}
                {session.device_country && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase mb-1">Country</p>
                    <p className="text-xs text-gray-200">{session.device_country}</p>
                  </div>
                )}
                {session.device_platform && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase mb-1">Platform</p>
                    <p className="text-xs text-gray-200">{session.device_platform}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-gray-500 uppercase mb-1">VPN Detected</p>
                  <p className={`text-xs font-bold ${session.is_vpn ? 'text-red-400' : 'text-emerald-400'}`}>
                    {session.is_vpn ? '⚠ Yes (VPN)' : '✓ No VPN'}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* No data yet message */}
          {!hasPersonalData && !hasCompanyData && !hasScores && !hasDevice && (
            <div className="py-8 text-center text-gray-500">
              <Fingerprint size={32} className="mx-auto mb-2 text-violet-500/30" />
              <p className="text-sm font-medium text-gray-400">No Didit data stored yet</p>
              <p className="text-xs text-gray-600 mt-1">
                The full decision payload will be stored automatically when the session reaches a terminal status (Approved/Declined), or you can fetch it manually below.
              </p>
            </div>
          )}

          {/* ── Admin Override Section ────────────────────────────── */}
          <section className="border-t border-white/10 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Edit3 size={14} className="text-[#a78bfa]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">Admin Override</h4>
              </div>
              <div className="flex items-center gap-2">
                {session.admin_override_status && (
                  <button
                    type="button"
                    onClick={handleClearOverride}
                    disabled={isPending}
                    className="text-[11px] text-gray-400 hover:text-red-400 transition flex items-center gap-1 disabled:opacity-50"
                  >
                    <Unlock size={11} /> Clear override
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOverrideMode(m => !m)}
                  className="text-[11px] text-[#a78bfa] hover:text-violet-300 transition flex items-center gap-1"
                >
                  <Lock size={11} /> {overrideMode ? 'Cancel' : 'Set override'}
                </button>
              </div>
            </div>

            {session.admin_override_status && !overrideMode && (
              <div className="p-3 rounded-2xl bg-violet-500/5 border border-violet-500/15 text-xs text-gray-300">
                <span className="text-violet-400 font-semibold">Override active: </span>
                {session.admin_override_status}
                {session.admin_override_reason && ` — "${session.admin_override_reason}"`}
                {session.admin_override_at && (
                  <span className="text-gray-500 ml-1">
                    · {new Date(session.admin_override_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}

            {overrideMode && (
              <div className="space-y-3 p-4 rounded-2xl bg-white/[0.02] border border-white/10">
                <div className="flex gap-3">
                  {(['Approved', 'Declined'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setOverrideStatus(s)}
                      className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition ${
                        overrideStatus === s
                          ? s === 'Approved'
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                            : 'bg-red-500/20 border-red-500/40 text-red-400'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      {s === 'Approved' ? <CheckCircle size={13} className="inline mr-1" /> : <XCircle size={13} className="inline mr-1" />}
                      {s}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Optional override reason..."
                  value={overrideReason}
                  onChange={e => setOverrideReason(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-white/10 bg-[#141a2e] text-sm text-white placeholder:text-gray-600 focus:border-[#a78bfa] focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOverrideMode(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/5 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleOverrideSubmit}
                    disabled={isPending || !overrideStatus}
                    className="px-4 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-[#a78bfa] border border-violet-500/30 text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isPending ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
                    Apply Override
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Footer actions ───────────────────────────────────── */}
          <div className="border-t border-white/10 pt-4 flex items-center justify-between flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRefetch}
              disabled={refetching}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 font-medium transition disabled:opacity-50"
            >
              {refetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Re-fetch from Didit API
            </button>

            {session.didit_decision_payload && (
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-300 flex items-center gap-1">
                  <FileText size={11} /> View raw payload
                </summary>
                <pre className="mt-2 p-3 rounded-xl bg-black/40 border border-white/5 text-[10px] text-gray-400 overflow-x-auto max-h-[200px] overflow-y-auto">
                  {JSON.stringify(session.didit_decision_payload, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination Helpers & Component
// ─────────────────────────────────────────────────────────────────────────────

function getPageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total];
  }
  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, '...', current - 1, current, current + 1, '...', total];
}

interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  itemLabel?: string;
}

function TablePagination({
  currentPage,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel = 'items',
}: TablePaginationProps) {
  if (totalItems === 0) return null;

  return (
    <div className="p-4 sm:p-5 border-t border-white/5 bg-white/[0.015] flex flex-col sm:flex-row items-center justify-between gap-4">
      {/* Left: Range and Page Size */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs text-gray-400">
        <span>
          Showing <strong className="text-white font-semibold">{startIndex + 1}</strong> to{' '}
          <strong className="text-white font-semibold">{endIndex}</strong> of{' '}
          <strong className="text-white font-semibold">{totalItems}</strong> {itemLabel}
        </span>

        <div className="flex items-center gap-1.5 border-l border-white/10 pl-3 sm:pl-4">
          <span className="text-gray-500">Rows:</span>
          {[10, 25, 50].map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => onPageSizeChange(size)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                pageSize === size
                  ? 'bg-[#a78bfa] text-black shadow-sm font-bold'
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Page Buttons */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            className="p-1.5 rounded-xl border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="First Page"
          >
            <ChevronsLeft size={15} />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="p-1.5 rounded-xl border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="Previous Page"
          >
            <ChevronLeft size={15} />
          </button>

          <div className="flex items-center gap-1 mx-1">
            {getPageNumbers(currentPage, totalPages).map((p, idx) =>
              p === '...' ? (
                <span key={`ellipsis-${idx}`} className="px-2 text-xs text-gray-500 select-none">
                  &hellip;
                </span>
              ) : (
                <button
                  key={`page-${p}`}
                  type="button"
                  onClick={() => onPageChange(Number(p))}
                  className={`min-w-[32px] h-8 px-2.5 rounded-xl text-xs font-semibold transition ${
                    currentPage === p
                      ? 'bg-[#a78bfa] text-black font-bold shadow-md'
                      : 'bg-white/[0.03] text-gray-300 hover:text-white hover:bg-white/10 border border-white/5'
                  }`}
                >
                  {p}
                </button>
              )
            )}
          </div>

          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-xl border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="Next Page"
          >
            <ChevronRight size={15} />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-xl border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="Last Page"
          >
            <ChevronsRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function KYCVerificationManager({
  pendingUsers,
  inReviewUsers = [],
  declinedUsers = [],
  verifiedUsers,
  pendingBusinesses,
  verifiedBusinesses = [],
  diditSessions = [],
  adminActions = [],
}: KYCVerificationManagerProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [isPending, startTransition] = useTransition();

  // Active top-level tab
  const [activeTab, setActiveTab] = useState<'requests' | 'queue' | 'history' | 'didit' | 'verified'>('requests');

  // Requests Table Filters & Pagination
  const [reqStatusFilter, setReqStatusFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');
  const [reqTypeFilter, setReqTypeFilter] = useState<'all' | 'kyc' | 'kyb'>('all');
  const [reqSearch, setReqSearch] = useState('');
  const [reqPage, setReqPage] = useState(1);
  const [reqPageSize, setReqPageSize] = useState(10);

  // Action History Table Filters & Pagination
  const [historyActionFilter, setHistoryActionFilter] = useState<'all' | 'approved' | 'rejected' | 'revoked' | 'override'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);

  // Local state for dynamic updates
  const [usersState, setUsersState] = useState<Profile[]>(() => {
    const map = new Map<string, Profile>();
    pendingUsers.forEach(u => map.set(u.user_id, u));
    inReviewUsers.forEach(u => map.set(u.user_id, u));
    declinedUsers.forEach(u => map.set(u.user_id, u));
    verifiedUsers.forEach(u => map.set(u.user_id, u));
    return Array.from(map.values());
  });

  const [businessesState, setBusinessesState] = useState<Business[]>(() => {
    const map = new Map<string, Business>();
    pendingBusinesses.forEach(b => map.set(b.id, b));
    verifiedBusinesses.forEach(b => map.set(b.id, b));
    return Array.from(map.values());
  });

  const [actionsState, setActionsState] = useState<AdminAction[]>(adminActions);

  // Reject Modal state
  const [rejectModal, setRejectModal] = useState<{
    open: boolean;
    type: 'kyc' | 'kyb';
    id: string;
    title: string;
  }>({ open: false, type: 'kyc', id: '', title: '' });

  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Didit Data Panel
  const [diditPanel, setDiditPanel] = useState<DiditSession | null>(null);

  // Didit Details & User Review Modal with Built-in Message Templates
  const [reviewModalUser, setReviewModalUser] = useState<{ user: Profile; session?: DiditSession | null } | null>(null);

  const openDiditReview = (user: Profile) => {
    const session = getDiditSession(user.user_id, 'KYC');
    setReviewModalUser({ user, session });
  };

  const [syncingAll, setSyncingAll] = useState(false);
  const handleSyncAllSessions = async () => {
    setSyncingAll(true);
    setActionFeedback("Syncing with Didit API in progress...");
    try {
      const res = await adminSyncAllDiditSessions();
      if (res?.error) {
        setActionFeedback(`Sync error: ${res.error}`);
      } else {
        setActionFeedback(`✓ Successfully checked Didit API! Reloading fresh data...`);
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err: any) {
      setActionFeedback(`Sync error: ${err?.message || 'Network error'}`);
    } finally {
      setSyncingAll(false);
    }
  };

  const getDiditSession = (entityId: string, kind: 'KYC' | 'KYB') =>
    diditSessions.find(
      (s) => s.entity_id === entityId && s.session_kind?.toUpperCase() === kind.toUpperCase()
    );

  // Helper to determine accurate user status & rejection reason
  const getUserStatus = (user: Profile) => {
    if (user.identity_verified) {
      return { status: 'accepted' as const, label: 'Accepted / Verified', reason: null, date: null };
    }
    const rejectAction = actionsState.find(
      (a) => a.target_id === user.user_id && (a.action === 'reject_kyc' || a.action === 'revoke_kyc')
    );
    if (rejectAction) {
      const isRevoke = rejectAction.action === 'revoke_kyc';
      return {
        status: isRevoke ? ('revoked' as const) : ('rejected' as const),
        label: isRevoke ? 'Revoked' : 'Rejected',
        reason: rejectAction.reason?.replace(/^Admin rejected KYC:\s*/i, '') || rejectAction.reason,
        date: rejectAction.created_at,
      };
    }
    const session = getDiditSession(user.user_id, 'KYC');
    if (session?.status === 'Declined' || session?.admin_override_status === 'Declined') {
      return {
        status: 'rejected' as const,
        label: 'Declined (Didit)',
        reason: session.admin_override_reason || session.decision || 'Didit verification declined',
        date: session.updated_at || session.created_at,
      };
    }
    return { status: 'pending' as const, label: 'Pending Review', reason: null, date: null };
  };

  // Helper to determine accurate business status & rejection reason
  const getBusinessStatus = (biz: Business) => {
    if (biz.kyb_verified) {
      return { status: 'accepted' as const, label: 'Accepted / Verified', reason: null, date: null };
    }
    const rejectAction = actionsState.find(
      (a) => a.target_id === biz.id && (a.action === 'reject_kyb' || a.action === 'revoke_kyb')
    );
    if (rejectAction) {
      const isRevoke = rejectAction.action === 'revoke_kyb';
      return {
        status: isRevoke ? ('revoked' as const) : ('rejected' as const),
        label: isRevoke ? 'Revoked' : 'Rejected',
        reason: rejectAction.reason?.replace(/^Admin rejected KYB:\s*/i, '') || rejectAction.reason,
        date: rejectAction.created_at,
      };
    }
    const session = getDiditSession(biz.id, 'KYB');
    if (session?.status === 'Declined' || session?.admin_override_status === 'Declined') {
      return {
        status: 'rejected' as const,
        label: 'Declined (Didit)',
        reason: session.admin_override_reason || session.decision || 'Didit verification declined',
        date: session.updated_at || session.created_at,
      };
    }
    return { status: 'pending' as const, label: 'Pending Review', reason: null, date: null };
  };

  // Resolve target name for history rows
  const resolveTargetInfo = (targetType: string, targetId: string) => {
    if (targetType === 'profile') {
      const u = usersState.find(p => p.user_id === targetId);
      return {
        name: u?.full_name || 'Individual Profile',
        type: 'KYC',
        sub: targetId,
      };
    }
    if (targetType === 'business') {
      const b = businessesState.find(biz => biz.id === targetId);
      return {
        name: b?.business_name || 'Business Entity',
        type: 'KYB',
        sub: targetId,
      };
    }
    if (targetType === 'verification_session') {
      const s = diditSessions.find(ds => ds.didit_session_id === targetId);
      return {
        name: s?.first_name ? `${s.first_name} ${s.last_name || ''}` : s?.company_name || 'Verification Session',
        type: s?.session_kind || 'Didit',
        sub: targetId,
      };
    }
    return { name: targetId.slice(0, 16) + '…', type: targetType, sub: targetId };
  };

  // Unified requests for the master directory
  const unifiedRequests: Array<{
    id: string;
    kind: 'KYC' | 'KYB';
    name: string;
    sub: string;
    status: 'accepted' | 'rejected' | 'revoked' | 'pending';
    statusLabel: string;
    reason: string | null;
    date: string | null;
    diditSession?: DiditSession;
    hasDocs: boolean;
    docLinks: Array<{ label: string; url: string }>;
    rawUser?: Profile;
    rawBusiness?: Business;
  }> = [];

  // Add users
  usersState.forEach(u => {
    const st = getUserStatus(u);
    const ds = getDiditSession(u.user_id, 'KYC');
    const docs: Array<{ label: string; url: string }> = [];
    if (u.national_id_url) docs.push({ label: 'National ID / CNIC', url: u.national_id_url });
    if (u.passport_url) docs.push({ label: 'Passport', url: u.passport_url });
    if (u.selfie_url) docs.push({ label: 'Selfie / Face', url: u.selfie_url });
    if (u.proof_of_address_url) docs.push({ label: 'Proof of Address', url: u.proof_of_address_url });

    unifiedRequests.push({
      id: u.user_id,
      kind: 'KYC',
      name: u.full_name || 'Anonymous Investor',
      sub: u.user_id,
      status: st.status,
      statusLabel: st.label,
      reason: st.reason,
      date: st.date || u.created_at || null,
      diditSession: ds,
      hasDocs: docs.length > 0,
      docLinks: docs,
      rawUser: u,
    });
  });

  // Add businesses
  businessesState.forEach(b => {
    const st = getBusinessStatus(b);
    const ds = getDiditSession(b.id, 'KYB');
    const docs: Array<{ label: string; url: string }> = [];
    if (b.profiles?.business_reg_url) docs.push({ label: 'Incorporation Doc', url: b.profiles.business_reg_url });
    if (b.profiles?.tax_cert_url) docs.push({ label: 'Tax / NTN Cert', url: b.profiles.tax_cert_url });
    if (b.profiles?.bank_statement_url) docs.push({ label: 'Bank Statement', url: b.profiles.bank_statement_url });

    unifiedRequests.push({
      id: b.id,
      kind: 'KYB',
      name: b.business_name || 'Business Entity',
      sub: b.profiles?.full_name ? `Owner: ${b.profiles.full_name}` : b.id,
      status: st.status,
      statusLabel: st.label,
      reason: st.reason,
      date: st.date || b.created_at || null,
      diditSession: ds,
      hasDocs: docs.length > 0,
      docLinks: docs,
      rawBusiness: b,
    });
  });

  // Overall counts
  const counts = {
    total: unifiedRequests.length,
    accepted: unifiedRequests.filter(r => r.status === 'accepted').length,
    rejected: unifiedRequests.filter(r => r.status === 'rejected' || r.status === 'revoked').length,
    pending: unifiedRequests.filter(r => r.status === 'pending').length,
  };

  // Filtered requests
  const filteredRequests = unifiedRequests.filter(item => {
    if (reqStatusFilter === 'accepted' && item.status !== 'accepted') return false;
    if (reqStatusFilter === 'rejected' && item.status !== 'rejected' && item.status !== 'revoked') return false;
    if (reqStatusFilter === 'pending' && item.status !== 'pending') return false;

    if (reqTypeFilter === 'kyc' && item.kind !== 'KYC') return false;
    if (reqTypeFilter === 'kyb' && item.kind !== 'KYB') return false;

    if (reqSearch.trim()) {
      const q = reqSearch.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchId = item.id.toLowerCase().includes(q);
      const matchReason = item.reason?.toLowerCase().includes(q);
      const matchSub = item.sub?.toLowerCase().includes(q);
      if (!matchName && !matchId && !matchReason && !matchSub) return false;
    }
    return true;
  });

  // Requests Pagination
  const totalReqItems = filteredRequests.length;
  const totalReqPages = Math.max(1, Math.ceil(totalReqItems / reqPageSize));
  const currentReqPage = Math.min(Math.max(1, reqPage), totalReqPages);
  const reqStartIndex = (currentReqPage - 1) * reqPageSize;
  const reqEndIndex = Math.min(reqStartIndex + reqPageSize, totalReqItems);
  const paginatedRequests = filteredRequests.slice(reqStartIndex, reqEndIndex);

  // Filtered audit history actions
  const filteredActions = actionsState.filter(act => {
    if (historyActionFilter === 'approved' && !act.action.includes('verify')) return false;
    if (historyActionFilter === 'rejected' && !act.action.includes('reject')) return false;
    if (historyActionFilter === 'revoked' && !act.action.includes('revoke')) return false;
    if (historyActionFilter === 'override' && !act.action.includes('override')) return false;

    if (historySearch.trim()) {
      const q = historySearch.toLowerCase();
      const matchAction = act.action.toLowerCase().includes(q);
      const matchReason = act.reason?.toLowerCase().includes(q);
      const matchTarget = act.target_id.toLowerCase().includes(q);
      const matchAdmin = act.admin_id.toLowerCase().includes(q);
      const targetInfo = resolveTargetInfo(act.target_type, act.target_id);
      const matchName = targetInfo.name.toLowerCase().includes(q);
      if (!matchAction && !matchReason && !matchTarget && !matchAdmin && !matchName) return false;
    }
    return true;
  });

  // History Pagination
  const totalHistoryItems = filteredActions.length;
  const totalHistoryPages = Math.max(1, Math.ceil(totalHistoryItems / historyPageSize));
  const currentHistoryPage = Math.min(Math.max(1, historyPage), totalHistoryPages);
  const historyStartIndex = (currentHistoryPage - 1) * historyPageSize;
  const historyEndIndex = Math.min(historyStartIndex + historyPageSize, totalHistoryItems);
  const paginatedActions = filteredActions.slice(historyStartIndex, historyEndIndex);

  // Pending queues for Review Queue tab
  const pendingKYC = usersState.filter(u =>
    !u.identity_verified &&
    getUserStatus(u).status === 'pending' &&
    !(inReviewUsers || []).some(r => r.user_id === u.user_id) &&
    !(declinedUsers || []).some(r => r.user_id === u.user_id)
  );
  const pendingKYB = businessesState.filter(b => getBusinessStatus(b).status === 'pending');

  // In Review queues — pulled from the pre-classified inReviewUsers prop
  const inReviewKYC = usersState.filter(u => (inReviewUsers || []).some(r => r.user_id === u.user_id));

  // Declined queues — pulled from the pre-classified declinedUsers prop
  const declinedKYC = usersState.filter(u => (declinedUsers || []).some(r => r.user_id === u.user_id));

  // Verified users and businesses for Verified Directory tab
  const activeVerifiedUsers = usersState.filter(u => !!u.identity_verified);
  const activeVerifiedBusinesses = businessesState.filter(b => !!b.kyb_verified);

  // Handlers
  const handleApproveKYC = (userId: string) => {
    setActionFeedback(null);
    startTransition(async () => {
      setUsersState(prev => prev.map(u => u.user_id === userId ? { ...u, identity_verified: true } : u));
      const targetUser = usersState.find(u => u.user_id === userId);
      const newAction: AdminAction = {
        id: crypto.randomUUID(),
        admin_id: 'Admin',
        action: 'verify_kyc',
        target_type: 'profile',
        target_id: userId,
        reason: 'Admin manually approved KYC credentials',
        created_at: new Date().toISOString(),
      };
      setActionsState(prev => [newAction, ...prev]);

      const res = await adminVerifyKYC(userId);
      if (res?.error) {
        setActionFeedback(`Error: ${res.error}`);
        setUsersState(prev => prev.map(u => u.user_id === userId ? { ...u, identity_verified: false } : u));
      } else {
        setActionFeedback(`✓ KYC approved for ${targetUser?.full_name || 'User'}. Status updated to Accepted.`);
      }
    });
  };

  const handleApproveKYB = (businessId: string) => {
    setActionFeedback(null);
    startTransition(async () => {
      setBusinessesState(prev => prev.map(b => b.id === businessId ? { ...b, kyb_verified: true } : b));
      const targetBiz = businessesState.find(b => b.id === businessId);
      const newAction: AdminAction = {
        id: crypto.randomUUID(),
        admin_id: 'Admin',
        action: 'verify_kyb',
        target_type: 'business',
        target_id: businessId,
        reason: 'Admin manually approved KYB credentials',
        created_at: new Date().toISOString(),
      };
      setActionsState(prev => [newAction, ...prev]);

      const res = await adminVerifyKYB(businessId);
      if (res?.error) {
        setActionFeedback(`Error: ${res.error}`);
        setBusinessesState(prev => prev.map(b => b.id === businessId ? { ...b, kyb_verified: false } : b));
      } else {
        setActionFeedback(`✓ KYB approved for ${targetBiz?.business_name || 'Business'}. Status updated to Accepted.`);
      }
    });
  };

  const openRejectModal = (type: 'kyc' | 'kyb', id: string, title: string) => {
    setSelectedReason(type === 'kyc' ? DIDIT_KYC_REASONS[0] : DIDIT_KYB_REASONS[0]);
    setCustomReason('');
    setRejectModal({ open: true, type, id, title });
  };

  const submitReject = () => {
    const finalReason =
      selectedReason === 'Other / Custom reason'
        ? customReason.trim() || 'Did not meet requirements'
        : selectedReason;
    setActionFeedback(null);
    startTransition(async () => {
      if (rejectModal.type === 'kyc') {
        setUsersState(prev => prev.map(u => u.user_id === rejectModal.id ? { ...u, identity_verified: false } : u));
        const newAction: AdminAction = {
          id: crypto.randomUUID(),
          admin_id: 'Admin',
          action: 'reject_kyc',
          target_type: 'profile',
          target_id: rejectModal.id,
          reason: `Admin rejected KYC: ${finalReason}`,
          created_at: new Date().toISOString(),
        };
        setActionsState(prev => [newAction, ...prev]);

        const res = await adminRejectKYC(rejectModal.id, finalReason);
        if (res?.error) setActionFeedback(`Error: ${res.error}`);
        else setActionFeedback(`✓ KYC rejected: "${finalReason}". User marked as Rejected.`);
      } else {
        setBusinessesState(prev => prev.map(b => b.id === rejectModal.id ? { ...b, kyb_verified: false } : b));
        const newAction: AdminAction = {
          id: crypto.randomUUID(),
          admin_id: 'Admin',
          action: 'reject_kyb',
          target_type: 'business',
          target_id: rejectModal.id,
          reason: `Admin rejected KYB: ${finalReason}`,
          created_at: new Date().toISOString(),
        };
        setActionsState(prev => [newAction, ...prev]);

        const res = await adminRejectKYB(rejectModal.id, finalReason);
        if (res?.error) setActionFeedback(`Error: ${res.error}`);
        else setActionFeedback(`✓ KYB rejected: "${finalReason}". Business marked as Rejected.`);
      }
      setRejectModal({ open: false, type: 'kyc', id: '', title: '' });
    });
  };

  const handleRevokeKYC = (userId: string) => {
    if (!confirm('Are you sure you want to revoke this user verification?')) return;
    setActionFeedback(null);
    startTransition(async () => {
      setUsersState(prev => prev.map(u => u.user_id === userId ? { ...u, identity_verified: false } : u));
      const newAction: AdminAction = {
        id: crypto.randomUUID(),
        admin_id: 'Admin',
        action: 'revoke_kyc',
        target_type: 'profile',
        target_id: userId,
        reason: 'Admin revoked KYC status',
        created_at: new Date().toISOString(),
      };
      setActionsState(prev => [newAction, ...prev]);

      const res = await adminRevokeKYC(userId);
      if (res?.error) setActionFeedback(`Error: ${res.error}`);
      else setActionFeedback('✓ Verification revoked. Status updated.');
    });
  };

  const handleRevokeKYB = (businessId: string) => {
    if (!confirm('Are you sure you want to revoke this business verification?')) return;
    setActionFeedback(null);
    startTransition(async () => {
      setBusinessesState(prev => prev.map(b => b.id === businessId ? { ...b, kyb_verified: false } : b));
      const newAction: AdminAction = {
        id: crypto.randomUUID(),
        admin_id: 'Admin',
        action: 'revoke_kyb',
        target_type: 'business',
        target_id: businessId,
        reason: 'Admin revoked KYB status',
        created_at: new Date().toISOString(),
      };
      setActionsState(prev => [newAction, ...prev]);

      const res = await adminRevokeKYB(businessId);
      if (res?.error) setActionFeedback(`Error: ${res.error}`);
      else setActionFeedback('✓ Business KYB verification revoked. Status updated.');
    });
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-center p-16 text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#a78bfa] mr-3" />
        <span className="text-sm font-medium">Loading Verification &amp; Governance Portal...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Toast Feedback */}
      {actionFeedback && (
        <div className={`rounded-2xl border p-4 text-sm flex items-center justify-between shadow-xl ${
          actionFeedback.startsWith('Error')
            ? 'bg-red-500/10 border-red-500/30 text-red-300'
            : 'bg-[#1a2030] border-[#a78bfa]/30 text-[#a78bfa]'
        }`}>
          <div className="flex items-center gap-2">
            <Info size={16} />
            <span>{actionFeedback}</span>
          </div>
          <button onClick={() => setActionFeedback(null)} className="text-gray-400 hover:text-white p-1">
            <X size={15} />
          </button>
        </div>
      )}

      {/* ── Key Metrics Overview ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-5 rounded-3xl bg-[#1a2030] border border-white/5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">All Submissions</span>
            <Users size={16} className="text-[#a78bfa]" />
          </div>
          <div className="text-2xl font-black text-white">{counts.total}</div>
          <p className="text-[11px] text-gray-500 mt-1">Total KYC &amp; KYB records</p>
        </div>

        <div className="p-5 rounded-3xl bg-[#1a2030] border border-emerald-500/10 flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Accepted / Verified</span>
            <CheckCircle size={16} />
          </div>
          <div className="text-2xl font-black text-emerald-400">{counts.accepted}</div>
          <p className="text-[11px] text-gray-500 mt-1">Active verified credentials</p>
        </div>

        <div className="p-5 rounded-3xl bg-[#1a2030] border border-red-500/10 flex flex-col justify-between">
          <div className="flex items-center justify-between text-red-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Rejected / Declined</span>
            <XCircle size={16} />
          </div>
          <div className="text-2xl font-black text-red-400">{counts.rejected}</div>
          <p className="text-[11px] text-gray-500 mt-1">Admin or Didit rejected</p>
        </div>

        <div className="p-5 rounded-3xl bg-[#1a2030] border border-amber-500/10 flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending Review</span>
            <Clock size={16} />
          </div>
          <div className="text-2xl font-black text-amber-400">{counts.pending}</div>
          <p className="text-[11px] text-gray-500 mt-1">Awaiting admin review</p>
        </div>
      </div>

      {/* ── Navigation Tab Bar ── */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'requests'
              ? 'bg-[#a78bfa] text-black shadow-lg shadow-violet-500/20'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <ListFilter size={15} />
          All Requests &amp; Status
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'requests' ? 'bg-black/20 text-black' : 'bg-white/10 text-gray-300'}`}>
            {unifiedRequests.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'history'
              ? 'bg-[#a78bfa] text-black shadow-lg shadow-violet-500/20'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <History size={15} />
          Admin Action Audit Log
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'history' ? 'bg-black/20 text-black' : 'bg-white/10 text-gray-300'}`}>
            {actionsState.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'queue'
              ? 'bg-[#a78bfa] text-black shadow-lg shadow-violet-500/20'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Clock size={15} />
          Review Queue
          {(pendingKYC.length + pendingKYB.length + inReviewKYC.length + declinedKYC.length) > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'queue' ? 'bg-black/20 text-black' : 'bg-amber-500/20 text-amber-300'}`}>
              {pendingKYC.length + pendingKYB.length + inReviewKYC.length + declinedKYC.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('didit')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'didit'
              ? 'bg-[#a78bfa] text-black shadow-lg shadow-violet-500/20'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Fingerprint size={15} />
          Didit Sessions
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'didit' ? 'bg-black/20 text-black' : 'bg-white/10 text-gray-300'}`}>
            {diditSessions.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('verified')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'verified'
              ? 'bg-[#a78bfa] text-black shadow-lg shadow-violet-500/20'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <ShieldCheck size={15} />
          Verified Directory
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'verified' ? 'bg-black/20 text-black' : 'bg-white/10 text-gray-300'}`}>
            {activeVerifiedUsers.length + activeVerifiedBusinesses.length}
          </span>
        </button>

        <button
          type="button"
          onClick={handleSyncAllSessions}
          disabled={syncingAll}
          className="ml-auto flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-purple-500/15 hover:bg-purple-500/25 text-[#a78bfa] border border-purple-500/30 text-xs font-bold transition disabled:opacity-50 whitespace-nowrap cursor-pointer shadow-sm"
          title="Query Didit REST API to refresh all verification statuses and decisions"
        >
          <RefreshCw size={14} className={syncingAll ? 'animate-spin text-purple-300' : 'text-[#a78bfa]'} />
          {syncingAll ? 'Checking Didit...' : 'Sync Didit API'}
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          TAB 1: All Requests & Status (The Unified Tabular Directory requested by user)
      ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'requests' && (
        <div className="bg-[#1a2030] rounded-3xl border border-white/5 overflow-hidden flex flex-col">
          {/* Header & Filters */}
          <div className="p-6 border-b border-white/5 bg-white/[0.02] flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <ListFilter className="h-5 w-5 text-[#a78bfa]" />
                  KYC &amp; KYB Verification Request History
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Comprehensive tabular record of all applicants. Any rejection or approval instantly updates here.
                </p>
              </div>

              {/* Status Filter Chips */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => { setReqStatusFilter('all'); setReqPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    reqStatusFilter === 'all'
                      ? 'bg-white/15 text-white border border-white/20'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  All ({counts.total})
                </button>
                <button
                  type="button"
                  onClick={() => { setReqStatusFilter('accepted'); setReqPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    reqStatusFilter === 'accepted'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <CheckCircle size={12} className="text-emerald-400" />
                  Accepted ({counts.accepted})
                </button>
                <button
                  type="button"
                  onClick={() => { setReqStatusFilter('rejected'); setReqPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    reqStatusFilter === 'rejected'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <XCircle size={12} className="text-red-400" />
                  Rejected ({counts.rejected})
                </button>
                <button
                  type="button"
                  onClick={() => { setReqStatusFilter('pending'); setReqPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    reqStatusFilter === 'pending'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <Clock size={12} className="text-amber-400" />
                  Pending ({counts.pending})
                </button>
              </div>
            </div>

            {/* Search and Secondary Filter */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search by name, wallet, ID, or rejection reason..."
                  value={reqSearch}
                  onChange={e => { setReqSearch(e.target.value); setReqPage(1); }}
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-[#141a2e] border border-white/10 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#a78bfa] transition"
                />
                {reqSearch && (
                  <button
                    type="button"
                    onClick={() => { setReqSearch(''); setReqPage(1); }}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Entity Type Filter */}
              <div className="flex items-center gap-1 bg-[#141a2e] p-1 rounded-2xl border border-white/10 self-stretch sm:self-auto">
                <button
                  type="button"
                  onClick={() => { setReqTypeFilter('all'); setReqPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    reqTypeFilter === 'all' ? 'bg-[#a78bfa]/20 text-[#a78bfa]' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  All Types
                </button>
                <button
                  type="button"
                  onClick={() => { setReqTypeFilter('kyc'); setReqPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    reqTypeFilter === 'kyc' ? 'bg-violet-500/20 text-violet-300' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  KYC (Individual)
                </button>
                <button
                  type="button"
                  onClick={() => { setReqTypeFilter('kyb'); setReqPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    reqTypeFilter === 'kyb' ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  KYB (Business)
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.01]">
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Applicant / Entity</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Type</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Status</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Didit Biometrics</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Decision / Reason</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Date</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-500">
                      <ListFilter className="h-8 w-8 mx-auto mb-2 text-violet-500/30" />
                      <p className="text-sm font-semibold text-gray-300">No verification requests found matching your filter.</p>
                      <p className="text-xs text-gray-500 mt-1">Try clearing the search query or changing the filter chip above.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRequests.map(req => {
                    const isAccepted = req.status === 'accepted';
                    const isRejected = req.status === 'rejected' || req.status === 'revoked';
                    const isPendingReview = req.status === 'pending';

                    return (
                      <tr key={`${req.kind}-${req.id}`} className="hover:bg-white/[0.02] transition">
                        {/* Applicant */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`h-9 w-9 rounded-2xl flex items-center justify-center shrink-0 border ${
                              req.kind === 'KYC'
                                ? 'bg-violet-500/10 border-violet-500/20 text-[#a78bfa]'
                                : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                            }`}>
                              {req.kind === 'KYC' ? <User size={16} /> : <Building2 size={16} />}
                            </div>
                            <div>
                              <div className="font-semibold text-white text-sm flex items-center gap-2">
                                {req.name}
                              </div>
                              <p className="text-xs text-gray-400 font-mono mt-0.5 max-w-[200px] truncate" title={req.sub}>
                                {req.sub}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Kind */}
                        <td className="px-5 py-4">
                          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                            req.kind === 'KYC'
                              ? 'text-violet-300 bg-violet-500/10 border-violet-500/20'
                              : 'text-blue-300 bg-blue-500/10 border-blue-500/20'
                          }`}>
                            {req.kind}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4">
                          {isAccepted && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                              <CheckCircle size={13} /> Accepted
                            </span>
                          )}
                          {isRejected && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-400">
                              <XCircle size={13} /> {req.status === 'revoked' ? 'Revoked' : 'Rejected'}
                            </span>
                          )}
                          {isPendingReview && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400">
                              <Clock size={13} /> Pending Review
                            </span>
                          )}
                        </td>

                        {/* Didit Biometrics */}
                        <td className="px-5 py-4">
                          {req.diditSession ? (
                            <div className="flex flex-wrap gap-1.5 max-w-[220px]">
                              {req.diditSession.liveness_score != null && (
                                <ScorePill score={req.diditSession.liveness_score} label="Live" />
                              )}
                              {req.diditSession.face_match_score != null && (
                                <ScorePill score={req.diditSession.face_match_score} label="Face" />
                              )}
                              {req.diditSession.aml_status && (
                                <StatusBadge status={req.diditSession.aml_status} />
                              )}
                              {req.diditSession.is_vpn && (
                                <span className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-lg">
                                  VPN
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-500 text-xs italic">Manual / No Didit</span>
                          )}
                        </td>

                        {/* Decision / Reason */}
                        <td className="px-5 py-4 max-w-[240px]">
                          {req.reason ? (
                            <div className="p-2 rounded-xl bg-red-500/5 border border-red-500/15 text-xs text-red-300">
                              <span className="font-semibold text-red-400 block text-[10px] uppercase tracking-wider mb-0.5">Decline Reason:</span>
                              <span className="line-clamp-2" title={req.reason}>{req.reason}</span>
                            </div>
                          ) : isAccepted ? (
                            <span className="text-xs text-emerald-400/80 font-medium">✓ Approved &amp; verified</span>
                          ) : (
                            <span className="text-xs text-gray-500">Awaiting evaluation</span>
                          )}
                        </td>

                        {/* Date */}
                        <td className="px-5 py-4 text-xs text-gray-400 whitespace-nowrap">
                          {req.date ? new Date(req.date).toLocaleDateString() : '—'}
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            {req.kind === 'KYC' && req.rawUser && (
                              <button
                                type="button"
                                onClick={() => openDiditReview(req.rawUser!)}
                                className="px-2.5 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-[#a78bfa] text-xs font-semibold hover:bg-purple-500/25 transition flex items-center gap-1 shadow-sm"
                              >
                                <Fingerprint size={12} /> Didit Details
                              </button>
                            )}
                            {req.kind !== 'KYC' && req.diditSession && (
                              <button
                                type="button"
                                onClick={() => setDiditPanel(req.diditSession!)}
                                className="px-2.5 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[#a78bfa] text-xs font-semibold hover:bg-purple-500/20 transition flex items-center gap-1"
                              >
                                <Eye size={12} /> Didit Data
                              </button>
                            )}

                            {/* If pending or rejected: allow approve & reject */}
                            {!isAccepted && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openRejectModal(req.kind === 'KYC' ? 'kyc' : 'kyb', req.id, req.name)}
                                  disabled={isPending}
                                  className="px-2.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition flex items-center gap-1 disabled:opacity-50"
                                >
                                  <XCircle size={12} /> Reject
                                </button>
                                <button
                                  type="button"
                                  onClick={() => req.kind === 'KYC' ? handleApproveKYC(req.id) : handleApproveKYB(req.id)}
                                  disabled={isPending}
                                  className="px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition flex items-center gap-1 disabled:opacity-50"
                                >
                                  <CheckCircle size={12} /> Approve
                                </button>
                              </>
                            )}

                            {/* If currently accepted: allow revoke */}
                            {isAccepted && (
                              <button
                                type="button"
                                onClick={() => req.kind === 'KYC' ? handleRevokeKYC(req.id) : handleRevokeKYB(req.id)}
                                disabled={isPending}
                                className="px-2.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition flex items-center gap-1 disabled:opacity-50"
                              >
                                <UserX size={12} /> Revoke
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <TablePagination
            currentPage={currentReqPage}
            totalPages={totalReqPages}
            totalItems={totalReqItems}
            startIndex={reqStartIndex}
            endIndex={reqEndIndex}
            pageSize={reqPageSize}
            onPageChange={setReqPage}
            onPageSizeChange={(newSize) => {
              setReqPageSize(newSize);
              setReqPage(1);
            }}
            itemLabel="verification requests"
          />
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          TAB 2: Admin Action Audit Log (The Tabular Action History requested by user)
      ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="bg-[#1a2030] rounded-3xl border border-white/5 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-white/5 bg-white/[0.02] flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <History className="h-5 w-5 text-[#a78bfa]" />
                  Admin Verification Actions &amp; Audit Trail
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Chronological history of every administrative action (approvals, rejections, revocations, and Didit overrides).
                </p>
              </div>

              {/* Action Filters */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => { setHistoryActionFilter('all'); setHistoryPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    historyActionFilter === 'all'
                      ? 'bg-white/15 text-white border border-white/20'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  All ({actionsState.length})
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryActionFilter('approved'); setHistoryPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    historyActionFilter === 'approved'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <CheckCircle size={12} className="text-emerald-400" />
                  Approvals
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryActionFilter('rejected'); setHistoryPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    historyActionFilter === 'rejected'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <XCircle size={12} className="text-red-400" />
                  Rejections
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryActionFilter('revoked'); setHistoryPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    historyActionFilter === 'revoked'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <RotateCcw size={12} className="text-amber-400" />
                  Revocations
                </button>
                <button
                  type="button"
                  onClick={() => { setHistoryActionFilter('override'); setHistoryPage(1); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    historyActionFilter === 'override'
                      ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <Lock size={12} className="text-violet-400" />
                  Overrides
                </button>
              </div>
            </div>

            {/* History Search */}
            <div className="relative w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search audit trail by admin, target, action, or note..."
                value={historySearch}
                onChange={e => { setHistorySearch(e.target.value); setHistoryPage(1); }}
                className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-[#141a2e] border border-white/10 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#a78bfa] transition"
              />
              {historySearch && (
                <button
                  type="button"
                  onClick={() => { setHistorySearch(''); setHistoryPage(1); }}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Audit Log Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.01]">
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Timestamp</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Action</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Target Entity</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Reason / Notes</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Admin ID</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 text-right">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredActions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-gray-500">
                      <History className="h-8 w-8 mx-auto mb-2 text-violet-500/30" />
                      <p className="text-sm font-semibold text-gray-300">No admin verification actions recorded yet.</p>
                      <p className="text-xs text-gray-500 mt-1">Actions performed on users or businesses will appear here automatically.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedActions.map(act => {
                    const targetInfo = resolveTargetInfo(act.target_type, act.target_id);
                    const isApprove = act.action.includes('verify') || act.action === 'approved';
                    const isReject = act.action.includes('reject');
                    const isRevoke = act.action.includes('revoke');
                    const isOverride = act.action.includes('override');

                    return (
                      <tr key={act.id} className="hover:bg-white/[0.02] transition">
                        {/* Timestamp */}
                        <td className="px-5 py-4 text-xs text-gray-300 whitespace-nowrap">
                          <div className="font-semibold text-white">
                            {new Date(act.created_at).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </div>
                          <div className="text-[11px] text-gray-500 font-mono">
                            {new Date(act.created_at).toLocaleTimeString(undefined, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </td>

                        {/* Action Badge */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          {isApprove && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                              <CheckCircle size={13} />
                              {act.action === 'verify_kyb' ? 'Approved KYB' : 'Approved KYC'}
                            </span>
                          )}
                          {isReject && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-400">
                              <XCircle size={13} />
                              {act.action === 'reject_kyb' ? 'Rejected KYB' : 'Rejected KYC'}
                            </span>
                          )}
                          {isRevoke && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400">
                              <RotateCcw size={13} />
                              {act.action === 'revoke_kyb' ? 'Revoked KYB' : 'Revoked KYC'}
                            </span>
                          )}
                          {isOverride && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-violet-500/10 border border-violet-500/20 text-violet-300">
                              <Lock size={13} />
                              Didit Override
                            </span>
                          )}
                          {!isApprove && !isReject && !isRevoke && !isOverride && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-gray-300">
                              {act.action}
                            </span>
                          )}
                        </td>

                        {/* Target Entity */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                              targetInfo.type === 'KYC'
                                ? 'bg-violet-500/10 border-violet-500/20 text-violet-300'
                                : 'bg-blue-500/10 border-blue-500/20 text-blue-300'
                            }`}>
                              {targetInfo.type}
                            </span>
                            <span className="font-semibold text-white text-sm">{targetInfo.name}</span>
                          </div>
                          <p className="text-xs text-gray-500 font-mono mt-0.5 truncate max-w-[200px]" title={act.target_id}>
                            {act.target_id}
                          </p>
                        </td>

                        {/* Reason / Notes */}
                        <td className="px-5 py-4 max-w-[280px]">
                          <div className={`p-2.5 rounded-xl border text-xs ${
                            isReject
                              ? 'bg-red-500/5 border-red-500/20 text-red-300'
                              : isApprove
                              ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                              : 'bg-white/[0.02] border-white/10 text-gray-300'
                          }`}>
                            {act.reason || '—'}
                          </div>
                        </td>

                        {/* Admin */}
                        <td className="px-5 py-4 text-xs font-mono text-gray-400 whitespace-nowrap">
                          {act.admin_id.slice(0, 8)}…
                        </td>

                        {/* View shortcut */}
                        <td className="px-5 py-4 text-right">
                          {(() => {
                            const linkedSession = diditSessions.find(
                              ds => ds.entity_id === act.target_id || ds.didit_session_id === act.target_id
                            );
                            if (!linkedSession) return <span className="text-gray-600 text-xs">—</span>;
                            return (
                              <button
                                type="button"
                                onClick={() => setDiditPanel(linkedSession)}
                                className="px-2.5 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[#a78bfa] text-xs font-semibold hover:bg-purple-500/20 transition inline-flex items-center gap-1"
                              >
                                <Eye size={12} /> Session
                              </button>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <TablePagination
            currentPage={currentHistoryPage}
            totalPages={totalHistoryPages}
            totalItems={totalHistoryItems}
            startIndex={historyStartIndex}
            endIndex={historyEndIndex}
            pageSize={historyPageSize}
            onPageChange={setHistoryPage}
            onPageSizeChange={(newSize) => {
              setHistoryPageSize(newSize);
              setHistoryPage(1);
            }}
            itemLabel="audit actions"
          />
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          TAB 3: Review Queue (The 2-Column Split Cards for Pending Submissions)
      ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'queue' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* KYC Pending Queue */}
          <div className="bg-[#1a2030] rounded-3xl border border-white/5 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <User className="h-5 w-5 text-[#a78bfa]" /> Pending KYC Queue ({pendingKYC.length})
              </h2>
              <span className="text-xs px-2.5 py-1 rounded-full bg-violet-500/10 text-[#a78bfa] border border-violet-500/20 font-mono">
                Biometric / ID
              </span>
            </div>

            <div className="divide-y divide-white/5 overflow-y-auto max-h-[560px] flex-1">
              {pendingKYC.length === 0 ? (
                <div className="p-10 text-center text-gray-500 text-sm">
                  <CheckCircle className="h-8 w-8 mx-auto mb-2 text-emerald-500/40" />
                  No pending KYC identity requests in queue.
                </div>
              ) : (
                pendingKYC.map((user) => {
                  const diditSession = getDiditSession(user.user_id, 'KYC');
                  const hasDocs =
                    user.national_id_url || user.passport_url || user.selfie_url || user.proof_of_address_url;

                  return (
                    <div key={user.user_id} className="p-6 hover:bg-white/[0.02] transition flex flex-col gap-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-white text-base">{user.full_name || 'Anonymous User'}</h3>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{user.user_id}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {diditSession && (
                            <StatusBadge status={diditSession.admin_override_status || diditSession.status} />
                          )}
                          {diditSession && (
                            <button
                              type="button"
                              onClick={() => setDiditPanel(diditSession)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[#a78bfa] text-[11px] font-semibold hover:bg-purple-500/20 transition"
                            >
                              <Eye size={11} /> Didit Data
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Score pills if available */}
                      {diditSession && (diditSession.liveness_score != null || diditSession.face_match_score != null) && (
                        <div className="flex flex-wrap gap-2">
                          <ScorePill score={diditSession.liveness_score} label="Liveness" />
                          <ScorePill score={diditSession.face_match_score} label="Face Match" />
                          {diditSession.aml_status && <StatusBadge status={`AML: ${diditSession.aml_status}`} />}
                          {diditSession.is_vpn && (
                            <span className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-lg">
                              ⚠ VPN
                            </span>
                          )}
                        </div>
                      )}

                      {/* Document links */}
                      <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                          <FileCheck2 size={13} className="text-[#a78bfa]" />
                          Verification Documents
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {user.national_id_url && (
                            <Link href={user.national_id_url} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 flex items-center gap-1.5 transition">
                              <FileText size={12} className="text-[#a78bfa]" />National ID / CNIC
                              <ExternalLink size={10} className="text-gray-400" />
                            </Link>
                          )}
                          {user.passport_url && (
                            <Link href={user.passport_url} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 flex items-center gap-1.5 transition">
                              <FileText size={12} className="text-[#a78bfa]" />Passport
                              <ExternalLink size={10} className="text-gray-400" />
                            </Link>
                          )}
                          {user.selfie_url && (
                            <Link href={user.selfie_url} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 flex items-center gap-1.5 transition">
                              <FileText size={12} className="text-[#a78bfa]" />Selfie / Face
                              <ExternalLink size={10} className="text-gray-400" />
                            </Link>
                          )}
                          {user.proof_of_address_url && (
                            <Link href={user.proof_of_address_url} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 flex items-center gap-1.5 transition">
                              <FileText size={12} className="text-[#a78bfa]" />Proof of Address
                              <ExternalLink size={10} className="text-gray-400" />
                            </Link>
                          )}
                          {!hasDocs && (
                            <span className="text-xs text-gray-500 italic">
                              Didit live biometric check (no manual uploads).
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center justify-end gap-2.5 pt-1">
                        <button
                          type="button"
                          onClick={() => openDiditReview(user)}
                          className="px-3.5 py-2 bg-purple-500/15 hover:bg-purple-500/25 text-[#a78bfa] border border-purple-500/30 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                        >
                          <Fingerprint size={14} /> Didit Details &amp; Review
                        </button>
                        <button type="button" onClick={() => openRejectModal('kyc', user.user_id, user.full_name || 'User')}
                          disabled={isPending}
                          className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                          <XCircle size={14} /> Reject KYC
                        </button>
                        <button type="button" onClick={() => handleApproveKYC(user.user_id)}
                          disabled={isPending}
                          className="px-3.5 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                          <CheckCircle size={14} /> Approve KYC
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* KYB Pending Queue */}
          <div className="bg-[#1a2030] rounded-3xl border border-white/5 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Building2 className="h-5 w-5 text-[#a78bfa]" /> Pending KYB Queue ({pendingKYB.length})
              </h2>
              <span className="text-xs px-2.5 py-1 rounded-full bg-violet-500/10 text-[#a78bfa] border border-violet-500/20 font-mono">
                Corporate / Tax
              </span>
            </div>

            <div className="divide-y divide-white/5 overflow-y-auto max-h-[560px] flex-1">
              {pendingKYB.length === 0 ? (
                <div className="p-10 text-center text-gray-500 text-sm">
                  <CheckCircle className="h-8 w-8 mx-auto mb-2 text-emerald-500/40" />
                  No pending KYB business requests in queue.
                </div>
              ) : (
                pendingKYB.map((biz) => {
                  const diditSession = getDiditSession(biz.id, 'KYB');
                  const hasDocs =
                    biz.profiles?.business_reg_url || biz.profiles?.tax_cert_url || biz.profiles?.bank_statement_url;

                  return (
                    <div key={biz.id} className="p-6 hover:bg-white/[0.02] transition flex flex-col gap-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-white text-base">{biz.business_name}</h3>
                          <p className="text-xs text-gray-400 mt-0.5">
                            Owner: <span className="text-gray-300 font-mono">{biz.profiles?.full_name || biz.owner_id}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {diditSession && (
                            <StatusBadge status={diditSession.admin_override_status || diditSession.status} />
                          )}
                          {diditSession && (
                            <button
                              type="button"
                              onClick={() => setDiditPanel(diditSession)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[#a78bfa] text-[11px] font-semibold hover:bg-purple-500/20 transition"
                            >
                              <Eye size={11} /> Didit Data
                            </button>
                          )}
                        </div>
                      </div>

                      {/* KYB company data snippet */}
                      {diditSession?.company_name && (
                        <div className="flex flex-wrap gap-2 text-[11px]">
                          <span className="px-2 py-0.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300">
                            {diditSession.company_name}
                          </span>
                          {diditSession.company_status && (
                            <StatusBadge status={diditSession.company_status} />
                          )}
                          {diditSession.company_country && (
                            <span className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-gray-400">
                              {diditSession.company_country}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Corporate document links */}
                      <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                          <FileCheck2 size={13} className="text-[#a78bfa]" />Corporate Records
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {biz.profiles?.business_reg_url && (
                            <Link href={biz.profiles.business_reg_url} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 flex items-center gap-1.5 transition">
                              <FileText size={12} className="text-[#a78bfa]" />Incorporation / Reg Doc
                              <ExternalLink size={10} className="text-gray-400" />
                            </Link>
                          )}
                          {biz.profiles?.tax_cert_url && (
                            <Link href={biz.profiles.tax_cert_url} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 flex items-center gap-1.5 transition">
                              <FileText size={12} className="text-[#a78bfa]" />Tax / NTN Certificate
                              <ExternalLink size={10} className="text-gray-400" />
                            </Link>
                          )}
                          {biz.profiles?.bank_statement_url && (
                            <Link href={biz.profiles.bank_statement_url} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 flex items-center gap-1.5 transition">
                              <FileText size={12} className="text-[#a78bfa]" />Bank Statement
                              <ExternalLink size={10} className="text-gray-400" />
                            </Link>
                          )}
                          {!hasDocs && (
                            <span className="text-xs text-gray-500 italic">No corporate attachments uploaded yet.</span>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center justify-end gap-2.5 pt-1">
                        <button type="button" onClick={() => openRejectModal('kyb', biz.id, biz.business_name)}
                          disabled={isPending}
                          className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                          <XCircle size={14} /> Reject KYB
                        </button>
                        <button type="button" onClick={() => handleApproveKYB(biz.id)}
                          disabled={isPending}
                          className="px-3.5 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                          <CheckCircle size={14} /> Approve KYB
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* shafqaat implemented — In Review & Declined KYC sub-sections (shown within queue tab) */}
      {activeTab === 'queue' && (inReviewKYC.length > 0 || declinedKYC.length > 0) && (
        <div className="space-y-6">
          {/* In Review Section */}
          {inReviewKYC.length > 0 && (
            <div className="bg-[#1a2030] rounded-3xl border border-amber-500/15 overflow-hidden">
              <div className="p-5 border-b border-white/5 bg-amber-500/[0.04] flex items-center justify-between">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Clock className="h-5 w-5 text-amber-400" />
                  KYC Under Manual Review ({inReviewKYC.length})
                </h2>
                <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold">
                  Awaiting Admin Approval
                </span>
              </div>
              <div className="p-4 text-xs text-amber-300/70 bg-amber-500/[0.02] border-b border-white/5">
                These users completed Didit biometric verification but their session is marked <strong>&quot;In Review&quot;</strong> by Didit.
                The system has <strong>NOT</strong> auto-approved them. Review their Didit data and approve or reject manually.
              </div>
              <div className="divide-y divide-white/5">
                {inReviewKYC.map((user) => {
                  const diditSession = getDiditSession(user.user_id, 'KYC');
                  return (
                    <div key={user.user_id} className="p-5 hover:bg-white/[0.02] transition flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-white text-sm">{user.full_name || 'Anonymous User'}</h3>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{user.user_id}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-semibold text-amber-400 bg-amber-500/10 border-amber-500/20">
                            <Clock size={11} /> In Review
                          </span>
                          <button
                            type="button"
                            onClick={() => openDiditReview(user)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-[#a78bfa] text-xs font-semibold hover:bg-purple-500/25 transition shadow-sm cursor-pointer"
                          >
                            <Fingerprint size={12} /> Didit Details &amp; Review
                          </button>
                        </div>
                      </div>
                      {diditSession && (diditSession.liveness_score != null || diditSession.face_match_score != null) && (
                        <div className="flex flex-wrap gap-2">
                          <ScorePill score={diditSession.liveness_score} label="Liveness" />
                          <ScorePill score={diditSession.face_match_score} label="Face Match" />
                          {diditSession.aml_status && <StatusBadge status={`AML: ${diditSession.aml_status}`} />}
                          {diditSession.is_vpn && <span className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-lg">⚠ VPN</span>}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => openDiditReview(user)}
                          className="px-3.5 py-2 bg-purple-500/15 hover:bg-purple-500/25 text-[#a78bfa] border border-purple-500/30 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                        >
                          <Fingerprint size={14} /> Didit Details &amp; Actions
                        </button>
                        <button type="button" onClick={() => openRejectModal('kyc', user.user_id, user.full_name || 'User')} disabled={isPending}
                          className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50">
                          <XCircle size={14} /> Decline KYC
                        </button>
                        <button type="button" onClick={() => handleApproveKYC(user.user_id)} disabled={isPending}
                          className="px-3.5 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50">
                          <CheckCircle size={14} /> Approve KYC
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Declined Section */}
          {declinedKYC.length > 0 && (
            <div className="bg-[#1a2030] rounded-3xl border border-red-500/15 overflow-hidden">
              <div className="p-5 border-b border-white/5 bg-red-500/[0.03] flex items-center justify-between">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-400" />
                  KYC Declined by Didit ({declinedKYC.length})
                </h2>
                <span className="text-xs px-2.5 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/20 font-semibold">
                  Didit Rejected
                </span>
              </div>
              <div className="p-4 text-xs text-red-300/70 bg-red-500/[0.02] border-b border-white/5">
                These users were <strong>declined by Didit</strong>. The system has NOT auto-verified them.
                You can still manually approve if you believe it was an error, or formally reject with a reason.
              </div>
              <div className="divide-y divide-white/5">
                {declinedKYC.map((user) => {
                  const diditSession = getDiditSession(user.user_id, 'KYC');
                  const extUser = user as Profile & { _decline_reason?: string };
                  return (
                    <div key={user.user_id} className="p-5 hover:bg-white/[0.02] transition flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-white text-sm">{user.full_name || 'Anonymous User'}</h3>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{user.user_id}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-semibold text-red-400 bg-red-500/10 border-red-500/20">
                            <XCircle size={11} /> Declined
                          </span>
                          <button
                            type="button"
                            onClick={() => openDiditReview(user)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-[#a78bfa] text-xs font-semibold hover:bg-purple-500/25 transition shadow-sm cursor-pointer"
                          >
                            <Fingerprint size={12} /> Didit Details &amp; Review
                          </button>
                        </div>
                      </div>
                      {extUser._decline_reason && (
                        <div className="p-2.5 rounded-xl bg-red-500/5 border border-red-500/15 text-xs text-red-300">
                          <span className="font-semibold text-red-400 block text-[10px] uppercase tracking-wider mb-0.5">Decline Reason:</span>
                          {extUser._decline_reason}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => openDiditReview(user)}
                          className="px-3.5 py-2 bg-purple-500/15 hover:bg-purple-500/25 text-[#a78bfa] border border-purple-500/30 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                        >
                          <Fingerprint size={14} /> Didit Details &amp; Actions
                        </button>
                        <button type="button" onClick={() => openRejectModal('kyc', user.user_id, user.full_name || 'User')} disabled={isPending}
                          className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50">
                          <XCircle size={14} /> Formally Reject
                        </button>
                        <button type="button" onClick={() => handleApproveKYC(user.user_id)} disabled={isPending}
                          className="px-3.5 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50">
                          <CheckCircle size={14} /> Override &amp; Approve
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          TAB 4: All Didit Biometric Sessions
      ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'didit' && (
        <div className="bg-[#1a2030] rounded-3xl border border-white/5 overflow-hidden">
          <div className="p-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Fingerprint className="h-5 w-5 text-[#a78bfa]" /> All Didit Sessions ({diditSessions.length})
            </h2>
            <span className="text-xs text-gray-500">
              Direct verification records from Didit Decision API
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left bg-white/[0.01]">
                  {['Session ID', 'Kind', 'Entity', 'Didit Status', 'Liveness', 'Face Match', 'AML', 'VPN', 'Submitted', 'Actions'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {diditSessions.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-gray-500">
                      No Didit biometric sessions recorded yet.
                    </td>
                  </tr>
                ) : (
                  diditSessions.map((session) => (
                    <tr key={session.didit_session_id} className="hover:bg-white/[0.015] transition">
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-xs text-gray-300">
                          {session.didit_session_id.slice(0, 14)}…
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          session.session_kind === 'KYC'
                            ? 'text-violet-300 bg-violet-500/10 border border-violet-500/20'
                            : 'text-blue-300 bg-blue-500/10 border border-blue-500/20'
                        }`}>
                          {session.session_kind}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-gray-300 max-w-[140px] truncate">
                        {session.first_name
                          ? `${session.first_name} ${session.last_name || ''}`
                          : session.company_name || (session.entity_id ? `${session.entity_id.slice(0, 8)}…` : '—')}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={session.admin_override_status || session.status} />
                      </td>
                      <td className="px-5 py-3.5">
                        {session.liveness_score != null
                          ? <ScorePill score={session.liveness_score} label="" />
                          : <span className="text-gray-600 text-[11px]">—</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        {session.face_match_score != null
                          ? <ScorePill score={session.face_match_score} label="" />
                          : <span className="text-gray-600 text-[11px]">—</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        {session.aml_status
                          ? <StatusBadge status={session.aml_status} />
                          : <span className="text-gray-600 text-[11px]">—</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        {session.is_vpn
                          ? <span className="text-red-400 text-[11px] font-bold">Yes</span>
                          : <span className="text-emerald-400 text-[11px]">No</span>}
                      </td>
                      <td className="px-5 py-3.5 text-[11px] text-gray-500">
                        {session.created_at ? new Date(session.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          {(() => {
                            const linkedUser = usersState.find(u => u.user_id === session.entity_id);
                            if (linkedUser) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setReviewModalUser({ user: linkedUser, session })}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-[#a78bfa] text-xs font-semibold hover:bg-purple-500/25 transition shadow-sm"
                                >
                                  <Fingerprint size={12} /> Review
                                </button>
                              );
                            }
                            return null;
                          })()}
                          <button
                            type="button"
                            onClick={() => setDiditPanel(session)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 text-xs font-semibold hover:bg-white/10 transition"
                          >
                            <Eye size={12} /> View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          TAB 5: Verified Directory
      ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'verified' && (
        <div className="space-y-6">
          {/* Verified Users */}
          <div className="bg-[#1a2030] rounded-3xl border border-white/5 overflow-hidden">
            <div className="p-6 border-b border-white/5 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-emerald-400" /> Active Verified Profiles ({activeVerifiedUsers.length})
              </h2>
              <span className="text-xs text-gray-400">
                Admins can revoke verification if suspicious or non-compliant activity occurs
              </span>
            </div>

            <div className="divide-y divide-white/5">
              {activeVerifiedUsers.length === 0 ? (
                <p className="p-6 text-gray-500 text-sm text-center">No active verified investor profiles.</p>
              ) : (
                activeVerifiedUsers.map((user) => {
                  const diditSession = getDiditSession(user.user_id, 'KYC');
                  return (
                    <div key={user.user_id} className="p-5 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center hover:bg-white/[0.02] transition">
                      <div>
                        <h3 className="font-semibold text-white flex items-center gap-2">
                          {user.full_name || 'Verified Investor'}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            KYC Active
                          </span>
                        </h3>
                        <p className="text-xs text-gray-400 font-mono mt-0.5">
                          {user.user_id} · {user.wallet_address || 'No Wallet Attached'}
                        </p>
                        {diditSession && (
                          <div className="flex gap-2 mt-1.5 flex-wrap">
                            <ScorePill score={diditSession.liveness_score} label="Liveness" />
                            <ScorePill score={diditSession.face_match_score} label="Face" />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openDiditReview(user)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-[#a78bfa] text-xs font-semibold hover:bg-purple-500/25 transition shadow-sm cursor-pointer"
                        >
                          <Fingerprint size={12} /> Didit Details &amp; Review
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevokeKYC(user.user_id)}
                          disabled={isPending}
                          className="px-3.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 cursor-pointer"
                        >
                          <UserX className="h-3.5 w-3.5" /> Revoke
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Verified Businesses */}
          {activeVerifiedBusinesses.length > 0 && (
            <div className="bg-[#1a2030] rounded-3xl border border-white/5 overflow-hidden">
              <div className="p-6 border-b border-white/5 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-emerald-400" /> Active Verified Businesses ({activeVerifiedBusinesses.length})
                </h2>
                <span className="text-xs text-gray-400">
                  Organizations approved for campaign launches and equity tokenization
                </span>
              </div>

              <div className="divide-y divide-white/5">
                {activeVerifiedBusinesses.map((biz) => {
                  const diditSession = getDiditSession(biz.id, 'KYB');
                  return (
                    <div key={biz.id} className="p-5 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center hover:bg-white/[0.02] transition">
                      <div>
                        <h3 className="font-semibold text-white flex items-center gap-2">
                          {biz.business_name}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            KYB Active
                          </span>
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          ID: <span className="font-mono text-gray-300">{biz.id}</span> · Owner: <span className="text-gray-300">{biz.profiles?.full_name || biz.owner_id}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {diditSession && (
                          <button
                            type="button"
                            onClick={() => setDiditPanel(diditSession)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-[#a78bfa] text-xs font-semibold hover:bg-violet-500/20 transition"
                          >
                            <Eye size={12} /> Didit Report
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRevokeKYB(biz.id)}
                          disabled={isPending}
                          className="px-3.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 cursor-pointer"
                        >
                          <UserX className="h-3.5 w-3.5" /> Revoke KYB
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          Didit Rejection Modal
      ───────────────────────────────────────────────────────────────────────────── */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#1a2030] p-6 text-white shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <XCircle className="text-red-400 h-5 w-5" />
                  Reject {rejectModal.type === 'kyc' ? 'KYC Verification' : 'KYB Verification'}
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Target: <strong className="text-gray-200">{rejectModal.title}</strong>
                </p>
              </div>
              <button type="button" onClick={() => setRejectModal({ open: false, type: 'kyc', id: '', title: '' })}
                className="text-gray-400 hover:text-white rounded-lg p-1 hover:bg-white/5">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                  Standard Didit Decline Reason
                </label>
                <select
                  value={selectedReason}
                  onChange={(e) => setSelectedReason(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#141a2e] px-3.5 py-2.5 text-sm text-white focus:border-[#a78bfa] focus:outline-none"
                >
                  {(rejectModal.type === 'kyc' ? DIDIT_KYC_REASONS : DIDIT_KYB_REASONS).map((reason) => (
                    <option key={reason} value={reason} className="bg-[#141a2e] text-white">{reason}</option>
                  ))}
                </select>
              </div>

              {selectedReason === 'Other / Custom reason' && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                    Custom Decline Details
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Specify why this submission is being rejected..."
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-[#141a2e] px-3.5 py-2 text-sm text-white focus:border-[#a78bfa] focus:outline-none resize-none"
                  />
                </div>
              )}

              <p className="text-[11px] text-gray-400 bg-white/[0.02] p-3 rounded-2xl border border-white/5 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                This rejection reason will be saved in the permanent audit trail, attached to the user record, and sent via system notification.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
              <button type="button" onClick={() => setRejectModal({ open: false, type: 'kyc', id: '', title: '' })}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/5 transition">
                Cancel
              </button>
              <button type="button" onClick={submitReject} disabled={isPending}
                className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                {isPending ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          Didit Data Panel Modal
      ───────────────────────────────────────────────────────────────────────────── */}
      {diditPanel && (
        <DiditDataPanel session={diditPanel} onClose={() => setDiditPanel(null)} />
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          Full Didit & User Review Modal with Built-in Message Templates
      ───────────────────────────────────────────────────────────────────────────── */}
      {reviewModalUser && (
        <AdminUserReviewModal
          user={reviewModalUser.user}
          session={reviewModalUser.session}
          onClose={() => setReviewModalUser(null)}
          onStatusUpdated={(userId, newStatus, reason) => {
            setUsersState(prev =>
              prev.map(u => (u.user_id === userId ? { ...u, identity_verified: newStatus } : u))
            );
            if (newStatus) {
              setActionFeedback(`✓ Approved KYC for user ${userId.slice(0, 8)}...`);
            } else {
              setActionFeedback(`✓ Declined KYC for user ${userId.slice(0, 8)}... (${reason || ''})`);
            }
            setTimeout(() => setActionFeedback(null), 5000);
            setReviewModalUser(null);
          }}
        />
      )}
    </div>
  );
}
