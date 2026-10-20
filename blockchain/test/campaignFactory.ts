// blockchain/test/campaignFactory.ts
// This test suite verifies the functionality of the CampaignFactory contract. It checks that users can create new campaigns with the specified parameters and that the deployed campaign addresses are correctly stored in the factory's state. The tests are written using Mocha and Chai, and they run in a Hardhat environment with Ethers.js for contract interaction.
import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";

describe("CampaignFactory", function () {
  let factory: Contract;

  // Test Parameters
  const name = "Test Startup";
  const symbol = "TST";
  const fundingGoal = ethers.parseEther("10"); // 10 ETH
  const deadlineTimestamp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const pricePerToken = ethers.parseEther("0.01"); // 0.01 ETH

  beforeEach(async function () {
    // 1. Get the Contract Factory
    const Factory = await ethers.getContractFactory("CampaignFactory");
    
    // 2. Deploy the Factory
    // Add 'as unknown as Contract' at the end
    factory = (await Factory.deploy()) as unknown as Contract;
    
    // 3. Wait for deployment (Ethers v6 syntax)
    await factory.waitForDeployment();
  });

  it("Should allow a user to create a new campaign", async function () {
    // 1. Call the create function
    const tx = await factory.createCampaign(
      name,
      symbol,
      fundingGoal,
      deadlineTimestamp,
      pricePerToken
    );
    
    // 2. Wait for the transaction to be mined
    await tx.wait();

    // 3. Check if the campaign address was stored
    // In Solidity, arrays are accessed like functions: deployedCampaigns(index)
    const campaignAddress = await factory.deployedCampaigns(0);

    // 4. Validate results
    console.log("New Campaign deployed at:", campaignAddress);
    
    expect(campaignAddress).to.not.be.undefined;
    expect(campaignAddress).to.not.equal(ethers.ZeroAddress);
  });
});