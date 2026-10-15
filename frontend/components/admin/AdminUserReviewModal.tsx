'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  CheckCircle,
  XCircle,
  Clock,
  ShieldCheck,
  User,
  FileText,
  ExternalLink,
  AlertTriangle,
  Fingerprint,
  Info,
  X,
  Loader2,
  Eye,
  RefreshCw,
  Globe,
  Smartphone,
  Activity,
  BarChart2,
  Lock,
  Calendar,
  MapPin,
  Users,
  CreditCard,
  Shield,
  Send,
  MessageSquare,
  Sparkles,
  Phone,
  Mail,
  Copy,
  Check,
} from 'lucide-react';
import {
  adminVerifyKYC,
  adminApproveKYCWithMessage,
  adminDeclineKYCWithMessage,
  adminSendKYCNotification,
  adminSetDiditOverride,
  adminRefetchDiditSession,
} from '@/lib/action';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Profile {
  idx?: number;
  user_id: string;
  full_name?: string | null;
  display_name?: string | null;
  role?: string | null;
  bio?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  national_id_cid?: string | null;
  national_id_url?: string | null;
  passport_cid?: string | null;
  passport_url?: string | null;
  selfie_cid?: string | null;
  selfie_url?: string | null;
  proof_of_address_cid?: string | null;
  proof_of_address_url?: string | null;
  bank_statement_cid?: string | null;
  bank_statement_url?: string | null;
  identity_verified?: boolean | null;
  created_at?: string | null;
  wallet_address?: string | null;
}

export interface DiditSession {
  id?: string;
  didit_session_id: string;
  entity_type?: string;
  entity_id: string;
  session_kind: string;
  status: string;
  decision?: string | null;
  created_at?: string | null;
  updated_at?: string;
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  gender?: string | null;
  document_type?: string | null;
  document_number?: string | null;
  personal_number?: string | null;
  issuing_state?: string | null;
  expiration_date?: string | null;
  liveness_score?: number | null;
  liveness_status?: string | null;
  face_match_score?: number | null;
  face_match_status?: string | null;
  aml_status?: string | null;
  aml_hits?: number | null;
  device_ip?: string | null;
  device_country?: string | null;
  device_platform?: string | null;
  is_vpn?: boolean | null;
  company_name?: string | null;
  registration_number?: string | null;
  company_type?: string | null;
  incorporation_date?: string | null;
  company_status?: string | null;
  company_country?: string | null;
  kyb_key_people?: Record<string, unknown>[] | null;
  admin_override_status?: string | null;
  admin_override_reason?: string | null;
  admin_override_at?: string | null;
  didit_decision_payload?: Record<string, unknown> | null;
}

