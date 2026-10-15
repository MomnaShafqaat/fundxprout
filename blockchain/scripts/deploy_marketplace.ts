import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contract with account:", deployer.address);

  // Define constructor argument:
  // 1. Fee Treasury Address (receives platform fees)
  const feeTreasuryAddress = process.env.FEE_TREASURY_ADDRESS || "0x23D292f996f8A7d4ED2B3A574f0FebC898DF7b56";

  console.log(`Fee Treasury: ${feeTreasuryAddress}`);

  // Get Contract Factory & Deploy
  const MarketplaceFactory = await ethers.getContractFactory("EquitySecondaryMarketplace");
  const marketplace = await MarketplaceFactory.deploy(feeTreasuryAddress);

  await marketplace.waitForDeployment();

  const contractAddress = await marketplace.getAddress();
  console.log(`✅ EquitySecondaryMarketplace deployed to: ${contractAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});