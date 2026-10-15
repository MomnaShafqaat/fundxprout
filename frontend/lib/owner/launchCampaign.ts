// Inside your client component (marked with 'use client')
'use client';

import { ethers } from "ethers";
import CampaignFactoryJSON from "@/abis/CampaignFactory.json";
import { verifyCampaignForLaunch, finalizeCampaignLaunch } from "@/lib/action";

const CONTRACT_ADDRESS = "0x600259B2D79720FCd98632641C3a6951d03fb500";

export async function handleLaunchSubmit(prevState: any, formData: FormData) {
  const campaignId = formData.get("campaign_id") as string;
  const goal = formData.get("goal") as string;
  const tokenSymbol = formData.get("tokenSymbol") as string;
  const title = formData.get("title") as string;
  const pricePerToken = formData.get("pricePerToken") as string;
  const deadlineTimestamp = Number(formData.get("deadline_timestamp"));

  // 1. Verify with backend first
  const verification = await verifyCampaignForLaunch(campaignId);
  if (verification.error) {
    alert(verification.error);
    return;
  }

  // 2. Check MetaMask in browser
  if (typeof window === "undefined" || !(window as any).ethereum) {
    alert("Please install MetaMask!");
    return;
  }

  try {
    const ethereum = (window as any).ethereum;
    await ethereum.request({ method: "eth_requestAccounts" });
    const provider = new ethers.BrowserProvider(ethereum);
    const signer = await provider.getSigner();

    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(11155111)) {
      alert("Please switch MetaMask to the Sepolia Testnet!");
      return;
    }

    const goalInWei = ethers.parseEther(goal);
    const priceInWei = ethers.parseEther(pricePerToken);

    // 3. Prompt MetaMask Signature
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CampaignFactoryJSON.abi, signer);
    const tx = await contract.createCampaign(
      title,
      tokenSymbol,
      goalInWei,
      deadlineTimestamp,
      priceInWei,
      { gasLimit: 3000000 }
    );

    const receipt = await tx.wait();

    // 4. Parse CampaignCreated event
    const iface = new ethers.Interface(CampaignFactoryJSON.abi);
    let campaignContractAddress = "";
    let tokenContractAddress = "";

    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "CampaignCreated") {
          campaignContractAddress = parsed.args.campaignAddress;
          tokenContractAddress = parsed.args.tokenAddress;
          break;
        }
      } catch {}
    }

    // 5. Send results back to the server to update database
    await finalizeCampaignLaunch({
      campaignId,
      txHash: receipt.hash,
      contractAddress: campaignContractAddress,
      tokenContractAddress,
      // Metadata from the form:
      title: formData.get("title") as string,
      description: formData.get("description") as string,
      category: formData.get("category") as string,
      goal: formData.get("goal") as string,
      tokenSymbol: formData.get("tokenSymbol") as string,
      pricePerToken: formData.get("pricePerToken") as string,
      imageUrl: formData.get("imageUrl") as string,
      // Accurate UTC ISO deadline:
      deadline: deadlineTimestamp 
        ? new Date(deadlineTimestamp * 1000).toISOString() 
        : undefined,
      duration: deadlineTimestamp 
        ? Math.max(1, Math.ceil((deadlineTimestamp - Math.floor(Date.now() / 1000)) / 86400)) 
        : undefined,
    });

    alert("Campaign launched successfully!");
  } catch (err: any) {
    console.error(err);
    alert(err.message || "Transaction rejected or failed");
  }
}