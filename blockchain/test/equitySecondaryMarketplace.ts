import { expect } from "chai";
import { ethers } from "hardhat";

describe("EquitySecondaryMarketplace", function () {
  async function deployFixture() {
    const [, treasury, seller, buyer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("TestERC20");
    const token = await Token.deploy("Test", "TST");
    const Marketplace = await ethers.getContractFactory("EquitySecondaryMarketplace");
    const marketplace = await Marketplace.deploy(treasury.address);
    const amount = ethers.parseUnits("10", 18);
    const price = ethers.parseEther("0.01");
    await token.mint(seller.address, amount);
    await token.connect(seller).approve(await marketplace.getAddress(), amount);
    return { treasury, seller, buyer, token, marketplace, amount, price };
  }

  it("settles a Supabase-matched trade without escrowing seller tokens", async function () {
    const { treasury, seller, buyer, token, marketplace, amount, price } = await deployFixture();
    const total = (amount * price) / ethers.WeiPerEther;
    const fee = (total * 200n) / 10_000n;
    const tradeId = ethers.id("supabase-trade-uuid");
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    await expect(
      marketplace.connect(buyer).settleTrade(tradeId, await token.getAddress(), seller.address, amount, price, { value: total })
    ).to.emit(marketplace, "TradeSettled");

    expect(await token.balanceOf(buyer.address)).to.equal(amount);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + fee);
  });

  it("rejects a settlement when the seller did not approve the token transfer", async function () {
    const { seller, buyer, token, marketplace, amount, price } = await deployFixture();
    await token.connect(seller).approve(await marketplace.getAddress(), 0);
    const total = (amount * price) / ethers.WeiPerEther;
    await expect(
      marketplace.connect(buyer).settleTrade(ethers.id("unapproved"), await token.getAddress(), seller.address, amount, price, { value: total })
    ).to.be.reverted;
  });

  it("settles an automated auction trade with deadline and emits AuctionTradeSettled", async function () {
    const { treasury, seller, buyer, token, marketplace, amount, price } = await deployFixture();
    const total = (amount * price) / ethers.WeiPerEther;
    const fee = (total * 200n) / 10_000n;
    const tradeId = ethers.id("auction-trade-uuid-1");
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const deadline = Math.floor(Date.now() / 1000);

    await expect(
      marketplace.connect(buyer).settleAuctionTrade(
        tradeId,
        await token.getAddress(),
        seller.address,
        amount,
        price,
        deadline,
        { value: total }
      )
    )
      .to.emit(marketplace, "AuctionTradeSettled")
      .withArgs(tradeId, await token.getAddress(), buyer.address, seller.address, amount, total, fee, deadline)
      .and.to.emit(marketplace, "TradeSettled")
      .withArgs(tradeId, await token.getAddress(), buyer.address, seller.address, amount, total, fee);

    expect(await token.balanceOf(buyer.address)).to.equal(amount);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + fee);
  });
});
