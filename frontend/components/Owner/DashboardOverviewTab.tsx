"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Plus, Target, DollarSign, Eye, Edit2 } from "lucide-react";
import { ethers } from "ethers";
import BusinessCampaignJSON from "@/abis/BusinessCampaign.json";
import CampaignReviewInfo from "@/components/campaign-review-info";

export interface CampaignItem {
  id: string | number;
  title: string;
  category?: string | null;
  status: string;
  funding_goal?: string | number | null;
  amount_pledged?: string | number | null;
  investor_count?: number | string | null;
  price_per_token?: string | number | null;
  created_at: string;
  duration?: number | null;
  contract_address?: string | null;
  transaction_hash?: string | null;
  valuation?: string | number | null;
  equity_offered?: string | number | null;
  equity_retained?: string | number | null;
  campaign_review?: any;
}

interface DashboardOverviewTabProps {
  campaigns?: CampaignItem[];
  loading?: boolean;
}

function calcDaysLeft(createdAt: string, durationDays?: number | null): number {
  const deadline = new Date(
    new Date(createdAt).getTime() + (durationDays ?? 30) * 24 * 60 * 60 * 1000
  );
  const diff = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function getStatusStyle(status?: string): { bg: string; text: string; label: string } {
  const statusMap: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "Draft" },
    in_review: { bg: "bg-blue-500/20", text: "text-blue-400", label: "In Review" },
    approved: { bg: "bg-green-500/20", text: "text-green-400", label: "Approved" },
    launched: { bg: "bg-[#28a745]/20", text: "text-[#28a745]", label: "Launched" },
    ended: { bg: "bg-gray-500/20", text: "text-gray-400", label: "Ended" },
    successful: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Successful" },
    failed: { bg: "bg-rose-500/20", text: "text-rose-400", label: "Failed" },
    rejected: { bg: "bg-red-500/20", text: "text-red-500", label: "Rejected" },
  };

  return (
    statusMap[status?.toLowerCase() ?? ""] || {
      bg: "bg-white/10",
      text: "text-gray-400",
      label: status || "Unknown",
    }
  );
}

function buildDraftEditHref(campaign: CampaignItem): string {
  return `/create-campaign?campaignId=${encodeURIComponent(String(campaign.id ?? ""))}`;
}

