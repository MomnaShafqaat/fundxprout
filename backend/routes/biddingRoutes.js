// backend/routes/biddingRoutes.js
// All auction-style bidding endpoints. Mounted at /api/marketplace/
// Does NOT modify any existing marketplaceRoutes.js routes.

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
// shafqaat implemented — Fix P1: Rate limiting middleware on bidding routes
const { biddingActionLimiter } = require('../middleware/rateLimiter');
const {
  placeBid,
  getListingBids,
  acceptBid,
  rejectBid,
  cancelBid,
  getMyBids,
  signListing,
  confirmBid,
  completeBid,
  getKycSignature,
  counterBid,
  acceptCounter,
  rejectCounter,
  // shafqaat implemented — Fix P3: modify bid endpoint
  modifyBid,
} = require('../controllers/biddingController');

const { getCampaignFairPrice } = require('../controllers/fairPriceController');


// ── Buyer routes ──────────────────────────────────────────────────────────────
router.post('/bids', authenticate, biddingActionLimiter, placeBid);                            // Place a bid on a listing
router.get('/bids/my', authenticate, getMyBids);                                              // View all my bids
router.post('/bids/:bidId/modify', authenticate, biddingActionLimiter, modifyBid);             // Increase offer / modify quantity
router.post('/bids/:bidId/cancel', authenticate, biddingActionLimiter, cancelBid);             // Cancel a pending bid
router.post('/bids/:bidId/confirm', authenticate, biddingActionLimiter, confirmBid);           // Confirm accepted bid → get settlement data
router.post('/bids/:bidId/complete', authenticate, biddingActionLimiter, completeBid);         // Mark bid complete after on-chain tx succeeds

// shafqaat implemented — Fix 7: counter-offer buyer response routes
router.post('/bids/:bidId/accept-counter', authenticate, biddingActionLimiter, acceptCounter); // Buyer accepts seller's counter-offer
router.post('/bids/:bidId/reject-counter', authenticate, biddingActionLimiter, rejectCounter); // Buyer rejects seller's counter-offer

// ── Seller routes ─────────────────────────────────────────────────────────────
router.post('/bids/:bidId/accept', authenticate, biddingActionLimiter, acceptBid);             // Seller accepts a bid
router.post('/bids/:bidId/reject', authenticate, biddingActionLimiter, rejectBid);             // Seller rejects a bid

// shafqaat implemented — Fix 7: counter-offer seller route
router.post('/bids/:bidId/counter', authenticate, biddingActionLimiter, counterBid);           // Seller sends counter-offer to buyer

// ── KYC signature — REQUIRED for on-chain fillOrder() settlement ─────────────
router.post('/kyc-signature', authenticate, biddingActionLimiter, getKycSignature);            // Backend signs KYC ticket for fillOrder()

// ── Seller listing routes ─────────────────────────────────────────────────────
router.get('/listings/:listingId/bids', authenticate, getListingBids);                         // View all bids on a listing
router.post('/listings/:listingId/accept-bid/:bidId', authenticate, biddingActionLimiter, acceptBid); // Accept via full path
router.post('/listings/:listingId/sign', authenticate, biddingActionLimiter, signListing);     // Store EIP-712 seller signature

// ── AI Fair Price ─────────────────────────────────────────────────────────────
// GET /api/marketplace/campaigns/:campaignId/fair-price?listingPrice=0.15&refresh=true
// Public — no auth required (the data is used for UI guidance, not trading actions)
router.get('/campaigns/:campaignId/fair-price', getCampaignFairPrice);

module.exports = router;