interface AdminUserReviewModalProps {
  user: Profile;
  session?: DiditSession | null;
  onClose: () => void;
  onStatusUpdated?: (userId: string, newStatus: boolean, reason?: string) => void;
  onRefreshData?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Message Templates
// ─────────────────────────────────────────────────────────────────────────────

interface MessageTemplate {
  id: string;
  category: 'in_review' | 'declined' | 'approved';
  actionType: 'approve' | 'decline' | 'notify';
  label: string;
  title: string;
  reason?: string;
  message: string;
}

const MESSAGE_TEMPLATES: MessageTemplate[] = [
  // In Review / Needs Clarification
  {
    id: 'blurry_doc',
    category: 'in_review',
    actionType: 'notify',
    label: 'Blurry / Unclear Document',
    title: 'Action Required: Re-upload Clear ID Document',
    reason: 'Low image quality / Blurry ID document',
    message:
      'Your uploaded identification document was too blurry or low-resolution for automated verification. Please log into your FundXprout profile and upload a clear, well-lit photo of your original ID with all four corners visible.',
  },
  {
    id: 'liveness_fail',
    category: 'in_review',
    actionType: 'notify',
    label: 'Facial Match Inconclusive',
    title: 'Action Required: Retake Facial Liveness Verification',
    reason: 'Facial liveness / Selfie mismatch',
    message:
      'We could not confidently match your live selfie with the photo on your ID document. Please retry the verification in a well-lit environment without sunglasses, caps, or strong backlighting.',
  },
  {
    id: 'address_needed',
    category: 'in_review',
    actionType: 'notify',
    label: 'Proof of Address Needed',
    title: 'Action Required: Recent Proof of Address Document',
    reason: 'Proof of address older than 3 months',
    message:
      'Please provide an updated proof of address document (utility bill or bank statement) issued within the last 90 days showing your legal name and residential address.',
  },
  {
    id: 'name_mismatch',
    category: 'in_review',
    actionType: 'notify',
    label: 'Profile & ID Name Mismatch',
    title: 'Action Required: Name Mismatch on Document',
    reason: 'Name or ID number mismatch with profile',
    message:
      'The legal name on your submitted ID does not match the name entered on your FundXprout account profile. Please update your profile information or submit matching identification.',
  },
  {
    id: 'under_review_info',
    category: 'in_review',
    actionType: 'notify',
    label: 'Under Compliance Review (FYI)',
    title: 'KYC Status Update: Under Manual Review',
    reason: 'Manual compliance review in progress',
    message:
      'Your identity documents are currently undergoing manual review by our compliance team. This typically takes 24 to 48 hours. No further action is required from you at this time.',
  },

  // Declined Reasons
  {
    id: 'decline_expired',
    category: 'declined',
    actionType: 'decline',
    label: 'Decline: Expired ID Document',
    title: 'KYC Verification Declined: Expired Document',
    reason: 'Document expired or invalid',
    message:
      'Your KYC verification was declined because the identification document submitted has expired. Please re-submit your verification using a valid, currently unexpired government-issued ID.',
  },
  {
    id: 'decline_unsupported',
    category: 'declined',
    actionType: 'decline',
    label: 'Decline: Unsupported Document Type',
    title: 'KYC Verification Declined: Invalid Document Type',
    reason: 'Unsupported document type',
    message:
      'The document type you provided is not accepted. Please submit a valid government-issued National Identity Card, Passport, or Driver’s License.',
  },
  {
    id: 'decline_aml_risk',
    category: 'declined',
    actionType: 'decline',
    label: 'Decline: AML / Compliance Risk',
    title: 'KYC Verification Declined: Compliance Flag',
    reason: 'Compliance / Risk screening criteria mismatch',
    message:
      'Your verification could not be approved due to compliance screening criteria. If you believe this decision is in error, please contact our support desk at support@fundxprout.com.',
  },
  {
    id: 'decline_fraud_altered',
    category: 'declined',
    actionType: 'decline',
    label: 'Decline: Incomplete or Altered ID',
    title: 'KYC Verification Declined: Incomplete Document',
    reason: 'Suspected forged or altered document',
    message:
      'The submitted identification document could not be validated or appears incomplete/altered. Please provide authentic, unedited identification to continue.',
  },

  // Approved Messages
  {
    id: 'approve_standard',
    category: 'approved',
    actionType: 'approve',
    label: 'Approve: Standard Verification',
    title: 'Identity Verified ✓',
    reason: 'Identity verified successfully',
    message:
      'Congratulations! Your KYC identity verification has been reviewed and approved. You now have full access to invest in campaigns and trade tokens on FundXprout.',
  },
  {
    id: 'approve_manual_clearance',
    category: 'approved',
    actionType: 'approve',
    label: 'Approve: Manual Review Passed',
    title: 'Manual Review Complete: KYC Approved ✓',
    reason: 'Manual compliance review passed',
    message:
      'Our compliance team has manually examined your identity documents and verified your account. Your account is now fully approved for all platform features.',
  },
];

export default function AdminUserReviewModal({
  user,
  session,
  onClose,
  onStatusUpdated,
  onRefreshData,
}: AdminUserReviewModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'didit' | 'action'>('overview');
  const [isPending, startTransition] = useTransition();
  const [refetching, setRefetching] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Action form state
  const [actionCategory, setActionCategory] = useState<'in_review' | 'declined' | 'approved'>('in_review');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('KYC Status Update');
  const [customReason, setCustomReason] = useState<string>('');
  const [customMessage, setCustomMessage] = useState<string>('');
  const [actionChoice, setActionChoice] = useState<'approve' | 'decline' | 'notify'>('notify');

  // Override mode in Didit tab
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<'Approved' | 'Declined' | ''>('');
  const [overrideReason, setOverrideReason] = useState('');

  // Handle template selection
  const handleSelectTemplate = (tmpl: MessageTemplate) => {
    setSelectedTemplateId(tmpl.id);
    setActionChoice(tmpl.actionType);
    setCustomTitle(tmpl.title);
    setCustomReason(tmpl.reason || '');
    setCustomMessage(tmpl.message);
  };

  // Copy User ID
  const handleCopyUserId = () => {
    navigator.clipboard.writeText(user.user_id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // Re-fetch Didit session from Didit API
  const handleRefetch = async () => {
    if (!session?.didit_session_id) return;
    setRefetching(true);
    setToastMsg(null);
    try {
      const res = await adminRefetchDiditSession(session.didit_session_id);
      if (res?.error) {
        setToastMsg({ type: 'error', text: `Failed to refresh: ${res.error}` });
      } else {
        setToastMsg({ type: 'success', text: '✓ Refreshed latest data from Didit API.' });
        if (onRefreshData) onRefreshData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setToastMsg({ type: 'error', text: msg });
    } finally {
      setRefetching(false);
    }
  };

  // Execute Action (Approve, Decline, or Notify)
  const handleExecuteAction = () => {
    if (!customMessage.trim()) {
      setToastMsg({ type: 'error', text: 'Please enter a message to send to the user.' });
      return;
    }

    startTransition(async () => {
      setToastMsg(null);
      try {
        if (actionChoice === 'approve') {
          const res = await adminApproveKYCWithMessage(user.user_id, customMessage);
          if (res?.error) {
            setToastMsg({ type: 'error', text: res.error });
          } else {
            setToastMsg({ type: 'success', text: '✓ KYC Approved and user notified successfully!' });
            if (onStatusUpdated) onStatusUpdated(user.user_id, true);
          }
        } else if (actionChoice === 'decline') {
          const reason = customReason.trim() || 'Didit verification declined';
          const res = await adminDeclineKYCWithMessage(user.user_id, reason, customMessage);
          if (res?.error) {
            setToastMsg({ type: 'error', text: res.error });
          } else {
            setToastMsg({ type: 'success', text: '✓ KYC Declined and user notified with reason.' });
            if (onStatusUpdated) onStatusUpdated(user.user_id, false, reason);
          }
        } else {
          // Notify only (e.g. asking for re-upload while staying in review)
          const res = await adminSendKYCNotification(
            user.user_id,
            customTitle.trim() || 'KYC Notice',
            customMessage.trim(),
            '/profile',
            'kyc_status'
          );
          if (res?.error) {
            setToastMsg({ type: 'error', text: res.error });
          } else {
            setToastMsg({ type: 'success', text: '✓ Notification sent to user dashboard & bell.' });
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to execute action';
        setToastMsg({ type: 'error', text: msg });
      }
    });
  };

  // Handle Didit Override
  const handleApplyOverride = () => {
    if (!session?.didit_session_id || !overrideStatus) return;
    startTransition(async () => {
      const res = await adminSetDiditOverride(
        session.didit_session_id,
        overrideStatus as 'Approved' | 'Declined',
        overrideReason.trim() || undefined
      );
      if (res?.error) {
        setToastMsg({ type: 'error', text: res.error });
      } else {
        setToastMsg({ type: 'success', text: `✓ Override applied: "${overrideStatus}".` });
        setOverrideMode(false);
        if (onRefreshData) onRefreshData();
      }
    });
  };

  // Determine user's effective Didit status
  const effectiveStatus = session?.admin_override_status || session?.status || 'No Session';
  const isDeclined = effectiveStatus.toLowerCase().includes('declin') || effectiveStatus.toLowerCase().includes('reject');
  const isInReview = effectiveStatus.toLowerCase().includes('review') || effectiveStatus.toLowerCase().includes('need') || effectiveStatus.toLowerCase().includes('progress');
  const isApproved = effectiveStatus.toLowerCase().includes('approv') || user.identity_verified;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl border border-white/10 bg-[#121727] text-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Top Header */}
        <div className="p-5 sm:p-6 border-b border-white/10 bg-white/[0.02] flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[#a78bfa]">
                <ShieldCheck size={20} />
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-white">
                {user.full_name || user.display_name || 'Anonymous User'}
              </h2>
              {/* Role badge */}
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/5 border border-white/10 text-gray-300 capitalize">
                {user.role || 'Investor'}
              </span>
              {/* Verified badge */}
              {user.identity_verified ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle size={11} /> Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Clock size={11} /> Unverified
                </span>
              )}
              {/* Didit Status */}
              {session && (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                    isApproved
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : isDeclined
                      ? 'bg-red-500/10 text-red-400 border-red-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}
                >
                  <Fingerprint size={11} /> Didit: {effectiveStatus}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400 font-mono">
              <span className="flex items-center gap-1">
                ID: {user.user_id}
                <button
                  type="button"
                  onClick={handleCopyUserId}
                  className="hover:text-white p-0.5 rounded transition text-gray-400"
                  title="Copy User ID"
                >
                  {copiedId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              </span>
              {user.created_at && (
                <span className="text-gray-500 font-sans">
                  · Joined {new Date(user.created_at).toLocaleDateString()}
                </span>
              )}
              {session?.didit_session_id && (
                <span className="text-purple-300/80 font-mono">
                  · Session: {session.didit_session_id.slice(0, 16)}...
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/5 transition"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 bg-[#0e1220] px-4 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'overview'
                ? 'border-[#a78bfa] text-[#a78bfa]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <User size={14} /> Profile & Documents
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('didit')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'didit'
                ? 'border-[#a78bfa] text-[#a78bfa]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Fingerprint size={14} /> Didit Intelligence Report
            {session && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('action')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'action'
                ? 'border-[#a78bfa] text-[#a78bfa]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <MessageSquare size={14} /> Status Actions & Messages
            <span className="px-1.5 py-0.2 bg-purple-500/20 text-[#a78bfa] text-[10px] rounded-full font-mono">
              Templates
            </span>
          </button>
        </div>

        {/* Toast message inside modal */}
        {toastMsg && (
          <div
            className={`mx-5 mt-4 p-3 rounded-2xl border text-xs flex items-center justify-between gap-2 ${
              toastMsg.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : 'bg-red-500/10 text-red-300 border-red-500/20'
            }`}
          >
            <div className="flex items-center gap-2">
              <Info size={14} className="shrink-0" />
              <span>{toastMsg.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMsg(null)}
              className="p-1 hover:text-white text-gray-400"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {/* ───────────────────────────────────────────────────────────────
              TAB 1: OVERVIEW & PROFILE DATA (Supabase)
          ──────────────────────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Profile Overview Card */}
              <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 sm:p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                  <User size={14} className="text-[#a78bfa]" /> Supabase User Profile
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase">Full Name</p>
                    <p className="text-sm font-semibold text-white mt-0.5">{user.full_name || '—'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase">Display Name</p>
                    <p className="text-sm font-semibold text-white mt-0.5">{user.display_name || '—'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase">Role</p>
                    <p className="text-sm font-semibold text-white capitalize mt-0.5">{user.role || '—'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase">Country</p>
                    <p className="text-sm font-semibold text-white mt-0.5 flex items-center gap-1">
                      <Globe size={12} className="text-gray-400" /> {user.country || '—'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase">City</p>
                    <p className="text-sm font-semibold text-white mt-0.5 flex items-center gap-1">
                      <MapPin size={12} className="text-gray-400" /> {user.city || '—'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-[10px] text-gray-500 uppercase">Phone</p>
                    <p className="text-sm font-semibold text-white mt-0.5 flex items-center gap-1">
                      <Phone size={12} className="text-gray-400" /> {user.phone || '—'}
                    </p>
                  </div>
                </div>

                {/* Additional Info */}
                {(user.wallet_address || user.website_url || user.linkedin_url) && (
                  <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {user.wallet_address && (
                      <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                        <span className="text-[10px] text-gray-500 block mb-0.5 uppercase">Wallet Address</span>
                        <span className="font-mono text-gray-300 break-all">{user.wallet_address}</span>
                      </div>
                    )}
                    {user.website_url && (
                      <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                        <span className="text-[10px] text-gray-500 block mb-0.5 uppercase">Website</span>
                        <a
                          href={user.website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#a78bfa] hover:underline flex items-center gap-1"
                        >
                          {user.website_url} <ExternalLink size={10} />
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Uploaded Documents */}
              <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                    <FileText size={14} className="text-[#a78bfa]" /> Uploaded Identity Documents
                  </h3>
                  <span className="text-xs text-gray-500">Stored in Supabase Storage / IPFS</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* National ID */}
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl border ${user.national_id_url ? 'bg-purple-500/10 border-purple-500/20 text-[#a78bfa]' : 'bg-white/5 border-white/5 text-gray-500'}`}>
                        <CreditCard size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">National ID Card</p>
                        <p className="text-[10px] text-gray-500">
                          {user.national_id_url ? 'Document attached' : 'Not uploaded manually'}
                        </p>
                      </div>
                    </div>
                    {user.national_id_url ? (
                      <Link
                        href={user.national_id_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[#a78bfa] border border-white/10 flex items-center gap-1 transition"
                      >
                        <Eye size={12} /> View <ExternalLink size={10} />
                      </Link>
                    ) : (
                      <span className="text-[11px] text-gray-500 italic">None</span>
                    )}
                  </div>

                  {/* Passport */}
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl border ${user.passport_url ? 'bg-purple-500/10 border-purple-500/20 text-[#a78bfa]' : 'bg-white/5 border-white/5 text-gray-500'}`}>
                        <FileText size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">Passport</p>
                        <p className="text-[10px] text-gray-500">
                          {user.passport_url ? 'Document attached' : 'Not uploaded manually'}
                        </p>
                      </div>
                    </div>
                    {user.passport_url ? (
                      <Link
                        href={user.passport_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[#a78bfa] border border-white/10 flex items-center gap-1 transition"
                      >
                        <Eye size={12} /> View <ExternalLink size={10} />
                      </Link>
                    ) : (
                      <span className="text-[11px] text-gray-500 italic">None</span>
                    )}
                  </div>

                  {/* Selfie / Face Photo */}
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl border ${user.selfie_url ? 'bg-purple-500/10 border-purple-500/20 text-[#a78bfa]' : 'bg-white/5 border-white/5 text-gray-500'}`}>
                        <User size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">Selfie / Face Photo</p>
                        <p className="text-[10px] text-gray-500">
                          {user.selfie_url ? 'Photo attached' : 'Taken via Didit Live Camera'}
                        </p>
                      </div>
                    </div>
                    {user.selfie_url ? (
                      <Link
                        href={user.selfie_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[#a78bfa] border border-white/10 flex items-center gap-1 transition"
                      >
                        <Eye size={12} /> View <ExternalLink size={10} />
                      </Link>
                    ) : (
                      <span className="text-[11px] text-gray-500 italic">Didit Live</span>
                    )}
                  </div>

                  {/* Proof of Address */}
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl border ${user.proof_of_address_url ? 'bg-purple-500/10 border-purple-500/20 text-[#a78bfa]' : 'bg-white/5 border-white/5 text-gray-500'}`}>
                        <MapPin size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">Proof of Address</p>
                        <p className="text-[10px] text-gray-500">
                          {user.proof_of_address_url ? 'Document attached' : 'Not uploaded'}
                        </p>
                      </div>
                    </div>
                    {user.proof_of_address_url ? (
                      <Link
                        href={user.proof_of_address_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[#a78bfa] border border-white/10 flex items-center gap-1 transition"
                      >
                        <Eye size={12} /> View <ExternalLink size={10} />
                      </Link>
                    ) : (
                      <span className="text-[11px] text-gray-500 italic">None</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Action Prompt */}
              <div className="p-4 rounded-2xl bg-purple-500/[0.05] border border-purple-500/15 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-purple-300">Ready to take action or send a message?</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Select a built-in template or type custom feedback in the Actions tab.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('action')}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <MessageSquare size={13} /> Open Action Center
                </button>
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────────
              TAB 2: DIDIT INTELLIGENCE REPORT
          ──────────────────────────────────────────────────────────────── */}
          {activeTab === 'didit' && (() => {
            if (!session) {
              return (
                <div className="p-10 text-center rounded-2xl bg-white/[0.01] border border-white/5">
                  <Fingerprint size={36} className="mx-auto text-purple-400/40 mb-3" />
                  <h4 className="text-sm font-semibold text-white">No Didit Session Found for User</h4>
                  <p className="text-xs text-gray-500 max-w-md mx-auto mt-1">
                    This user may have registered before Didit integration or has not initiated a biometric verification session yet.
                  </p>
                </div>
              );
            }

            // Extract nested properties from payload fallback
            const raw = (session.didit_decision_payload || {}) as Record<string, any>;
            const rawFeatures = (raw.features || {}) as Record<string, any>;
            const rawId = (rawFeatures.id_verification?.properties || rawFeatures.id_verification?.data || raw.id_verification?.properties || raw.id_verification?.data || raw.id_verification || raw.kyc || {}) as Record<string, any>;
            const rawLiveness = (rawFeatures.liveness || raw.liveness || {}) as Record<string, any>;
            const rawFaceMatch = (rawFeatures.face_match || raw.face_match || {}) as Record<string, any>;
            const rawAml = (rawFeatures.aml || raw.aml || {}) as Record<string, any>;
            const rawDevice = (rawFeatures.ip_analysis || rawFeatures.device_analysis || raw.device_analysis || raw.device || {}) as Record<string, any>;
            const rawKyb = (rawFeatures.company_registry || raw.company_registry || raw.kyb || {}) as Record<string, any>;
            const rawKeyPeople = raw.key_people || raw.kyb_key_people || rawKyb.key_people || rawFeatures.company_registry?.key_people || session.kyb_key_people;

            const isSessionApproved = session.status === 'Approved' || session.status === 'completed' || session.decision === 'Approved';
            const isSessionDeclined = session.status === 'Declined' || session.status === 'rejected' || session.decision === 'Declined';
            const isSessionNotStarted = session.status === 'Not Started' || !session.status;
            const isSessionInProgress = session.status === 'In Progress' || session.status === 'in_progress';
            const isSessionInReview = session.status?.toLowerCase().includes('review');

            // Biometric & check metrics
            const livenessScore = session.liveness_score ?? (rawLiveness.score != null ? Number(rawLiveness.score) : null);
            const livenessStatus = session.liveness_status || rawLiveness.status || rawLiveness.result;

            const faceMatchScore = session.face_match_score ?? (rawFaceMatch.score != null ? Number(rawFaceMatch.score) : null);
            const faceMatchStatus = session.face_match_status || rawFaceMatch.status || rawFaceMatch.result;

            const amlHits = session.aml_hits ?? rawAml.hits ?? rawAml.hits_count ?? 0;
            const amlStatus = session.aml_status || rawAml.status || rawAml.result || (isSessionNotStarted ? 'Pending' : 'Passed');

            const deviceIp = session.device_ip || rawDevice.ip || rawDevice.ip_address;
            const deviceCountry = session.device_country || rawDevice.country || rawDevice.country_name;
            const devicePlatform = session.device_platform || rawDevice.platform || rawDevice.device_platform || rawDevice.os;
            const isVpn = session.is_vpn ?? (rawDevice.is_vpn === true || rawDevice.vpn === true);

            // Risk & Compliance Warnings
            const warnings: string[] = [];
            if (Array.isArray(raw.warnings)) {
              for (const w of raw.warnings) {
                if (typeof w === 'string') warnings.push(w);
                else if (w?.message) warnings.push(`${w.feature ? `${w.feature.toUpperCase()}: ` : ''}${w.message}`);
                else if (w?.code) warnings.push(w.code);
              }
            }
            if (raw.simulated_scenario) {
              warnings.push(`Simulated Scenario: ${raw.simulated_scenario}`);
            }
            if (session.decision && !warnings.some((w) => w.includes(session.decision!)) && isSessionDeclined) {
              warnings.push(`Reason: ${session.decision}`);
            }

            // KYC Document Data
            const docItems = [
              { label: 'First Name', value: session.first_name || rawId.first_name || raw.first_name },
              { label: 'Last Name', value: session.last_name || rawId.last_name || raw.last_name },
              { label: 'Date of Birth', value: session.date_of_birth || rawId.date_of_birth || raw.date_of_birth },
              { label: 'Nationality', value: session.nationality || rawId.nationality || raw.nationality },
              { label: 'Gender', value: session.gender || rawId.gender || raw.gender },
              { label: 'Document Type', value: session.document_type || rawId.document_type || raw.document_type },
              { label: 'Document Number', value: session.document_number || rawId.document_number || raw.document_number },
              { label: 'Personal Number', value: session.personal_number || rawId.personal_number || raw.personal_number },
              { label: 'Issuing State', value: session.issuing_state || rawId.issuing_state || rawId.issuing_country || raw.issuing_state },
              { label: 'Expiry Date', value: session.expiration_date || rawId.expiration_date || raw.expiration_date },
            ].filter((item) => Boolean(item.value));

            // KYB Company Data
            const kybItems = [
              { label: 'Company Name', value: session.company_name || rawKyb.company_name || raw.company_name },
              { label: 'Registration Number', value: session.registration_number || rawKyb.registration_number || raw.registration_number },
              { label: 'Company Type', value: session.company_type || rawKyb.company_type || raw.company_type },
              { label: 'Incorporation Date', value: session.incorporation_date || rawKyb.incorporation_date || raw.incorporation_date },
              { label: 'Company Status', value: session.company_status || rawKyb.status || raw.company_status },
              { label: 'Country', value: session.company_country || rawKyb.country || raw.company_country },
            ].filter((item) => Boolean(item.value));

            const isKybSession = session.session_kind === 'KYB' || kybItems.length > 0;

            return (
              <div className="space-y-5">
                {/* Status Bar */}
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-gray-400">Didit Session Status:</span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border text-xs font-semibold ${
                        isSessionApproved
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : isSessionDeclined
                          ? 'bg-red-500/10 text-red-400 border-red-500/20'
                          : isSessionInReview
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                      }`}
                    >
                      {isSessionApproved ? <CheckCircle size={13} /> : isSessionDeclined ? <XCircle size={13} /> : <Clock size={13} />}
                      {session.status}
                    </span>
                    {session.decision && (
                      <span className="text-xs text-gray-400 bg-white/5 px-2.5 py-1 rounded-xl">
                        Decision: <strong className="text-white">{session.decision}</strong>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRefetch}
                    disabled={refetching}
                    className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 font-medium transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {refetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Re-fetch from Didit API
                  </button>
                </div>

                {/* 1. Status Notice Banner (Explains WHY report is empty if Not Started) */}
                {isSessionNotStarted && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3.5">
                    <Clock size={18} className="text-amber-400 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                        Session Created — Not Started by User
                      </h4>
                      <p className="text-xs text-amber-200/80 mt-1 leading-relaxed">
                        A Didit verification link was generated for this account, but <strong>the user has not yet uploaded their ID document or completed the facial liveness scan on Didit</strong>.
                        Didit does not have biometric, OCR document data, or security analysis until the user finishes the verification on their mobile device or browser.
                      </p>
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleRefetch}
                          disabled={refetching}
                          className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold flex items-center gap-1.5 transition"
                        >
                          {refetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          Check for User Activity
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {isSessionInProgress && (
                  <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/25 flex items-start gap-3.5">
                    <Activity size={18} className="text-blue-400 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <h4 className="text-xs font-bold text-blue-300 uppercase tracking-wide">
                        Verification In Progress
                      </h4>
                      <p className="text-xs text-blue-200/80 mt-1 leading-relaxed">
                        The user has opened the Didit verification portal and is currently capturing documents or selfies. Final biometric scores and extracted data will be available once submitted.
                      </p>
                    </div>
                  </div>
                )}

                {/* 2. Compliance Warnings & Decline Reasons */}
                {warnings.length > 0 && (
                  <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-red-300 flex items-center gap-2">
                      <AlertTriangle size={14} className="text-red-400" /> Didit Risk & Compliance Warnings ({warnings.length})
                    </h4>
                    <div className="space-y-1.5">
                      {warnings.map((w, idx) => (
                        <div key={idx} className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-medium text-red-200 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Verification Scores */}
                <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 sm:p-5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
                    <Activity size={14} className="text-emerald-400" /> Biometric & AML Checks
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Liveness */}
                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-2">
                        <Eye size={12} /> Facial Liveness
                      </p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold text-white">
                          {isSessionNotStarted
                            ? 'Pending'
                            : livenessScore != null
                            ? `${Math.round(livenessScore * (livenessScore <= 1 ? 100 : 1))}%`
                            : 'N/A'}
                        </span>
                        {livenessStatus && (
                          <span className="text-[11px] text-emerald-400 font-medium">{livenessStatus}</span>
                        )}
                      </div>
                    </div>

                    {/* Face Match */}
                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-2">
                        <Fingerprint size={12} /> Face Match with ID
                      </p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold text-white">
                          {isSessionNotStarted
                            ? 'Pending'
                            : faceMatchScore != null
                            ? `${Math.round(faceMatchScore * (faceMatchScore <= 1 ? 100 : 1))}%`
                            : 'N/A'}
                        </span>
                        {faceMatchStatus && (
                          <span className="text-[11px] text-emerald-400 font-medium">{faceMatchStatus}</span>
                        )}
                      </div>
                    </div>

                    {/* AML Screening */}
                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-2">
                        <Shield size={12} /> AML Screening
                      </p>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${
                            isSessionNotStarted
                              ? 'text-gray-400 bg-white/5 border-white/10'
                              : amlHits > 0
                              ? 'text-red-400 bg-red-500/10 border-red-500/20'
                              : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          }`}
                        >
                          {isSessionNotStarted ? 'Pending' : amlHits > 0 ? `⚠ ${amlHits} Hits` : 'Clear / No Hits'}
                        </span>
                        <span className="text-[11px] text-gray-400">{amlStatus}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. KYB Company Information (if applicable) */}
                {isKybSession && (
                  <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 sm:p-5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
                      <Shield size={14} className="text-[#38bdf8]" /> KYB Company Registry Data
                    </h4>
                    {kybItems.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {kybItems.map((item) => (
                          <div key={item.label} className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                            <p className="text-[10px] text-gray-500 uppercase">{item.label}</p>
                            <p className="text-xs font-semibold text-gray-200 mt-0.5 break-words">{item.value}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-white/[0.01] border border-dashed border-white/10 text-center">
                        <p className="text-xs text-gray-400">
                          {isSessionNotStarted
                            ? 'No business registry documents scanned yet.'
                            : 'No company registry properties extracted from Didit.'}
                        </p>
                      </div>
                    )}

                    {/* Key People */}
                    {Array.isArray(rawKeyPeople) && rawKeyPeople.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-white/5">
                        <p className="text-[11px] font-semibold text-gray-300 uppercase mb-2">
                          Officers & Beneficial Owners (UBOs)
                        </p>
                        <div className="space-y-1.5">
                          {rawKeyPeople.map((person: any, idx: number) => (
                            <div key={idx} className="p-2 rounded-xl bg-white/[0.02] border border-white/5 text-xs flex justify-between items-center">
                              <span className="text-gray-200 font-medium">
                                {person.name || person.full_name || `${person.first_name || ''} ${person.last_name || ''}`}
                              </span>
                              <span className="text-[10px] text-gray-400">{person.role || person.title || 'Officer'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. Extracted Personal Information from Didit */}
                <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 sm:p-5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
                    <User size={14} className="text-[#a78bfa]" /> Extracted Identity Document Data
                  </h4>
                  {docItems.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {docItems.map((item) => (
                        <div key={item.label} className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                          <p className="text-[10px] text-gray-500 uppercase">{item.label}</p>
                          <p className="text-xs font-semibold text-gray-200 mt-0.5 break-words">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-white/[0.01] border border-dashed border-white/10 text-center">
                      <p className="text-xs text-gray-400">
                        {isSessionNotStarted
                          ? 'No identity document scanned yet. Extracted fields (Name, DOB, Nationality, Document ID, Expiry) will appear here once the user uploads their document.'
                          : 'No document fields extracted by Didit OCR.'}
                      </p>
                    </div>
                  )}
                </div>

                {/* 6. Device & IP Intelligence */}
                <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 sm:p-5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
                    <Smartphone size={14} className="text-amber-400" /> Device & Network Security
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <p className="text-[10px] text-gray-500 uppercase">IP Address</p>
                      <p className="text-xs font-mono text-gray-200 mt-0.5">{deviceIp || '—'}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <p className="text-[10px] text-gray-500 uppercase">Country</p>
                      <p className="text-xs text-gray-200 mt-0.5">{deviceCountry || '—'}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <p className="text-[10px] text-gray-500 uppercase">Platform</p>
                      <p className="text-xs text-gray-200 mt-0.5">{devicePlatform || '—'}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <p className="text-[10px] text-gray-500 uppercase">VPN / Proxy</p>
                      <p
                        className={`text-xs font-bold mt-0.5 ${
                          isSessionNotStarted ? 'text-gray-400' : isVpn ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {isSessionNotStarted ? 'Pending' : isVpn ? '⚠ Yes (VPN Detected)' : '✓ None Detected'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 7. Admin Override Section */}
                <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                      <Lock size={14} className="text-[#a78bfa]" /> Direct Didit Session Override
                    </h4>
                    <button
                      type="button"
                      onClick={() => setOverrideMode((m) => !m)}
                      className="text-xs text-[#a78bfa] hover:text-purple-300 font-semibold"
                    >
                      {overrideMode ? 'Cancel' : 'Set Direct Override'}
                    </button>
                  </div>

                  {session.admin_override_status && !overrideMode && (
                    <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300">
                      <strong>Active Override:</strong> {session.admin_override_status}
                      {session.admin_override_reason && ` — "${session.admin_override_reason}"`}
                    </div>
                  )}

                  {overrideMode && (
                    <div className="space-y-3 pt-2">
                      <div className="flex gap-2">
                        {(['Approved', 'Declined'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setOverrideStatus(st)}
                            className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition ${
                              overrideStatus === st
                                ? st === 'Approved'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : 'bg-red-500/20 text-red-300 border-red-500/40'
                                : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        placeholder="Override reason..."
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl bg-[#0e1220] border border-white/10 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-[#a78bfa]"
                      />
                      <button
                        type="button"
                        onClick={handleApplyOverride}
                        disabled={isPending || !overrideStatus}
                        className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold transition disabled:opacity-50"
                      >
                        Apply Override
                      </button>
                    </div>
                  )}
                </div>

                {/* 8. Raw JSON Viewer */}
                {session.didit_decision_payload && (
                  <details className="rounded-2xl bg-white/[0.01] border border-white/5 p-4 text-xs">
                    <summary className="cursor-pointer text-gray-400 hover:text-white font-medium flex items-center gap-1.5">
                      <FileText size={12} /> View Raw Didit Decision Payload
                    </summary>
                    <pre className="mt-3 p-3 rounded-xl bg-black/50 border border-white/5 text-[10px] text-gray-300 font-mono overflow-x-auto max-h-56">
                      {JSON.stringify(session.didit_decision_payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            );
          })()}

          {/* ───────────────────────────────────────────────────────────────
              TAB 3: STATUS ACTIONS & BUILT-IN MESSAGES
          ──────────────────────────────────────────────────────────────── */}
          {activeTab === 'action' && (
            <div className="space-y-6">
              {/* Category selector */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-2">
                  Select Template Category
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActionCategory('in_review');
                      setActionChoice('notify');
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition text-center ${
                      actionCategory === 'in_review'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-sm'
                        : 'bg-white/[0.02] text-gray-400 border-white/5 hover:bg-white/[0.05]'
                    }`}
                  >
                    ⏳ In Review / Clarify
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionCategory('declined');
                      setActionChoice('decline');
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition text-center ${
                      actionCategory === 'declined'
                        ? 'bg-red-500/15 text-red-300 border-red-500/30 shadow-sm'
                        : 'bg-white/[0.02] text-gray-400 border-white/5 hover:bg-white/[0.05]'
                    }`}
                  >
                    🚫 Decline / Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionCategory('approved');
                      setActionChoice('approve');
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition text-center ${
                      actionCategory === 'approved'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 shadow-sm'
                        : 'bg-white/[0.02] text-gray-400 border-white/5 hover:bg-white/[0.05]'
                    }`}
                  >
                    ✅ Approve KYC
                  </button>
                </div>
              </div>

              {/* Built-in templates list */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-2 flex items-center justify-between">
                  <span>Built-in Message Templates</span>
                  <span className="text-[10px] text-purple-400 flex items-center gap-1">
                    <Sparkles size={11} /> Click to auto-fill
                  </span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MESSAGE_TEMPLATES.filter((t) => t.category === actionCategory).map((tmpl) => {
                    const isSelected = selectedTemplateId === tmpl.id;
                    return (
                      <button
                        key={tmpl.id}
                        type="button"
                        onClick={() => handleSelectTemplate(tmpl)}
                        className={`text-left p-3 rounded-xl border text-xs transition flex flex-col justify-between ${
                          isSelected
                            ? 'bg-purple-600/20 border-purple-500/50 text-white'
                            : 'bg-white/[0.02] border-white/5 text-gray-300 hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-semibold text-white">{tmpl.label}</span>
                          {isSelected && <Check size={12} className="text-[#a78bfa]" />}
                        </div>
                        <p className="text-[11px] text-gray-400 line-clamp-2">{tmpl.message}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notification & Reason Editor */}
              <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 sm:p-5 space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                  <Send size={14} className="text-[#a78bfa]" /> Notification Details (Sent to User Dashboard)
                </h4>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">Notification Title</label>
                    <input
                      type="text"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="e.g. Action Required: Re-upload Document"
                      className="w-full px-3.5 py-2 rounded-xl bg-[#0e1220] border border-white/10 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-[#a78bfa]"
                    />
                  </div>

                  {actionChoice === 'decline' && (
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">Decline Reason (Recorded in Audit)</label>
                      <input
                        type="text"
                        value={customReason}
                        onChange={(e) => setCustomReason(e.target.value)}
                        placeholder="e.g. Blurry ID document / Name mismatch"
                        className="w-full px-3.5 py-2 rounded-xl bg-[#0e1220] border border-white/10 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-[#a78bfa]"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">
                      User Notification Message (Supports Markdown / Links)
                    </label>
                    <textarea
                      rows={4}
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      placeholder="Type the message explaining the reason or action required..."
                      className="w-full px-3.5 py-2 rounded-xl bg-[#0e1220] border border-white/10 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-[#a78bfa] leading-relaxed"
                    />
                  </div>
                </div>

                {/* Action Mode Selector */}
                <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">Action:</span>
                    <button
                      type="button"
                      onClick={() => setActionChoice('notify')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition ${
                        actionChoice === 'notify'
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                          : 'bg-white/5 text-gray-400 border-white/10'
                      }`}
                    >
                      Message Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionChoice('approve')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition ${
                        actionChoice === 'approve'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-white/5 text-gray-400 border-white/10'
                      }`}
                    >
                      Approve & Send
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionChoice('decline')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition ${
                        actionChoice === 'decline'
                          ? 'bg-red-500/20 text-red-300 border-red-500/40'
                          : 'bg-white/5 text-gray-400 border-white/10'
                      }`}
                    >
                      Decline & Send
                    </button>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="button"
                    onClick={handleExecuteAction}
                    disabled={isPending || !customMessage.trim()}
                    className={`px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg transition flex items-center gap-2 disabled:opacity-50 cursor-pointer ${
                      actionChoice === 'approve'
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : actionChoice === 'decline'
                        ? 'bg-red-600 hover:bg-red-500 text-white'
                        : 'bg-purple-600 hover:bg-purple-500 text-white'
                    }`}
                  >
                    {isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : actionChoice === 'approve' ? (
                      <CheckCircle size={13} />
                    ) : actionChoice === 'decline' ? (
                      <XCircle size={13} />
                    ) : (
                      <Send size={13} />
                    )}
                    {actionChoice === 'approve'
                      ? 'Approve KYC & Notify'
                      : actionChoice === 'decline'
                      ? 'Decline KYC & Notify'
                      : 'Send Notification to User'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-white/10 bg-white/[0.015] flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Audit logging: all approvals, rejections, and messages are permanently recorded.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
