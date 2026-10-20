import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const EquitySecondaryMarketplaceModule = buildModule("EquitySecondaryMarketplaceModule", (m) => {
  const feeTreasury = process.env.FEE_TREASURY_ADDRESS || "0x23D292f996f8A7d4ED2B3A574f0FebC898DF7b56";

  if (!feeTreasury) {
    throw new Error("Environment variable FEE_TREASURY_ADDRESS must be set.");
  }

  const marketplace = m.contract("EquitySecondaryMarketplace", [feeTreasury]);

  return { marketplace };
});

export default EquitySecondaryMarketplaceModule;
