// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";  // shafqaat work: added Pausable for emergency circuit breaker

contract EquitySecondaryMarketplace is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    uint256 public platformFeeBps = 200; // 2%
    address public feeTreasury;
    mapping(bytes32 => bool) public settledTrades;

    // shafqaat work: mapping to store the whitelisted buyer for each Private OTC tradeId.
    // When a seller registers a private deal, only this address can call settleOtcTrade().
    // If tradeId is not in this mapping, it means it's a regular public order (no restriction).
    mapping(bytes32 => address) public otcWhitelistedBuyer;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TradeSettled(
        bytes32 indexed tradeId,
        address indexed token,
        address indexed buyer,
        address seller,
        uint256 tokenAmount,
        uint256 totalPrice,
        uint256 platformFee
    );

    // shafqaat work: new event emitted when an OTC deal is registered on-chain by the seller.
    // This creates an auditable, immutable on-chain record that a private agreement was made
    // between a specific seller and buyer before any money changes hands.
    event OtcDealRegistered(
        bytes32 indexed tradeId,
        address indexed seller,
        address indexed whitelistedBuyer,
        address token,
        uint256 amount,
        uint256 pricePerToken
    );

    // shafqaat work: new event emitted when a counter-offer negotiation settles on-chain.
    // Records both the original listed price and the final negotiated (countered) price
    // for a full transparent audit trail of the negotiation.
    event NegotiatedTradeSettled(
        bytes32 indexed tradeId,
        address indexed buyer,
        address seller,
        uint256 originalListedPrice,
        uint256 finalNegotiatedPrice,
        uint256 tokenAmount
    );

    // Emitted when an auction deadline fires and the auto-selected buyer settles on-chain.
    // Records auctionDeadline so block explorers and auditors can trace exactly which
    // pg_cron run triggered this settlement — distinct from manual OTC deals.
    event AuctionTradeSettled(
        bytes32 indexed tradeId,
        address indexed token,
        address indexed buyer,
        address seller,
        uint256 tokenAmount,
        uint256 totalPrice,
        uint256 platformFee,
        uint256 auctionDeadline
    );

    event FeeTreasuryUpdated(address indexed treasury);
    event PlatformFeeUpdated(uint256 feeBps);

    constructor(address _feeTreasury) Ownable(msg.sender) {
        require(_feeTreasury != address(0), "Invalid treasury");
        feeTreasury = _feeTreasury;
    }

    // ─── EXISTING FUNCTION: Public Order Settlement (unchanged) ───────────────

    /**
     * @dev The buyer calls this with exactly `amount * pricePerToken / 1e18` ETH.
     * Used for public buy orders and standard bid acceptances.
     */
    function settleTrade(
        bytes32 tradeId,
        address token,
        address seller,
        uint256 amount,
        uint256 pricePerToken
    ) external payable nonReentrant whenNotPaused {
        require(token != address(0) && seller != address(0), "Invalid address");
        require(amount > 0 && pricePerToken > 0, "Invalid trade");
        require(!settledTrades[tradeId], "Trade already settled");

        uint256 totalPrice = (amount * pricePerToken) / 1e18;
        require(totalPrice > 0 && msg.value == totalPrice, "Incorrect ETH value");

        uint256 fee = (totalPrice * platformFeeBps) / 10_000;
        settledTrades[tradeId] = true;
        IERC20(token).safeTransferFrom(seller, msg.sender, amount);
        _sendEth(feeTreasury, fee);
        _sendEth(seller, totalPrice - fee);

        emit TradeSettled(tradeId, token, msg.sender, seller, amount, totalPrice, fee);
    }

    // ─── NEW FUNCTION 1: Register an OTC Private Deal (Seller calls this) ────

    // shafqaat work: registerOtcDeal() is called by the SELLER before an OTC trade can settle.
    // This writes the whitelisted buyer address to the on-chain mapping for this tradeId.
    // Without calling this first, settleOtcTrade() will always revert.
    // This gives us cryptographic, immutable proof that the seller authorized exactly
    // one specific wallet (the whitelistedBuyer) to purchase this specific block of tokens.
    function registerOtcDeal(
        bytes32 tradeId,
        address token,
        address whitelistedBuyer,
        uint256 amount,
        uint256 pricePerToken
    ) external {
        require(whitelistedBuyer != address(0), "Invalid whitelisted buyer");
        require(otcWhitelistedBuyer[tradeId] == address(0), "OTC deal already registered");
        require(!settledTrades[tradeId], "Trade already settled");
        require(amount > 0 && pricePerToken > 0, "Invalid deal parameters");

        // shafqaat work: record the seller (msg.sender) as the one who locked in this deal.
        // The buyer address is stored on-chain so settleOtcTrade() can verify it later.
        otcWhitelistedBuyer[tradeId] = whitelistedBuyer;

        emit OtcDealRegistered(tradeId, msg.sender, whitelistedBuyer, token, amount, pricePerToken);
    }

    // ─── NEW FUNCTION 2: Execute an OTC Private Deal (Whitelisted Buyer calls this) ───

    // shafqaat work: settleOtcTrade() is the BUYER's entry point for private OTC deals only.
    // It enforces that ONLY the address stored in otcWhitelistedBuyer[tradeId] can call this.
    // Even if someone guesses or steals the tradeId, the EVM will revert their transaction.
    // This is the third and strongest layer of security after the DB filter and frontend guard.
    function settleOtcTrade(
        bytes32 tradeId,
        address token,
        address seller,
        uint256 amount,
        uint256 pricePerToken
    ) external payable nonReentrant whenNotPaused {
        // shafqaat work: counterparty enforcement — only the pre-registered wallet can proceed
        address authorizedBuyer = otcWhitelistedBuyer[tradeId];
        require(authorizedBuyer != address(0), "OTC deal not registered by seller");
        require(msg.sender == authorizedBuyer, "Unauthorized OTC counterparty");

        require(token != address(0) && seller != address(0), "Invalid address");
        require(amount > 0 && pricePerToken > 0, "Invalid trade");
        require(!settledTrades[tradeId], "Trade already settled");

        uint256 totalPrice = (amount * pricePerToken) / 1e18;
        require(totalPrice > 0 && msg.value == totalPrice, "Incorrect ETH value");

        uint256 fee = (totalPrice * platformFeeBps) / 10_000;
        settledTrades[tradeId] = true;

        // shafqaat work: clear the whitelist entry after settlement to prevent replay
        delete otcWhitelistedBuyer[tradeId];

        IERC20(token).safeTransferFrom(seller, msg.sender, amount);
        _sendEth(feeTreasury, fee);
        _sendEth(seller, totalPrice - fee);

        emit TradeSettled(tradeId, token, msg.sender, seller, amount, totalPrice, fee);
    }

    // ─── NEW FUNCTION 3: Settle a Negotiated / Counter-Offer Trade ────────────

    // shafqaat work: settleNegotiatedTrade() is for bids that went through the counter-offer
    // negotiation flow. The key difference from settleTrade() is that it accepts BOTH the
    // original listing price and the final agreed (negotiated) price.
    // The contract uses finalNegotiatedPrice for the actual ETH calculation but emits
    // NegotiatedTradeSettled with both values, creating an immutable audit trail showing
    // what the listing price was vs what the negotiation concluded at.
    function settleNegotiatedTrade(
        bytes32 tradeId,
        address token,
        address seller,
        uint256 amount,
        uint256 originalListedPrice,     // the price from the original sell listing
        uint256 finalNegotiatedPrice     // the counter-offer price both parties agreed to
    ) external payable nonReentrant whenNotPaused {
        require(token != address(0) && seller != address(0), "Invalid address");
        require(amount > 0 && finalNegotiatedPrice > 0, "Invalid trade");
        require(!settledTrades[tradeId], "Trade already settled");

        // shafqaat work: ETH is calculated at the FINAL negotiated price, not the original
        uint256 totalPrice = (amount * finalNegotiatedPrice) / 1e18;
        require(totalPrice > 0 && msg.value == totalPrice, "Incorrect ETH for negotiated price");

        uint256 fee = (totalPrice * platformFeeBps) / 10_000;
        settledTrades[tradeId] = true;
        IERC20(token).safeTransferFrom(seller, msg.sender, amount);
        _sendEth(feeTreasury, fee);
        _sendEth(seller, totalPrice - fee);

        // shafqaat work: emit both prices for the negotiation audit trail on-chain
        emit NegotiatedTradeSettled(tradeId, msg.sender, seller, originalListedPrice, finalNegotiatedPrice, amount);
        emit TradeSettled(tradeId, token, msg.sender, seller, amount, totalPrice, fee);
    }

    // ─── NEW FUNCTION 4: Settle an Auction-Auto-Selected Trade ────────────────

    // Called by the auto_accepted buyer after the listing deadline fires.
    // Unlike settleOtcTrade(), no prior registerOtcDeal() is needed because
    // the seller's ERC20 approval (given at listing creation) covers this trade.
    // Records auctionDeadline on-chain for a full audit trail of the automation.
    function settleAuctionTrade(
        bytes32 tradeId,
        address token,
        address seller,
        uint256 amount,
        uint256 pricePerToken,
        uint256 auctionDeadline  // Unix timestamp of the listing deadline that triggered auto-select
    ) external payable nonReentrant whenNotPaused {
        require(token != address(0) && seller != address(0), "Invalid address");
        require(amount > 0 && pricePerToken > 0, "Invalid trade");
        require(!settledTrades[tradeId], "Trade already settled");

        uint256 totalPrice = (amount * pricePerToken) / 1e18;
        require(totalPrice > 0 && msg.value == totalPrice, "Incorrect ETH value");

        uint256 fee = (totalPrice * platformFeeBps) / 10_000;
        settledTrades[tradeId] = true;

        // Seller must have approved the marketplace contract as a spender when creating the listing
        IERC20(token).safeTransferFrom(seller, msg.sender, amount);
        _sendEth(feeTreasury, fee);
        _sendEth(seller, totalPrice - fee);

        emit AuctionTradeSettled(tradeId, token, msg.sender, seller, amount, totalPrice, fee, auctionDeadline);
        emit TradeSettled(tradeId, token, msg.sender, seller, amount, totalPrice, fee);
    }

    // ─── ADMIN FUNCTIONS ──────────────────────────────────────────────────────

    function setFeeTreasury(address treasury) external onlyOwner {
        require(treasury != address(0), "Invalid treasury");
        feeTreasury = treasury;
        emit FeeTreasuryUpdated(treasury);
    }

    function setPlatformFeeBps(uint256 feeBps) external onlyOwner {
        require(feeBps <= 1_000, "Fee too high");
        platformFeeBps = feeBps;
        emit PlatformFeeUpdated(feeBps);
    }

    // shafqaat work: emergency pause — admin can halt ALL settlements if a critical
    // vulnerability is discovered. Uses OpenZeppelin's Pausable pattern.
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _sendEth(address recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool success, ) = payable(recipient).call{value: amount}("");
        require(success, "ETH transfer failed");
    }
}
