//frontend/app/dashboard/page.js
"use client";
// shafqaat — business dashboard Dashboard: fully dynamic, reads real data from Supabase
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  Users,
  DollarSign,
  Target,
  Plus,
  Eye,
  BarChart3,
  Search,
  ChevronLeft,
  ChevronRight,
  UserCircle,
  Clock,
  CheckCircle,
  AlertCircle,
  Edit2,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { getMyCampaigns } from "@/utils/supabase/getCampaigns";
import { getMyProfile, calcProfileCompletion } from "@/utils/supabase/getProfile";
import Navbar from "@/components/navbar";
import { ethers } from "ethers";
import BusinessCampaignJSON from "@/abis/BusinessCampaign.json";
import CampaignReviewInfo from "@/components/campaign-review-info";
import DashboardOverviewTab from "@/components/Owner/DashboardOverviewTab";

const ITEMS_PER_PAGE = 6; // shafqaat — campaigns per page in My Campaigns tab

// Function to invoke withdrawFunds on the specific campaign contract
async function handleWithdrawFunds(contractAddress, setTxPending) {
  if (typeof window === "undefined" || !window.ethereum) {
    alert("Please install MetaMask!");
    return;
  }

  try {
    setTxPending(contractAddress); // Set loading state for this specific card
    await window.ethereum.request({ method: "eth_requestAccounts" });
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    // Attach to the specific campaign contract address fetched from Supabase
    const campaignContract = new ethers.Contract(
      contractAddress,
      BusinessCampaignJSON.abi,
      signer
    );

    // Trigger the withdrawFunds() method on BusinessCampaign.sol
    const tx = await campaignContract.withdrawFunds();
    alert("Withdrawal transaction submitted! Hash: " + tx.hash);

    await tx.wait();
    alert("Funds successfully withdrawn to your wallet!");
    window.location.reload(); // Refresh UI to update balances
  } catch (err) {
    console.error("Withdrawal error:", err);
    alert(err.reason || err.message || "Withdrawal failed");
  } finally {
    setTxPending(null);
  }
}

// shafqaat — Calculate days left from created_at + duration
function calcDaysLeft(createdAt, durationDays) {
  const deadline = new Date(
    new Date(createdAt).getTime() + (durationDays ?? 30) * 24 * 60 * 60 * 1000,
  );
  const diff = Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

// shafqaat — Get status styling based on campaign status
function getStatusStyle(status) {
  const statusMap = {
    draft: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "Draft" },
    in_review: { bg: "bg-blue-500/20", text: "text-blue-400", label: "In Review" },
    approved: { bg: "bg-green-500/20", text: "text-green-400", label: "Approved" },
    launched: { bg: "bg-[#28a745]/20", text: "text-[#28a745]", label: "Launched" },
    ended: { bg: "bg-gray-500/20", text: "text-gray-400", label: "Ended" },
    rejected: { bg: "bg-red-500/20", text: "text-red-500", label: "Rejected" },
    // completed: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Completed" },
    // cancelled: { bg: "bg-red-500/20", text: "text-red-400", label: "Cancelled" },
  };
  return statusMap[status?.toLowerCase()] || { bg: "bg-white/10", text: "text-gray-400", label: status || "Unknown" };
}

function buildDraftEditHref(campaign) {
  return `/create-campaign?campaignId=${encodeURIComponent(String(campaign.id ?? ""))}`;
}

