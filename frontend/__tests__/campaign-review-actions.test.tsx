import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import CampaignReviewActions from "@/components/admin/campaign-review-actions";
import { adminReviewCampaign } from "@/lib/admin/review-campaign";

const push = vi.fn();

vi.mock("@/lib/admin/review-campaign", () => ({
  adminReviewCampaign: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("CampaignReviewActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminReviewCampaign).mockResolvedValue({ success: true });
  });

  test("allows an admin to approve the existing valuation", async () => {
    render(<CampaignReviewActions campaignId="campaign-1" valuation="950000" />);

    fireEvent.click(screen.getByRole("button", { name: /approve campaign/i }));

    await waitFor(() => {
      expect(adminReviewCampaign).toHaveBeenCalledWith(
        "campaign-1",
        "approve",
        "950000",
        "",
        "",
      );
      expect(push).toHaveBeenCalledWith("/admin-dashboard/audit-log");
    });
  });

  test("allows an admin to adjust the valuation cap", async () => {
    render(<CampaignReviewActions campaignId="campaign-1" valuation={950000} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /adjusted valuation cap/i }), {
      target: { value: "875000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply valuation/i }));

    await waitFor(() => {
      expect(adminReviewCampaign).toHaveBeenCalledWith(
        "campaign-1",
        "adjust",
        "875000",
        "",
        "",
      );
      expect(push).toHaveBeenCalledWith("/admin-dashboard/audit-log");
    });
  });

  test("allows an admin to reject a valuation with a reason", async () => {
    render(<CampaignReviewActions campaignId="campaign-1" valuation={950000} />);

    fireEvent.click(screen.getByRole("button", { name: /reject campaign/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /rejection reason/i }), {
      target: { value: "Financial records could not be verified." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Reject campaign$/ }));

    await waitFor(() => {
      expect(adminReviewCampaign).toHaveBeenCalledWith(
        "campaign-1",
        "reject",
        "950000",
        "Financial records could not be verified.",
        "",
      );
      expect(push).toHaveBeenCalledWith("/admin-dashboard/audit-log");
    });
  });
});