export default function DashboardOverviewTab({
  campaigns = [],
  loading = false,
}: DashboardOverviewTabProps) {
  const [txPending, setTxPending] = useState<string | null>(null);

  async function handleWithdrawFunds(contractAddress?: string | null) {
    if (!contractAddress) return;
    if (typeof window === "undefined" || !(window as any).ethereum) {
      alert("Please install MetaMask!");
      return;
    }

    try {
      setTxPending(contractAddress);
      await (window as any).ethereum.request({ method: "eth_requestAccounts" });
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();

      const campaignContract = new ethers.Contract(
        contractAddress,
        BusinessCampaignJSON.abi,
        signer
      );

      const tx = await campaignContract.withdrawFunds();
      alert(`Withdrawal transaction submitted! Hash: ${tx.hash}`);

      await tx.wait();
      alert("Funds successfully withdrawn to your wallet!");
      window.location.reload();
    } catch (err: any) {
      console.error("Withdrawal error:", err);
      alert(err.reason || err.message || "Withdrawal failed");
    } finally {
      setTxPending(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">Campaign Overview</h2>
        <Link
          href="/create-campaign"
          className="w-full sm:w-fit bg-[#6f42c1] hover:bg-[#5a3599] text-white px-4 py-2.5 rounded-full font-semibold transition duration-200 inline-flex items-center justify-center gap-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          New Campaign
        </Link>
      </div>

      {loading && (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      )}

      {!loading && campaigns.length === 0 && (
        <div className="text-center py-16">
          <Target className="h-10 w-10 text-[#6f42c1]/30 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            You haven't created any campaigns yet.
          </p>
          <Link
            href="/create-campaign"
            className="mt-3 inline-block text-[#a78bfa] text-sm hover:underline"
          >
            Create your first campaign →
          </Link>
        </div>
      )}

      <div className="space-y-4">
        {!loading &&
          campaigns.map((campaign) => {
            const daysLeft = calcDaysLeft(campaign.created_at, campaign.duration);
            const goal = parseFloat(String(campaign.funding_goal ?? "0"));
            const pledged = parseFloat(String(campaign.amount_pledged ?? "0"));
            const statusStyle = getStatusStyle(campaign.status);
            const isGoalReached = pledged >= goal;
            const statusLower = campaign.status?.toLowerCase() ?? "";

            const shouldShowValuationAndEquity = ![
              "draft",
              "in_review",
              "rejected",
            ].includes(statusLower);

            const offeredPct =
              campaign.equity_offered !== undefined && campaign.equity_offered !== null
                ? parseFloat(String(campaign.equity_offered))
                : 0;

            const retainedPct =
              campaign.equity_retained !== undefined && campaign.equity_retained !== null
                ? parseFloat(String(campaign.equity_retained))
                : 100 - offeredPct;

            const metrics: Array<{
              label: string;
              value: string | number;
              accent: boolean;
            }> = [
              {
                label: "Goal",
                value: `${goal.toFixed(3)} ETH`,
                accent: false,
              },
              {
                label: "Amount Pledged",
                value: `${pledged.toFixed(3)} ETH`,
                accent: false,
              },
              {
                label: "Investors",
                value: Number(campaign.investor_count ?? 0),
                accent: false,
              },
              {
                label: "Category",
                value: campaign.category ?? "—",
                accent: false,
              },
              {
                label: "Days Left",
                value: daysLeft > 0 ? `${daysLeft}d` : "Ended",
                accent: false,
              },
              {
                label: "Price/Token",
                value: `${parseFloat(String(campaign.price_per_token ?? "0")).toFixed(6)} ETH`,
                accent: true,
              },
            ];

            if (shouldShowValuationAndEquity) {
              const valuationVal = parseFloat(String(campaign.valuation ?? "0"));
              metrics.push(
                {
                  label: "Approved Valuation",
                  value: `${valuationVal.toFixed(3)} ETH`,
                  accent: true,
                },
                {
                  label: "Equity Offered / Retained",
                  value: `${offeredPct.toFixed(2)}% / ${retainedPct.toFixed(2)}%`,
                  accent: true,
                }
              );
            }

            return (
              <div
                key={campaign.id}
                className="bg-[#0d1117] rounded-2xl p-6 border border-white/5"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-white">
                    {campaign.title}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyle.bg} ${statusStyle.text}`}
                    >
                      {statusStyle.label}
                    </span>
                    <CampaignReviewInfo review={campaign.campaign_review} />
                  </div>
                </div>

                {/* Fixed: Exactly 2 columns on mobile and 4 columns on md+ screens */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  {metrics.map((item) => (
                    <div key={item.label}>
                      <p className="text-xs text-gray-400 mb-1">{item.label}</p>
                      <p
                        className={`font-bold text-sm capitalize ${
                          item.accent ? "text-[#a78bfa]" : "text-white"
                        }`}
                      >
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="w-full bg-white/10 rounded-full h-1.5 mb-4">
                  <div
                    className="bg-[#6f42c1] h-1.5 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        goal > 0 ? (pledged / goal) * 100 : 0
                      )}%`,
                    }}
                  />
                </div>

                <div className="flex items-center gap-3">
                  {campaign.status === "ended" && isGoalReached && campaign.contract_address && (
                    <button
                      onClick={() => handleWithdrawFunds(campaign.contract_address)}
                      disabled={txPending === campaign.contract_address}
                      className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-4 py-2 rounded-full transition flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <DollarSign className="h-3.5 w-3.5" />
                      {txPending === campaign.contract_address
                        ? "Withdrawing..."
                        : "Withdraw Funds"}
                    </button>
                  )}

                  {["draft", "approved", "adjusted"].includes(statusLower) && (
                    <Link
                      href={buildDraftEditHref(campaign)}
                      className="flex items-center gap-1.5 text-yellow-400 hover:text-yellow-300 text-xs font-medium transition-colors"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      {["approved", "adjusted"].includes(statusLower)
                        ? "Launch"
                        : "Edit"}
                    </Link>
                  )}

                  <Link
                    href={`/campaigns/${campaign.id}`}
                    className="flex items-center gap-1.5 text-[#a78bfa] hover:text-white text-xs font-medium transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View Public Page
                  </Link>

                  {campaign.transaction_hash && (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${campaign.transaction_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs font-medium transition-colors"
                    >
                      View on Etherscan
                    </a>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}