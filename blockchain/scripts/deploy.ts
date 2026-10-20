import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=====================================");
  console.log("🔍 DEBUG INFO");
  console.log("Deployer account:", deployer.address);

  const network = await ethers.provider.getNetwork();
  console.log("Chain ID:", network.chainId);
  console.log("=====================================\n");

  // 1. Deploy CampaignFactory
  console.log("Deploying CampaignFactory...");
  const CampaignFactory = await ethers.getContractFactory("CampaignFactory");
  const campaignFactory = await CampaignFactory.deploy();
  await campaignFactory.waitForDeployment();

  const factoryAddress = await campaignFactory.getAddress();
  console.log("✅ CampaignFactory deployed to:", factoryAddress);

  // 2. Prepare Parameters for a Campaign
  const name = "TechNova";
  const symbol = "TNV";
  const fundingGoal = ethers.parseEther("5"); // 5 ETH goal
  
  // Set deadline: e.g., 6 hours from current execution time
  const durationInSeconds = 6 * 3600;
  const deadlineTimestamp = Math.floor(Date.now() / 1000) + durationInSeconds;
  
  const pricePerToken = ethers.parseEther("0.001"); // 0.001 ETH per token

  // 3. Create the Campaign via Factory
  console.log("\nDeploying BusinessCampaign & EquityToken via Factory...");
  const tx = await campaignFactory.createCampaign(
    name,
    symbol,
    fundingGoal,
    deadlineTimestamp,
    pricePerToken
  );

  const receipt = await tx.wait();

  // 4. Extract CampaignCreated event details from the transaction receipt
  const event = receipt?.logs
    .map((log: any) => {
      try {
        return campaignFactory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsedLog: any) => parsedLog && parsedLog.name === "CampaignCreated");

  if (event) {
    const { campaignAddress, tokenAddress, owner } = event.args;
    console.log("=====================================");
    console.log("🎉 DEPLOYMENT SUCCESSFUL");
    console.log("Campaign Address :", campaignAddress);
    console.log("Token Address    :", tokenAddress);
    console.log("Campaign Owner   :", owner);
    console.log("Deadline (Unix)  :", deadlineTimestamp);
    console.log("Deadline (Date)  :", new Date(deadlineTimestamp * 1000).toLocaleString());
    console.log("=====================================");
  } else {
    // Fallback reading directly from array getter
    const campaignAddress = await campaignFactory.deployedCampaigns(0);
    console.log("Deployed Campaign Address:", campaignAddress);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});