export default function DashboardPage() {
  const router = useRouter();

  // shafqaat — Active tab state
  const [activeTab, setActiveTab] = useState("overview");

  // shafqaat — Real data from Supabase
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // shafqaat — My Campaigns tab: search + pagination state
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [txPending, setTxPending] = useState(null);

  // shafqaat — Fetch user, campaigns and profile in parallel on mount
  useEffect(() => {
    async function loadAll() {
      const supabase = createClient();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      setUser(authUser);

      const [camps, prof] = await Promise.all([
        getMyCampaigns(),
        getMyProfile(),
      ]);
      setCampaigns(camps);
      setProfile(prof);
      setLoading(false);
    }
    loadAll();
  }, []);

  // shafqaat — Compute real stats from the fetched campaigns
  const stats = {
    totalReceived: campaigns.reduce(
      (s, c) => s + parseFloat(c.amount_pledged ?? "0"),
      0,
    ),
    activeCampaigns: campaigns.filter(
      (c) => c.status?.toLowerCase() === "launched",
    ).length,
    totalCampaigns: campaigns.length,
    profileCompletion: calcProfileCompletion(profile),
  };

  // shafqaat — Filtered + paginated campaigns for My Campaigns tab
  const filtered = campaigns.filter(
    (c) =>
      !search ||
      c.title?.toLowerCase().includes(search.toLowerCase()) ||
      c.category?.toLowerCase().includes(search.toLowerCase()),
  );
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const tabs = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "campaigns", label: "My Campaigns", icon: Target },
    { id: "analytics", label: "Analytics", icon: TrendingUp },
    { id: "profile", label: "Profile", icon: UserCircle },
  ];

  const displayName =
    profile?.display_name ||
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "Creator";

  return (
    <div className="min-h-screen bg-[#181A2A] ">
      <Navbar />
      <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pt-7">
        {/* shafqaat — Dashboard header with real user name */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black text-white">
              {loading ? "Dashboard" : `Welcome, ${displayName}`}
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              Manage your campaigns and track your progress
            </p>
          </div>

          <div className="flex items-center space-x-4">
            <div className="bg-[#1a2030] border border-white/5 rounded-xl px-4 py-2">
              <div className="flex items-center space-x-2">
                <Target className="w-4 h-4 text-[#6f42c1]" />
                <span className="text-white text-sm font-medium">
                  Business Owner
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-4 items-stretch">

          {/* shafqaat — Profile completion banner (only if incomplete) */}
          {!loading && stats.profileCompletion < 100 && (
            <div className="bg-[#6f42c1]/10 border border-[#6f42c1]/30 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-[#a78bfa] shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-white">
                    Profile {stats.profileCompletion}% complete
                  </p>
                  <p className="text-xs text-gray-400">
                    Complete your KYC/KYB to unlock campaign publishing trust badges
                  </p>
                </div>
              </div>
              <Link
                href="/profile"
                className="shrink-0 text-xs font-semibold text-white bg-[#6f42c1] hover:bg-[#5a3599] px-4 py-2 rounded-full transition"
              >
                Complete Profile →
              </Link>
            </div>
          )}
        </div>

      {/* shafqaat — Stats cards: real data computed from Supabase */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "Total Received (ETH)",
            value: loading ? "…" : `${stats.totalReceived.toFixed(3)} ETH`,
            icon: DollarSign,
            color: "#6f42c1",
          },
          {
            label: "My Campaigns",
            value: loading ? "…" : stats.totalCampaigns,
            icon: Target,
            color: "#037dd6",
          },
          {
            label: "Active Campaigns",
            value: loading ? "…" : stats.activeCampaigns,
            icon: TrendingUp,
            color: "#28a745",
          },
          {
            label: "Profile Complete",
            value: loading ? "…" : `${stats.profileCompletion}%`,
            icon: UserCircle,
            color: "#f6851b",
          },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-[#1a2030] rounded-2xl p-5 border border-white/5"
            >
              <div className="flex items-center gap-3">
                <div
                  className="p-2.5 rounded-xl"
                  style={{ backgroundColor: stat.color + "22" }}
                >
                  <Icon className="h-5 w-5" style={{ color: stat.color }} />
                </div>
                <div>
                  <p className="text-2xl font-black text-white">{stat.value}</p>
                  <p className="text-xs text-gray-400">{stat.label}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* shafqaat — Tabs + Content */}
      <div className="bg-[#1a2030] rounded-3xl border border-white/5 overflow-hidden">
        {/* Tab Nav */}
        <div className="border-b border-white/10 px-6">
          <nav className="flex gap-1 pt-4 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl border-b-2 transition duration-200 whitespace-nowrap ${
                    activeTab === tab.id
                      ? "border-[#6f42c1] text-[#a78bfa] bg-[#6f42c1]/10"
                      : "border-transparent text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  {/* shafqaat — Profile tab shows incomplete badge */}
                  {tab.id === "profile" && stats.profileCompletion < 100 && (
                    <span className="ml-1 w-2 h-2 rounded-full bg-[#f6851b] inline-block" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-8">
          {/* ── Overview Tab ─────────────────────────────────── */}
          {activeTab === "overview" && (
              <DashboardOverviewTab campaigns={campaigns} loading={loading} />
            )}

          {/* ── My Campaigns Tab (with search + pagination) ── */}
          {activeTab === "campaigns" && (
            <div>
              {/* shafqaat — Header + search bar */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h2 className="text-xl font-bold text-white">
                  My Campaigns {!loading && `(${campaigns.length})`}
                </h2>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Search my campaigns…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full pl-9 pr-4 py-2 bg-[#0d1117] border border-white/10 rounded-full text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6f42c1] transition"
                  />
                </div>
              </div>

              {/* shafqaat — Loading / empty states */}
              {loading && (
                <div className="text-center py-12 text-gray-400 text-sm">
                  Loading…
                </div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">
                  {campaigns.length === 0
                    ? "No campaigns yet."
                    : `No campaigns matching "${search}"`}
                </div>
              )}

              {/* shafqaat — Campaign table */}
              {!loading && paginated.length > 0 && (
                <div className="overflow-x-auto mb-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        {[
                          "Campaign",
                          "Goal (ETH)",
                          "Pledged (ETH)",
                          "Investors",
                          "Category",
                          "Days Left",
                          "Status",
                          "Actions",
                        ].map((h) => (
                          <th
                            key={h}
                            className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((campaign) => {
                        const daysLeft = calcDaysLeft(
                          campaign.created_at,
                          campaign.duration,
                        );
                        const statusStyle = getStatusStyle(campaign.status);
                        return (
                          <tr
                            key={campaign.id}
                            className="border-b border-white/5 hover:bg-white/5 transition-colors"
                          >
                            <td className="py-4 px-4 font-medium text-white max-w-50 truncate">
                              {campaign.title}
                            </td>
                            <td className="py-4 px-4 text-gray-300">
                              {parseFloat(campaign.funding_goal ?? "0").toFixed(
                                3,
                              )}
                            </td>
                            <td className="py-4 px-4 text-gray-300">
                              {parseFloat(campaign.amount_pledged ?? "0").toFixed(
                                3,
                              )}
                            </td>
                            <td className="py-4 px-4 text-gray-300">
                              {Number(campaign.investor_count ?? 0)}
                            </td>
                            <td className="py-4 px-4 text-gray-300 capitalize">
                              {campaign.category ?? "—"}
                            </td>
                            <td className="py-4 px-4 text-gray-300">
                              {daysLeft > 0 ? `${daysLeft}d` : "Ended"}
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                    statusStyle.bg
                                  } ${statusStyle.text}`}
                                >
                                  {statusStyle.label}
                                </span>
                                <CampaignReviewInfo review={campaign.campaign_review} />
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex gap-2">
                                {["draft", "approved", "adjusted"].includes(campaign.status?.toLowerCase()) && (
                                  <Link
                                    href={buildDraftEditHref(campaign)}
                                    className="text-yellow-400 hover:text-yellow-300 text-xs font-medium transition-colors"
                                  >
                                    {["approved", "adjusted"].includes(campaign.status?.toLowerCase() ?? "")
                                      ? "Launch"
                                      : "Edit"}
                                  </Link>
                                )}

                                {/* Upload Financials for Successful Campaigns */}
                                {campaign.status?.toLowerCase() === "successful" && (
                                  <Link
                                    href={`/dashboard/financials?campaignId=${campaign.id}`}
                                    className="inline-flex items-center px-2.5 py-1 bg-[#6f42c1]/20 border border-[#6f42c1]/40 hover:bg-[#6f42c1] text-[#a78bfa] hover:text-white rounded-md text-xs font-medium transition-all"
                                  >
                                    Upload Financials
                                  </Link>
                                )}

                                <Link
                                  href={`/campaigns/${campaign.id}`}
                                  className="text-[#a78bfa] hover:text-white text-xs font-medium transition-colors"
                                >
                                  View
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* shafqaat — Pagination controls */}
              {!loading && totalPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-full bg-white/5 text-gray-400 hover:bg-[#6f42c1]/20 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`w-8 h-8 rounded-full text-xs font-bold transition ${
                          currentPage === page
                            ? "bg-[#6f42c1] text-white"
                            : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {page}
                      </button>
                    ),
                  )}
                  <button
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-full bg-white/5 text-gray-400 hover:bg-[#6f42c1]/20 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <span className="text-xs text-gray-500">
                    Page {currentPage} of {totalPages}
                  </span>
                </div>
              )}
            </div>
          )}

            {/* ── Analytics Tab ──────────────────────────────── */}
            {activeTab === "analytics" && (
              <div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-white">Analytics</h2>
                    <p className="text-sm text-gray-400 mt-1">
                      Campaign performance for your own projects only.
                    </p>
                  </div>
                  <Link
                    href="/dashboard/analytics"
                    className="inline-flex items-center justify-center bg-[#6f42c1] hover:bg-[#5a3599] text-white text-sm font-semibold px-5 py-2.5 rounded-full transition"
                  >
                    Open full analytics
                  </Link>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-[#0d1117] rounded-2xl p-6 border border-white/5">
                    <h3 className="text-sm font-bold text-white mb-4">
                      Campaign Summary
                    </h3>
                    <div className="space-y-3">
                      {[
                        { label: "Total Campaigns", value: campaigns.length },
                        { label: "Active Now", value: stats.activeCampaigns },
                        { label: "Ended", value: campaigns.length - stats.activeCampaigns },
                        { label: "Total Received (ETH)", value: stats.totalReceived.toFixed(4) },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between">
                          <span className="text-sm text-gray-400">{item.label}</span>
                          <span className="text-sm font-bold text-[#a78bfa]">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-[#0d1117] rounded-2xl p-6 border border-white/5">
                    <h3 className="text-sm font-bold text-white mb-4">
                      Largest Campaigns
                    </h3>
                    {campaigns.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">
                        No campaigns yet
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {[...campaigns]
                          .sort((a, b) => parseFloat(b.funding_goal ?? "0") - parseFloat(a.funding_goal ?? "0"))
                          .slice(0, 5)
                          .map((c) => (
                            <div key={c.id} className="flex items-center justify-between gap-3">
                              <span className="text-sm text-gray-300 truncate">
                                {c.title}
                              </span>
                              <span className="text-sm text-[#a78bfa] font-semibold whitespace-nowrap">
                                {parseFloat(c.funding_goal ?? "0").toFixed(3)} ETH
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 bg-[#0d1117] rounded-2xl p-6 border border-white/5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Need deeper campaign performance insights?
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      View the owner analytics page for status breakdowns, growth trends, and category performance.
                    </p>
                  </div>
                  <Link
                    href="/dashboard/analytics"
                    className="inline-flex items-center justify-center bg-white/5 hover:bg-white/10 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition"
                  >
                    View owner analytics
                  </Link>
                </div>
              </div>
            )}

          {/* ── Profile Tab ────────────────────────────────── */}
          {activeTab === "profile" && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">
                  Creator Profile
                </h2>
                <Link
                  href="/profile"
                  className="bg-[#6f42c1] hover:bg-[#5a3599] text-white text-sm font-semibold px-5 py-2.5 rounded-full transition"
                >
                  {profile ? "Edit Profile" : "Create Profile"}
                </Link>
              </div>

              {/* shafqaat — Profile completion bar */}
              <div className="bg-[#0d1117] rounded-2xl p-6 border border-white/5 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-white">
                    Profile Completion
                  </span>
                  <span className="text-sm font-bold text-[#a78bfa]">
                    {stats.profileCompletion}%
                  </span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2">
                  <div
                    className="bg-[#6f42c1] h-2 rounded-full transition-all duration-700"
                    style={{ width: `${stats.profileCompletion}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Complete your profile to earn trust badges visible to
                  investors
                </p>
              </div>

              {/* shafqaat — Profile summary if it exists */}
              {profile ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { label: "Full Name", value: profile.full_name },
                    { label: "Display Name", value: profile.display_name },
                    { label: "Country", value: profile.country },
                    { label: "City", value: profile.city },
                    { label: "Phone", value: profile.phone },
                    { label: "Website", value: profile.website_url },
                  ].map(({ label, value }) =>
                    value ? (
                      <div
                        key={label}
                        className="bg-[#0d1117] rounded-xl p-4 border border-white/5"
                      >
                        <p className="text-xs text-gray-500 mb-1">{label}</p>
                        <p className="text-sm text-white font-medium">
                          {value}
                        </p>
                      </div>
                    ) : null,
                  )}
                  {/* shafqaat — KYC/KYB doc status indicators */}
                  <div className="md:col-span-2 bg-[#0d1117] rounded-xl p-4 border border-white/5">
                    <p className="text-xs text-gray-500 mb-3">
                      Document Verification Status
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          label: "National ID",
                          done: !!profile.national_id_cid,
                        },
                        { label: "Selfie", done: !!profile.selfie_cid },
                        {
                          label: "Proof of Address",
                          done: !!profile.proof_of_address_cid,
                        },
                        {
                          label: "Business Reg.",
                          done: !!profile.business_reg_cid,
                        },
                        { label: "Tax Cert.", done: !!profile.tax_cert_cid },
                        {
                          label: "Bank Statement",
                          done: !!profile.bank_statement_cid,
                        },
                      ].map(({ label, done }) => (
                        <div key={label} className="flex items-center gap-2">
                          {done ? (
                            <CheckCircle className="h-4 w-4 text-[#28a745] shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-gray-600 shrink-0" />
                          )}
                          <span
                            className={`text-xs ${done ? "text-gray-300" : "text-gray-600"}`}
                          >
                            {label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <UserCircle className="h-12 w-12 text-[#6f42c1]/30 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm mb-4">
                    You haven't set up your creator profile yet.
                  </p>
                  <Link
                    href="/profile"
                    className="inline-block bg-[#6f42c1] hover:bg-[#5a3599] text-white text-sm font-semibold px-6 py-3 rounded-full transition"
                  >
                    Set Up Profile →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
