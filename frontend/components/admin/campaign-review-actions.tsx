"use client";

import { useState } from "react";
import { CheckCircle, ExternalLink, Loader2, Pencil, XCircle } from "lucide-react";
import { adminReviewCampaign } from "@/lib/admin/review-campaign";
import { useRouter } from "next/navigation";
import RejectCampaignModal from "@/components/admin/reject-campaign-modal";

export default function CampaignReviewActions({
  campaignId,
  valuation,
  className = "",
}: {
  campaignId: string;
  valuation: number | string | null;
  className?: string;
}) {
  const [adjustedValuation, setAdjustedValuation] = useState(String(valuation ?? ""));
  const [pendingDecision, setPendingDecision] = useState<"approve" | "adjust" | "reject" | null>(null);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleDecision = async (
    decision: "approve" | "adjust" | "reject",
    rejectionReason = "",
    internalNotes = "",
  ) => {
    if (decision === "adjust" && (!adjustedValuation.trim() || Number(adjustedValuation) <= 0)) {
      setError("Enter a valuation greater than zero before adjusting the cap.");
      return;
    }

    setPendingDecision(decision);
    setError("");
    try {
      const result = await adminReviewCampaign(
        campaignId,
        decision,
        adjustedValuation,
        rejectionReason,
        internalNotes,
      );

      if (result.error) {
        setError(result.error);
        return;
      }
      setIsRejectModalOpen(false);
      router.push("/admin-dashboard/audit-log")
      
    } catch (err) {
      console.error("Failed to update campaign review:", err);
      setError("Unable to apply the campaign review decision.");
    } finally {
      setPendingDecision(null);
    }
  };

  return (
    <div className={`flex flex-col gap-2 min-w-56 ${className}`}>
      <a
        href={`/campaigns/${campaignId}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-gray-300 hover:text-white hover:bg-white/5 text-xs font-semibold transition"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        View Details & Documents
      </a>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleDecision("approve")}
          disabled={pendingDecision !== null}
          aria-busy={pendingDecision === "approve"}
          className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 disabled:opacity-50 text-xs font-semibold"
        >
          {pendingDecision === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
          Approve Campaign
        </button>
        <button
          type="button"
          onClick={() => {
            setError("");
            setIsRejectModalOpen(true);
          }}
          disabled={pendingDecision !== null}
          aria-busy={pendingDecision === "reject"}
          className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-50 text-xs font-semibold"
        >
          {pendingDecision === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          Reject Campaign
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          min="0.000001"
          step="any"
          value={adjustedValuation}
          onChange={(event) => setAdjustedValuation(event.target.value)}
          placeholder="New valuation cap"
          aria-label="Adjusted valuation cap"
          className="min-w-0 flex-1 px-2 py-2 rounded-lg bg-[#0d1117] border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-[#6f42c1]"
        />
        <button
          type="button"
          onClick={() => handleDecision("adjust")}
          disabled={pendingDecision !== null}
          aria-busy={pendingDecision === "adjust"}
          className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-[#a78bfa]/10 border border-[#a78bfa]/20 text-[#a78bfa] hover:bg-[#a78bfa]/20 disabled:opacity-50 text-xs font-semibold"
        >
          {pendingDecision === "adjust" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
          Apply Valuation
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <RejectCampaignModal
        key={isRejectModalOpen ? "open" : "closed"}
        open={isRejectModalOpen}
        pending={pendingDecision === "reject"}
        onClose={() => setIsRejectModalOpen(false)}
        onSubmit={(rejectionReason, internalNotes) =>
          handleDecision("reject", rejectionReason, internalNotes)
        }
      />
    </div>
  );
}
