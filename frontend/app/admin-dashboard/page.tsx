// Path in your project: app/admin-dashboard/page.tsx
import { createClient } from "@/utils/supabase/server";
import {
  Clock,
  TrendingUp,
  CheckCircle2,
  Landmark,
  Scale,
  ScrollText,
  ArrowRight,
  ArrowUpRight,
  LayoutDashboard,
  ShieldCheck,
  ArrowLeftRight,
} from "lucide-react";
import Link from "next/link";
import MarketplaceTradingChart from "@/components/Marketplace/tradingChart";
import { getAdminMetrics } from "@/lib/admin/dashboard-metrics";

function StatCard({
  label,
  icon: Icon,
  value,
  delta,
  deltaLabel,
}: {
  label: string;
  icon: any;
  value: string | number;
  delta: string;
  deltaLabel: string;
}) {
  return (
    <div className="bg-[#141a2e] rounded-3xl border border-white/5 p-6">
      <div className="flex items-start justify-between mb-6">
        <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</p>
        <div className="bg-violet-500/10 rounded-xl p-2">
          <Icon className="h-4 w-4 text-[#a78bfa]" />
        </div>
      </div>
      <p className="text-3xl font-bold text-white mb-3">{value}</p>
      <span className="inline-flex items-center gap-1 bg-green-500/10 text-green-400 border border-green-500/20 rounded-full px-2 py-0.5 text-xs">
        <ArrowUpRight className="h-3 w-3" /> {delta}
        <span className="text-gray-500 ml-1">{deltaLabel}</span>
      </span>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: any;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 rounded-2xl p-4 transition"
    >
      <div className="bg-violet-500/10 rounded-xl p-2.5 shrink-0">
        <Icon className="h-4 w-4 text-[#a78bfa]" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-gray-500 truncate">{subtitle}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-gray-600 ml-auto shrink-0" />
    </Link>
  );
}

export default async function AdminDashboardLandingPage() {
  const supabase = await createClient();
  const metrics = await getAdminMetrics();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 pt-24">
      {/* Header */}
      <div className="mb-8 border-b border-white/10 pb-6">
        <h1 className="text-3xl font-black text-white mb-2 flex items-center gap-3">
          <LayoutDashboard className="text-[#a78bfa] h-8 w-8" />
          Admin Dashboard
        </h1>
        <p className="text-gray-400">Platform oversight — campaigns, escrow, and secondary market activity.</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          label="Pending review"
          icon={Clock}
          value={metrics.pendingCount ?? 0}
          delta="Queue"
          deltaLabel="awaiting decision"
        />
        <StatCard
          label="Accepting investment"
          icon={TrendingUp}
          value={metrics.liveCount ?? 0}
          delta="Live"
          deltaLabel="raising now"
        />
        <StatCard
          label="Successfully funded"
          icon={CheckCircle2}
          value={metrics.fundedCount ?? 0}
          delta="Closed"
          deltaLabel="met their goal"
        />
        <StatCard
          label="Held in escrow"
          icon={Landmark}
          value={`ETH${metrics.totalEscrowEth.toLocaleString()}`}
          delta="Custody"
          deltaLabel="across active raises"
        />
      </div>

      {/* Chart + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-[#1a2030] rounded-3xl border border-white/5 p-6">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-white">Secondary Marketplace Activity</h2>
            <p className="text-sm text-gray-500">Equity token trading volume across the platform, last 30 days</p>
          </div>
          <MarketplaceTradingChart data={metrics.tradingData ?? []} />
        </div>

        <div className="bg-[#1a2030] rounded-3xl border border-white/5 p-6">
          <h2 className="text-lg font-bold text-white mb-4">Quick actions</h2>
          <div className="space-y-3">
            <QuickAction
              href="/admin-dashboard/kyc-kyb-analytics"
              icon={ShieldCheck}
              title="KYC/KYB Analytics"
              subtitle="Review and analyze user verification data"
            />
            <QuickAction
              href="/admin-dashboard/marketplace"
              icon={ArrowLeftRight}
              title="Marketplace Oversight"
              subtitle="Monitor sell orders and secondary bids"
            />
            <QuickAction
              href="/admin-dashboard/campaigns"
              icon={Scale}
              title="Review Valuations"
              subtitle="Approve campaigns and AI risk scores"
            />
            <QuickAction
              href="/admin-dashboard/audit-log"
              icon={ScrollText}
              title="Activity Log"
              subtitle="Approvals, rejections, deployments"
            />
          </div>
        </div>
      </div>

      {/* Pending campaign review list */}
      <div className="bg-[#1a2030] rounded-3xl border border-white/5 overflow-hidden">
        <div className="p-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Clock className="h-5 w-5 text-[#a78bfa]" /> Pending Campaign Review ({metrics.pendingCampaigns?.length || 0})
          </h2>
          <Link href="/admin-dashboard/audit-log" className="text-sm text-[#a78bfa] hover:underline">
            View all
          </Link>
        </div>
        <div className="divide-y divide-white/5">
          {!metrics.pendingCampaigns || metrics.pendingCampaigns.length === 0 ? (
            <p className="p-6 text-gray-500 text-center">No campaigns awaiting review.</p>
          ) : (
            metrics.pendingCampaigns.map((campaign: any) => (
              <div
                key={campaign.id}
                className="p-6 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center hover:bg-white/[0.02] transition"
              >
                <div>
                  <h3 className="font-semibold text-white">{campaign.title}</h3>
                  <p className="text-xs text-gray-500 font-mono">
                    {campaign.created_at ? new Date(campaign.created_at).toLocaleDateString() : "—"}
                  </p>
                  <div className="mt-2 flex gap-4 text-xs font-mono text-gray-500">
                    <span>Valuation: {campaign.valuation ? `$${Number(campaign.valuation).toLocaleString()}` : "—"}</span>
                    <span>Goal: {campaign.funding_goal ? `$${Number(campaign.funding_goal).toLocaleString()}` : "—"}</span>
                  </div>
                </div>
                <Link
                  href={`/admin-dashboard/audit-log/detail/${campaign.id}?ownerId=${encodeURIComponent(campaign.owner)}`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-gray-300 hover:text-white hover:bg-white/5 text-sm font-semibold transition"
                >
                  View <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}