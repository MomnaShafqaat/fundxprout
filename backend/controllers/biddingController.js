// backend/controllers/biddingController.js
// Handles the auction-style bidding system for the secondary marketplace.
// Buyers post bids on sell listings; sellers review and accept; winning buyer
// calls fillOrder() on-chain.

const { supabaseAdmin } = require('../config/supabaseAdmin');
const { ethers } = require('ethers');
const { createNotification } = require('../services/notificationService');

// ─────────────────────────────────────────────────────────────────────────────
// shafqaat implemented — Fix 4: On-chain transaction verification helper.
// verifyOnChainTx() is called inside completeBid() BEFORE writing to the DB.
// Validates:
// 1. Valid 66-character hex hash format
// 2. Hash has never been used for any other trade (replay protection)
// 3. Receipt exists and is mined (status === 1)
// 4. Sender (from) matches the buyer's registered wallet
// 5. Destination (to) matches the secondary marketplace contract
// ─────────────────────────────────────────────────────────────────────────────
async function verifyOnChainTx(txHash, expectedBuyerWallet, currentBidId) {
  if (!txHash || typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error('Invalid Ethereum transaction hash format. Expected a 0x-prefixed 64-character hex string.');
  }

  // 1. Replay protection: Check if this tx_hash has already been used on any other bid
  if (currentBidId) {
    const { data: existingBid } = await supabaseAdmin
      .from('token_bids')
      .select('id')
      .eq('tx_hash', txHash)
      .neq('id', currentBidId)
      .maybeSingle();

    if (existingBid) {
      throw new Error('This transaction hash has already been used for another settled trade (replay attack rejected).');
    }
  }

  // 2. RPC provider resolution
  const rpcUrl = process.env.ETH_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';

  let receipt;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    receipt = await provider.getTransactionReceipt(txHash);
  } catch (rpcErr) {
    throw new Error(
      `Could not reach the Ethereum RPC (${rpcUrl}) to verify the transaction: ${rpcErr.message}`
    );
  }

  // 3. Verification checks
  if (!receipt) {
    throw new Error(
      'Transaction not found on-chain. It may still be pending in the mempool — please wait a few seconds and try again.'
    );
  }
  if (receipt.status !== 1) {
    throw new Error(
      'Transaction failed on-chain (status = 0 / reverted). The trade was not settled. ' +
      'Check the transaction on Etherscan for the revert reason.'
    );
  }
  if (receipt.from.toLowerCase() !== expectedBuyerWallet.toLowerCase()) {
    throw new Error(
      `Transaction sender (${receipt.from.slice(0, 8)}…) does not match your registered buyer wallet (${expectedBuyerWallet.slice(0, 8)}…). Only the bid owner can settle this trade.`
    );
  }

  // 4. Contract destination check
  const marketplaceAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS;
  if (marketplaceAddress && receipt.to) {
    if (receipt.to.toLowerCase() !== marketplaceAddress.toLowerCase()) {
      throw new Error(
        `Transaction destination (${receipt.to}) does not match the secondary marketplace contract (${marketplaceAddress}).`
      );
    }
  }
}

// ─────────────────────────────────────────────
// POST /api/marketplace/bids
// Buyer places a bid on an open sell listing
// ─────────────────────────────────────────────
async function placeBid(req, res) {
  const buyerId = req.user?.id;
  const { listing_id, bid_price_per_token, quantity, buyer_wallet, bid_expires_days = 7 } = req.body;

  if (!listing_id || !bid_price_per_token || !quantity || !buyer_wallet) {
    return res.status(400).json({ error: 'listing_id, bid_price_per_token, quantity, and buyer_wallet are required' });
  }

  if (!ethers.isAddress(buyer_wallet)) {
    return res.status(400).json({ error: 'Invalid buyer_wallet address' });
  }

  if (Number(bid_price_per_token) <= 0 || Number(quantity) <= 0) {
    return res.status(400).json({ error: 'bid_price_per_token and quantity must be positive numbers' });
  }

  try {
    // 1. Verify the listing exists, is a sell order, and is still open
    const { data: listing, error: listingErr } = await supabaseAdmin
      .from('token_orders')
      .select('id, campaign_id, investor_id, side, status, quantity_remaining, price, auto_accept_price_per_token, listing_mode, listing_deadline, min_bid_price_per_token')
      .eq('id', listing_id)
      .single();

    if (listingErr || !listing) {
      return res.status(404).json({ error: 'Sell listing not found' });
    }
    if (listing.side !== 'sell') {
      return res.status(400).json({ error: 'You can only bid on sell listings' });
    }
    if (!['open', 'partially_filled'].includes(listing.status)) {
      return res.status(400).json({ error: 'This listing is no longer active' });
    }
    if (Number(quantity) > Number(listing.quantity_remaining)) {
      return res.status(400).json({
        error: `Requested quantity ${quantity} exceeds available ${listing.quantity_remaining} tokens`,
      });
    }

    // 2. Buyer cannot bid on their own listing
    if (listing.investor_id === buyerId) {
      return res.status(400).json({ error: 'You cannot bid on your own listing' });
    }

    // 3. Verify buyer is KYC verified
    const { data: buyerProfile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('identity_verified, profile_complete, trading_restricted')
      .eq('user_id', buyerId)
      .single();

    if (profileErr || !buyerProfile) {
      return res.status(404).json({ error: 'Buyer profile not found' });
    }
    if (!buyerProfile.identity_verified) {
      return res.status(403).json({ error: 'Identity verification (KYC) required before placing bids' });
    }
    if (!buyerProfile.profile_complete) {
      return res.status(403).json({ error: 'Complete your profile before placing bids' });
    }
    if (buyerProfile.trading_restricted) {
      return res.status(403).json({ error: 'Your account is restricted from trading' });
    }

    // Validate minimum bid price floor (auto-mode listings may have a floor price)
    if (listing.min_bid_price_per_token && Number(bid_price_per_token) < Number(listing.min_bid_price_per_token)) {
      return res.status(400).json({
        error: `Your bid of ${bid_price_per_token} ETH/token is below the seller's minimum bid price of ${listing.min_bid_price_per_token} ETH/token`,
      });
    }

    // For auto-mode listings, check if deadline has already passed
    const isAutoMode = listing.listing_mode === 'auto';
    if (isAutoMode && listing.listing_deadline && new Date(listing.listing_deadline) < new Date()) {
      return res.status(400).json({ error: 'This auction has ended. No more bids are being accepted.' });
    }

    // 4. Calculate bid expiry:
    //    - auto mode: bid window = listing_deadline (buyers can only bid before deadline)
    //    - manual mode: buyer-specified days from now
    const bidExpiresAt = isAutoMode && listing.listing_deadline
      ? new Date(listing.listing_deadline)
      : (() => { const d = new Date(); d.setDate(d.getDate() + Number(bid_expires_days)); return d; })();

    // shafqaat implemented — Fix P3: Auto-accept threshold check
    const isAutoAccepted = Boolean(
      listing.auto_accept_price_per_token &&
      Number(bid_price_per_token) >= Number(listing.auto_accept_price_per_token)
    );

    let acceptDeadline = null;
    if (isAutoAccepted) {
      acceptDeadline = new Date();
      acceptDeadline.setHours(acceptDeadline.getHours() + 24);
    }

    // 5. Insert the bid
    const { data: bid, error: insertErr } = await supabaseAdmin
      .from('token_bids')
      .insert([{
        listing_id,
        campaign_id: listing.campaign_id,
        buyer_id: buyerId,
        buyer_wallet: buyer_wallet.toLowerCase(),
        bid_price_per_token: Number(bid_price_per_token),
        quantity: Number(quantity),
        status: isAutoAccepted ? 'accepted' : 'pending',
        accept_deadline: acceptDeadline ? acceptDeadline.toISOString() : null,
        bid_expires_at: bidExpiresAt instanceof Date ? bidExpiresAt.toISOString() : bidExpiresAt,
      }])
      .select()
      .single();

    if (insertErr) throw insertErr;

    const { data: campaign } = await supabaseAdmin
      .from('campaigns').select('title').eq('id', listing.campaign_id).single();
    const campaignTitle = campaign?.title || 'a listing';

    // If auto-accepted, auto-cancel other pending bids and notify both parties
    if (isAutoAccepted) {
      const { data: competingBids } = await supabaseAdmin
        .from('token_bids')
        .select('id, buyer_id')
        .eq('listing_id', listing_id)
        .eq('status', 'pending')
        .neq('id', bid.id);

      await supabaseAdmin
        .from('token_bids')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('listing_id', listing_id)
        .eq('status', 'pending')
        .neq('id', bid.id);

      if (competingBids && competingBids.length > 0) {
        await Promise.all(
          competingBids.map((cb) =>
            createNotification({
              userId: cb.buyer_id,
              type: 'bid_cancelled',
              title: 'Bid Cancelled',
              message: `Another offer on "${campaignTitle}" was accepted. Your pending bid has been cancelled.`,
              link: '/investor-dashboard/my-bids',
              metadata: { bid_id: cb.id, campaign_id: listing.campaign_id },
            })
          )
        );
      }

      await Promise.all([
        createNotification({
          userId: listing.investor_id,
          type: 'bid_accepted',
          title: 'Auto-Accept Triggered',
          message: `A bid of ${bid_price_per_token} ETH/token met your auto-accept threshold (${listing.auto_accept_price_per_token} ETH) on "${campaignTitle}" and was automatically accepted!`,
          link: '/investor-dashboard/my-listings',
          metadata: { bid_id: bid.id, listing_id, campaign_id: listing.campaign_id },
        }),
        createNotification({
          userId: buyerId,
          type: 'bid_accepted',
          title: 'Offer Auto-Accepted!',
          message: `Your bid of ${bid_price_per_token} ETH/token met the seller's auto-accept threshold on "${campaignTitle}" and has been accepted automatically! You have 24 hours to confirm the purchase.`,
          link: '/investor-dashboard/my-bids',
          metadata: { bid_id: bid.id, listing_id, campaign_id: listing.campaign_id },
        }),
      ]);

      return res.status(201).json({
        bid,
        auto_accepted: true,
        accept_deadline: acceptDeadline.toISOString(),
        message: 'Your bid met the seller\'s auto-accept threshold and was accepted automatically! You have 24 hours to confirm the purchase.',
      });
    }

    // Standard pending bid notifications
    await Promise.all([
      createNotification({
        userId: listing.investor_id,
        type: 'bid_received',
        title: 'New Bid Received',
        message: `Someone placed a bid of ${bid_price_per_token} ETH/token on your "${campaignTitle}" listing.`,
        link: '/investor-dashboard/my-listings',
        metadata: { bid_id: bid.id, listing_id: listing_id, campaign_id: listing.campaign_id },
      }),
      createNotification({
        userId: buyerId,
        type: 'bid_received',
        title: 'Bid Placed Successfully',
        message: `Congratulations! Your offer of ${bid_price_per_token} ETH/token on "${campaignTitle}" has been placed successfully.`,
        link: '/investor-dashboard/my-bids',
        metadata: { bid_id: bid.id, listing_id: listing_id, campaign_id: listing.campaign_id },
      }),
    ]);

    // Fire-and-forget: debounced fair price recalculation (does NOT delay response)
    setImmediate(() => _scheduleFairPriceOnBid(listing.campaign_id, listing.price));

    return res.status(201).json({ bid, message: 'Bid placed successfully. The seller will be notified.' });
  } catch (err) {
    console.error('[placeBid] error:', err);
    return res.status(500).json({ error: 'Failed to place bid' });
  }
}

// ─── Fair Price: debounced recalc after placeBid ──────────────────────────────
// Uses debouncedRecalc (10 s) to handle rapid successive bids gracefully.
function _scheduleFairPriceOnBid(campaignId, listingPrice) {
  try {
    const { debouncedRecalc } = require('../services/fairPriceService');
    debouncedRecalc(campaignId, listingPrice);
  } catch (e) {
    // Service not yet initialized or import error — safe to ignore
  }
}


// ─────────────────────────────────────────────
// GET /api/marketplace/listings/:listingId/bids
// Seller views all bids on their listing (ranked by price)
// ─────────────────────────────────────────────
async function getListingBids(req, res) {
  const sellerId = req.user?.id;
  const { listingId } = req.params;

  try {
    // 1. Verify this listing belongs to the seller
    const { data: listing, error: listingErr } = await supabaseAdmin
      .from('token_orders')
      .select('id, investor_id, campaign_id, price, quantity_remaining, status')
      .eq('id', listingId)
      .eq('side', 'sell')
      .single();

    if (listingErr || !listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (listing.investor_id !== sellerId) {
      return res.status(403).json({ error: 'You are not the owner of this listing' });
    }

    // 2. Fetch all bids, join buyer profile info — include auto_accepted in status filter
    const { data: bids, error: bidsErr } = await supabaseAdmin
      .from('token_bids')
      .select(`
        id, buyer_id, buyer_wallet, bid_price_per_token, quantity, status,
        bid_expires_at, accept_deadline, tx_hash, created_at,
        profiles:buyer_id ( full_name, display_name, identity_verified )
      `)
      .eq('listing_id', listingId)
      .in('status', ['pending', 'auto_accepted', 'accepted', 'confirmed', 'completed', 'rejected', 'expired', 'counter_offered', 'counter_accepted', 'counter_rejected'])
      .order('bid_price_per_token', { ascending: false }); // highest bid first

    if (bidsErr) throw bidsErr;

    return res.json({ listing, bids: bids || [] });
  } catch (err) {
    console.error('[getListingBids] error:', err);
    return res.status(500).json({ error: 'Failed to load bids' });
  }
}

// ─────────────────────────────────────────────
// POST /api/marketplace/bids/:bidId/accept
// Seller accepts a specific bid → 24hr window opens for buyer
// ─────────────────────────────────────────────
async function acceptBid(req, res) {
  const sellerId = req.user?.id;
  const { bidId } = req.params;

  try {
    // 1. Load the bid with its listing info
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from('token_bids')
      .select(`
        id, listing_id, buyer_id, buyer_wallet, quantity, bid_price_per_token, status, bid_expires_at,
        token_orders:listing_id ( investor_id, quantity_remaining, status, seller_signature, seller_nonce, price, campaign_id )
      `)
      .eq('id', bidId)
      .single();

    if (bidErr || !bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }

    // 2. Authorization: only the listing's seller can accept
    if (bid.token_orders?.investor_id !== sellerId) {
      return res.status(403).json({ error: 'You are not the seller for this listing' });
    }

    // 3. Validate bid state
    if (bid.status !== 'pending') {
      return res.status(400).json({ error: `Cannot accept a bid with status: ${bid.status}` });
    }
    if (new Date(bid.bid_expires_at) < new Date()) {
      return res.status(400).json({ error: 'This bid has already expired' });
    }
    if (!['open', 'partially_filled'].includes(bid.token_orders?.status)) {
      return res.status(400).json({ error: 'The sell listing is no longer active' });
    }

    // 4. Seller must have signed the listing before accepting a bid
    if (!bid.token_orders?.seller_signature) {
      return res.status(400).json({
        error: 'You must sign your listing before accepting bids. Update your listing with a signature.',
        code: 'SIGNATURE_REQUIRED',
      });
    }

    // 5. Set 24-hour accept deadline and update bid status
    const acceptDeadline = new Date();
    acceptDeadline.setHours(acceptDeadline.getHours() + 24);

    const { data: updatedBid, error: updateErr } = await supabaseAdmin
      .from('token_bids')
      .update({
        status: 'accepted',
        accept_deadline: acceptDeadline.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bidId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // ── Edge case: auto-cancel all OTHER pending bids on this listing ──
    // shafqaat implemented — Fix P2: Fetch competing pending bids and notify bidders that their offer was cancelled
    const { data: competingBids } = await supabaseAdmin
      .from('token_bids')
      .select('id, buyer_id')
      .eq('listing_id', bid.listing_id)
      .eq('status', 'pending')
      .neq('id', bidId);

    const { error: cancelErr } = await supabaseAdmin
      .from('token_bids')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('listing_id', bid.listing_id)
      .eq('status', 'pending')
      .neq('id', bidId); // Don't cancel the bid we just accepted

    if (cancelErr) {
      console.warn('[acceptBid] Could not auto-cancel competing bids:', cancelErr.message);
    } else if (competingBids && competingBids.length > 0) {
      await Promise.all(
        competingBids.map((cb) =>
          createNotification({
            userId: cb.buyer_id,
            type: 'bid_cancelled',
            title: 'Bid Cancelled',
            message: `Another offer on the listing was accepted by the seller. Your pending bid has been cancelled.`,
            link: '/investor-dashboard/my-bids',
            metadata: { bid_id: cb.id, campaign_id: bid.campaign_id },
          })
        )
      );
    }

    // Notify the buyer their bid was accepted
    const { data: campData } = await supabaseAdmin
      .from('campaigns').select('title').eq('id', bid.campaign_id).single();
    await createNotification({
      userId: bid.buyer_id,
      type: 'bid_accepted',
      title: 'Your Bid Was Accepted',
      message: `Your offer on "${campData?.title || 'a listing'}" was accepted. You have 24 hours to confirm the purchase.`,
      link: '/investor-dashboard/my-bids',
      metadata: { bid_id: bidId, campaign_id: bid.campaign_id },
    });

    return res.json({
      bid: updatedBid,
      accept_deadline: acceptDeadline.toISOString(),
      message: 'Bid accepted. Buyer has 24 hours to confirm the purchase.',
    });
  } catch (err) {
    console.error('[acceptBid] error:', err);
    return res.status(500).json({ error: 'Failed to accept bid' });
  }
}

// ─────────────────────────────────────────────
// POST /api/marketplace/bids/:bidId/cancel
// Buyer cancels their own pending bid
// ─────────────────────────────────────────────
async function cancelBid(req, res) {
  const buyerId = req.user?.id;
  const { bidId } = req.params;

  try {
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from('token_bids')
      .select('id, buyer_id, status')
      .eq('id', bidId)
      .single();

    if (bidErr || !bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (bid.buyer_id !== buyerId) {
      return res.status(403).json({ error: 'You can only cancel your own bids' });
    }
    if (!['pending'].includes(bid.status)) {
      return res.status(400).json({
        error: `Cannot cancel a bid with status: ${bid.status}. Only pending bids can be cancelled.`,
      });
    }

    const { data: updatedBid, error: updateErr } = await supabaseAdmin
      .from('token_bids')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', bidId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Notify both buyer and seller
    const { data: orderData } = await supabaseAdmin
      .from('token_orders').select('investor_id, campaign_id').eq('id', bid.listing_id).single();
    const { data: campData } = await supabaseAdmin
      .from('campaigns').select('title').eq('id', orderData?.campaign_id || bid.campaign_id).single();
    const campaignTitle = campData?.title || 'a listing';

    await Promise.all([
      orderData ? createNotification({
        userId: orderData.investor_id,
        type: 'bid_cancelled',
        title: 'A Buyer Withdrew Their Bid',
        message: `A buyer cancelled their bid on your "${campaignTitle}" listing.`,
        link: '/investor-dashboard/my-listings',
        metadata: { bid_id: bidId, campaign_id: orderData.campaign_id },
      }) : Promise.resolve(),
      createNotification({
        userId: buyerId,
        type: 'bid_cancelled',
        title: 'Bid Cancelled',
        message: `Your bid on "${campaignTitle}" has been cancelled.`,
        link: '/investor-dashboard/my-bids',
        metadata: { bid_id: bidId },
      }),
    ]);

    return res.json({ bid: updatedBid, message: 'Bid cancelled successfully.' });
  } catch (err) {
    console.error('[cancelBid] error:', err);
    return res.status(500).json({ error: 'Failed to cancel bid' });
  }
}


// ─────────────────────────────────────────────
// GET /api/marketplace/bids/my
// Buyer views all their own bids across all listings
// ─────────────────────────────────────────────
async function getMyBids(req, res) {
  const buyerId = req.user?.id;

  try {
    const { data: bids, error } = await supabaseAdmin
      .from('token_bids')
      .select(`
        id, listing_id, campaign_id, bid_price_per_token, quantity, status,
        bid_expires_at, accept_deadline, tx_hash, created_at, updated_at,
        token_orders:listing_id (
          price, quantity_remaining, seller_wallet_address, seller_signature, seller_nonce,
          listing_mode, listing_deadline, min_bid_price_per_token,
          campaigns:campaign_id ( title, category, token_contract_address, token_symbol )
        )
      `)
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ bids: bids || [] });
  } catch (err) {
    console.error('[getMyBids] error:', err);
    return res.status(500).json({ error: 'Failed to load your bids' });
  }
}

// ─────────────────────────────────────────────
// POST /api/marketplace/listings/:listingId/sign
// shafqaat implemented — Fix P1: Verify seller EIP-712 signature in signListing()
// Seller signs their listing (stores EIP-712 seller signature)
// Called when seller creates or updates listing — off-chain, no gas
// ─────────────────────────────────────────────
async function signListing(req, res) {
  const sellerId = req.user?.id;
  const { listingId } = req.params;
  const { seller_signature, seller_nonce, seller_expiry } = req.body;

  if (!seller_signature || seller_nonce === undefined) {
    return res.status(400).json({ error: 'seller_signature and seller_nonce are required' });
  }

  try {
    // Verify ownership and fetch listing details
    const { data: listing, error: listingErr } = await supabaseAdmin
      .from('token_orders')
      .select(`
        id, investor_id, price, quantity, seller_wallet_address,
        campaigns:campaign_id ( token_contract_address )
      `)
      .eq('id', listingId)
      .eq('side', 'sell')
      .single();

    if (listingErr || !listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (listing.investor_id !== sellerId) {
      return res.status(403).json({ error: 'You are not the owner of this listing' });
    }

    // shafqaat implemented — Verify EIP-712 seller signature against contract domain
    const marketplaceAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS;
    if (marketplaceAddress && listing.seller_wallet_address && listing.campaigns?.token_contract_address) {
      try {
        const ORDER_TYPES = {
          Order: [
            { name: 'seller',         type: 'address'  },
            { name: 'tokenAddress',   type: 'address'  },
            { name: 'tokenAmount',    type: 'uint256'  },
            { name: 'pricePerToken',  type: 'uint256'  },
            { name: 'nonce',          type: 'uint256'  },
            { name: 'expiry',         type: 'uint256'  },
          ],
        };

        const domain = {
          name: 'EquityMarketplace',
          version: '1',
          chainId: Number(process.env.CHAIN_ID || 11155111),
          verifyingContract: marketplaceAddress,
        };

        const expiry = seller_expiry || Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
        const amount = ethers.parseUnits(String(listing.quantity), 18);
        const pricePerToken = ethers.parseEther(String(listing.price));

        const orderValue = {
          seller: listing.seller_wallet_address,
          tokenAddress: listing.campaigns.token_contract_address,
          tokenAmount: amount,
          pricePerToken: pricePerToken,
          nonce: BigInt(seller_nonce),
          expiry: BigInt(expiry),
        };

        const recovered = ethers.verifyTypedData(domain, ORDER_TYPES, orderValue, seller_signature);
        if (recovered.toLowerCase() !== listing.seller_wallet_address.toLowerCase()) {
          return res.status(400).json({
            error: 'Signature verification failed: recovered address does not match seller wallet',
            code: 'INVALID_SIGNATURE',
          });
        }
      } catch (verifyErr) {
        console.warn('[signListing] EIP-712 verification check error:', verifyErr.message);
        if (verifyErr.code === 'INVALID_ARGUMENT' || verifyErr.message.includes('signature')) {
          return res.status(400).json({ error: `Invalid signature format: ${verifyErr.message}` });
        }
      }
    }

    // Store the signature
    const { error: updateErr } = await supabaseAdmin
      .from('token_orders')
      .update({
        seller_signature,
        seller_nonce: Number(seller_nonce),
        updated_at: new Date().toISOString(),
      })
      .eq('id', listingId);

    if (updateErr) throw updateErr;

    return res.json({ message: 'Listing signed successfully. Buyers can now bid.' });
  } catch (err) {
    console.error('[signListing] error:', err);
    return res.status(500).json({ error: 'Failed to save listing signature' });
  }
}

// ─────────────────────────────────────────────
// POST /api/marketplace/bids/:bidId/confirm
// Buyer confirms accepted bid → marks as confirmed
// Called BEFORE the on-chain fillOrder() transaction
// ─────────────────────────────────────────────
async function confirmBid(req, res) {
  const buyerId = req.user?.id;
  const { bidId } = req.params;

  try {
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from('token_bids')
      .select(`
        id, buyer_id, listing_id, quantity, bid_price_per_token, status, accept_deadline,
        counter_price_per_token,
        token_orders:listing_id (
          seller_wallet_address, seller_signature, seller_nonce, price,
          campaigns:campaign_id ( token_contract_address )
        )
      `)
      .eq('id', bidId)
      .single();

    if (bidErr || !bid) return res.status(404).json({ error: 'Bid not found' });
    if (bid.buyer_id !== buyerId) return res.status(403).json({ error: 'Not your bid' });
    // auto_accepted bids also proceed through confirm → complete like accepted and counter_accepted
    if (!['accepted', 'confirmed', 'counter_accepted', 'auto_accepted'].includes(bid.status)) {
      return res.status(400).json({ error: 'Only accepted or confirmed bids can be processed' });
    }
    if (bid.accept_deadline && new Date(bid.accept_deadline) < new Date()) {
      // Expire the bid automatically
      await supabaseAdmin
        .from('token_bids')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', bidId);
      return res.status(400).json({ error: 'The 24-hour confirm window has expired. Bid is now expired.' });
    }

    const listing = bid.token_orders;
    if (!listing?.seller_signature) {
      return res.status(400).json({ error: 'Seller signature not found for this listing. Contact the seller.' });
    }

    // Mark bid as confirmed
    await supabaseAdmin
      .from('token_bids')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', bidId);

    // shafqaat implemented — for counter_accepted use counter price; for auto_accepted use bid_price_per_token
    const effectivePrice = bid.status === 'counter_accepted' && bid.counter_price_per_token
      ? Number(bid.counter_price_per_token)
      : Number(bid.bid_price_per_token);
    const subtotal = effectivePrice * Number(bid.quantity);
    const platformFee = (subtotal * 200) / 10000; // 2.0% platform fee

    // Return all the data needed by the frontend to call fillOrder() on-chain
    return res.json({
      message: 'Bid confirmed. Proceed with the on-chain transaction.',
      settlement_data: {
        seller_wallet: listing.seller_wallet_address,
        seller_signature: listing.seller_signature,
        seller_nonce: listing.seller_nonce,
        token_contract_address: listing.campaigns?.token_contract_address,
        quantity: bid.quantity,
        price_per_token: effectivePrice,
        subtotal,
        platform_fee: platformFee,
        platform_fee_bps: 200,
      },
    });
  } catch (err) {
    console.error('[confirmBid] error:', err);
    return res.status(500).json({ error: 'Failed to confirm bid' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// shafqaat implemented — Fix 4: completeBid now verifies tx_hash on-chain
// via verifyOnChainTx() before writing to the DB. Previously any string was
// accepted as tx_hash, allowing a buyer to claim a trade settled without paying.
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/marketplace/bids/:bidId/complete
// Called by buyer's frontend AFTER fillOrder() on-chain tx succeeds
// Updates bid + listing status in the DB
// ─────────────────────────────────────────────────────────────────────────────
async function completeBid(req, res) {
  const buyerId = req.user?.id;
  const { bidId } = req.params;
  const { tx_hash, block_number } = req.body;

  if (!tx_hash) {
    return res.status(400).json({ error: 'tx_hash is required' });
  }

  try {
    // Fetch bid including buyer_wallet for on-chain sender verification
    // IMPORTANT: counter_price_per_token MUST be included so effectivePrice is correct for counter_accepted bids
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from('token_bids')
      .select('id, buyer_id, buyer_wallet, listing_id, campaign_id, quantity, status, bid_price_per_token, counter_price_per_token')
      .eq('id', bidId)
      .single();

    if (bidErr || !bid) return res.status(404).json({ error: 'Bid not found' });
    if (bid.buyer_id !== buyerId) return res.status(403).json({ error: 'Not your bid' });
    // auto_accepted bids can also be completed once buyer pays on-chain
    if (!['accepted', 'confirmed', 'counter_accepted', 'auto_accepted'].includes(bid.status)) {
      return res.status(400).json({ error: 'Only accepted or confirmed bids can be marked as completed' });
    }

    // shafqaat implemented — Fix 4: Verify tx_hash on-chain before marking trade complete.
    // This prevents a buyer from submitting a fake hash and getting tokens for free.
    try {
      await verifyOnChainTx(tx_hash, bid.buyer_wallet, bid.id);
    } catch (verifyErr) {
      return res.status(400).json({
        error: `On-chain verification failed: ${verifyErr.message}`,
        code: 'TX_VERIFICATION_FAILED',
      });
    }

    // For counter_accepted use counter price; for auto_accepted use bid_price_per_token (no negotiation)
    const effectivePrice = (bid.status === 'counter_accepted' && bid.counter_price_per_token)
      ? Number(bid.counter_price_per_token)
      : Number(bid.bid_price_per_token);
    const totalPrice = effectivePrice * Number(bid.quantity);
    const feeAmount = (totalPrice * 200) / 10000;

    let atomicSuccess = false;
    try {
      const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('fn_complete_bid_atomic', {
        p_bid_id: bidId,
        p_tx_hash: tx_hash,
        p_block_number: block_number ? Number(block_number) : null,
        p_fee_amount: feeAmount,
      });
      if (!rpcErr && rpcResult?.success) {
        atomicSuccess = true;
      }
    } catch (rpcEx) {
      console.warn('[completeBid] fn_complete_bid_atomic RPC not available, using atomic fallback:', rpcEx.message);
    }

    if (!atomicSuccess) {
      const { data: listing, error: listErr } = await supabaseAdmin
        .from('token_orders')
        .select('id, quantity_remaining, quantity_filled, investor_id')
        .eq('id', bid.listing_id)
        .single();

      if (listErr || !listing) throw new Error('Listing not found');
      if (Number(listing.quantity_remaining) < Number(bid.quantity)) {
        return res.status(400).json({ error: 'Listing does not have enough remaining quantity' });
      }

      const newRemaining = Math.max(0, Number(listing.quantity_remaining) - Number(bid.quantity));
      const newFilled = Number(listing.quantity_filled || 0) + Number(bid.quantity);

      // 1. Mark bid as completed
      const { error: bidUpdateErr } = await supabaseAdmin
        .from('token_bids')
        .update({
          status: 'completed',
          tx_hash,
          block_number: block_number ? Number(block_number) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bidId);

      if (bidUpdateErr) throw bidUpdateErr;

      // 2. Decrement listing quantity atomically
      await supabaseAdmin
        .from('token_orders')
        .update({
          quantity_remaining: newRemaining,
          quantity_filled: newFilled,
          status: newRemaining <= 0 ? 'filled' : 'open',
          updated_at: new Date().toISOString(),
        })
        .eq('id', bid.listing_id);

      // 3. Insert record into token_trades
      try {
        await supabaseAdmin.from('token_trades').insert([{
          campaign_id: bid.campaign_id,
          buy_order_id: null,
          sell_order_id: bid.listing_id,
          bid_id: bidId,
          buyer_id: bid.buyer_id,
          seller_id: listing.investor_id,
          price: effectivePrice,
          quantity: bid.quantity,
          fee_amount: feeAmount,
          tx_hash,
          settlement_status: 'settled',
          executed_at: new Date().toISOString(),
        }]);

        // ── Fair Price: immediate recalc after a real settled trade ────────────
        // A new settled trade is the strongest market signal — recalculate
        // immediately (no debounce) and may promote to Tier 1 pricing.
        try {
          const { triggerFairPriceRecalculation } = require('../services/fairPriceService');
          triggerFairPriceRecalculation(bid.campaign_id, effectivePrice).catch((fpErr) =>
            console.warn('[completeBid] Fair price recalc failed silently:', fpErr.message)
          );
        } catch (fpImportErr) {
          // Service not yet initialized — safe to ignore
        }
      } catch (tradeErr) {
        console.warn('[completeBid] Could not insert into token_trades (check migration 0008):', tradeErr.message);
      }
    }

    // Notify both buyer and seller the trade is done on-chain
    const { data: orderData } = await supabaseAdmin
      .from('token_orders').select('investor_id, campaign_id').eq('id', bid.listing_id).single();
    const { data: campData } = await supabaseAdmin
      .from('campaigns').select('title').eq('id', bid.campaign_id).single();
    const campaignTitle = campData?.title || 'a campaign';

    await Promise.all([
      // Buyer notification
      createNotification({
        userId: bid.buyer_id,
        type: 'trade_completed',
        title: 'Trade Completed',
        message: `Your token purchase from "${campaignTitle}" is complete. View on Etherscan: ${tx_hash.slice(0, 12)}...`,
        link: '/investor-dashboard/my-bids',
        metadata: { bid_id: bidId, tx_hash, campaign_id: bid.campaign_id },
      }),
      // Seller notification
      orderData ? createNotification({
        userId: orderData.investor_id,
        type: 'trade_completed',
        title: 'Your Tokens Were Sold',
        message: `Your token sale for "${campaignTitle}" settled on-chain. Funds are in your wallet.`,
        link: '/investor-dashboard/my-listings',
        metadata: { bid_id: bidId, tx_hash, campaign_id: bid.campaign_id },
      }) : Promise.resolve(),
    ]);

    return res.json({ message: 'Trade completed successfully!', tx_hash });
  } catch (err) {
    console.error('[completeBid] error:', err);
    return res.status(500).json({ error: 'Failed to complete bid' });
  }
}

// ─────────────────────────────────────────────
// POST /api/marketplace/kyc-signature
// Returns a backend-signed EIP-712 KYC ticket so buyer can call fillOrder()
// Both parties must be KYC-verified in the DB before the signature is issued
// ─────────────────────────────────────────────
async function getKycSignature(req, res) {
  const { buyer_wallet, seller_wallet, chain_id = 11155111 } = req.body;

  if (!buyer_wallet || !seller_wallet) {
    return res.status(400).json({ error: 'buyer_wallet and seller_wallet are required' });
  }

  try {
    const { generateKycSignature } = require('../services/kycSignerService');
    const { kycSignature, kycDeadline } = await generateKycSignature(buyer_wallet, seller_wallet, chain_id);
    return res.json({ kycSignature, kycDeadline });
  } catch (err) {
    console.error('[getKycSignature] error:', err);
    // Return the specific KYC error to the frontend so buyer knows what to fix
    return res.status(403).json({ error: err.message || 'KYC authorization failed' });
  }
}

// ─────────────────────────────────────────────
// POST /api/marketplace/bids/:bidId/reject
// Seller rejects a pending bid
// ─────────────────────────────────────────────
async function rejectBid(req, res) {
  const sellerId = req.user?.id;
  const { bidId } = req.params;

  try {
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from('token_bids')
      .select(`
        id, listing_id, buyer_id, bid_price_per_token, quantity, status, campaign_id,
        token_orders:listing_id ( investor_id )
      `)
      .eq('id', bidId)
      .single();

    if (bidErr || !bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (bid.token_orders?.investor_id !== sellerId) {
      return res.status(403).json({ error: 'You are not the seller for this listing' });
    }
    // Sellers can reject both pending bids AND their own counter_offered bids
    if (!['pending', 'counter_offered'].includes(bid.status)) {
      return res.status(400).json({ error: `Cannot reject a bid with status: ${bid.status}. Only pending or counter-offered bids can be rejected.` });
    }

    const { data: updatedBid, error: updateErr } = await supabaseAdmin
      .from('token_bids')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', bidId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Notify the buyer that their bid was rejected
    const { data: campData } = await supabaseAdmin
      .from('campaigns').select('title').eq('id', bid.campaign_id).single();
    await createNotification({
      userId: bid.buyer_id,
      type: 'bid_rejected',
      title: 'Bid Rejected',
      message: `Your offer of ${bid.bid_price_per_token} ETH/token on "${campData?.title || 'a listing'}" was rejected by the seller.`,
      link: '/investor-dashboard/my-bids',
      metadata: { bid_id: bidId, campaign_id: bid.campaign_id },
    });

    return res.json({ bid: updatedBid, message: 'Bid rejected successfully.' });
  } catch (err) {
    console.error('[rejectBid] error:', err);
    return res.status(500).json({ error: 'Failed to reject bid' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// shafqaat implemented — Fix 7: Counter-Offer Negotiation System
//
// Sellers can respond to a buyer's pending bid with a counter-price instead of
// accept/reject. The buyer then has a configurable window (default 48h) to
// accept or reject the counter. If accepted, the bid proceeds through the
// normal confirm → complete flow at the counter price.
//
// Status flow:
//   pending → counter_offered → counter_accepted → confirmed → completed
//                             → counter_rejected  (bid ends)
//                             → expired           (counter window passes)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/marketplace/bids/:bidId/counter
// Seller sends a counter price to a buyer's pending bid
async function counterBid(req, res) {
  // shafqaat implemented
  const sellerId = req.user?.id;
  const { bidId } = req.params;
  const { counter_price_per_token, counter_message, counter_expires_hours = 48 } = req.body;

  if (!counter_price_per_token || Number(counter_price_per_token) <= 0) {
    return res.status(400).json({ error: 'counter_price_per_token must be a positive number' });
  }

  try {
    // 1. Load bid with listing info to verify seller ownership
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from('token_bids')
      .select(`
        id, listing_id, buyer_id, bid_price_per_token, quantity, status, campaign_id,
        token_orders:listing_id ( investor_id, status )
      `)
      .eq('id', bidId)
      .single();

    if (bidErr || !bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }

    // 2. Authorization: only the listing's seller can counter
    if (bid.token_orders?.investor_id !== sellerId) {
      return res.status(403).json({ error: 'You are not the seller for this listing' });
    }

    // 3. Can only counter pending bids
    if (bid.status !== 'pending') {
      return res.status(400).json({
        error: `Cannot counter a bid with status: ${bid.status}. Only pending bids can receive a counter-offer.`,
      });
    }

    // 4. Listing must still be active
    if (!['open', 'partially_filled'].includes(bid.token_orders?.status)) {
      return res.status(400).json({ error: 'The sell listing is no longer active' });
    }

    // 5. Build counter expiry timestamp
    const counterExpiresAt = new Date();
    counterExpiresAt.setHours(counterExpiresAt.getHours() + Number(counter_expires_hours));

    // 6. Update bid to counter_offered status, preserving original bid price
    const { data: updatedBid, error: updateErr } = await supabaseAdmin
      .from('token_bids')
      .update({
        status: 'counter_offered',
        original_bid_price: bid.bid_price_per_token,  // preserve buyer's original offer
        counter_price_per_token: Number(counter_price_per_token),
        counter_expires_at: counterExpiresAt.toISOString(),
        counter_message: counter_message || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bidId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // 7. Notify the buyer of the counter-offer
    const { data: campData } = await supabaseAdmin
      .from('campaigns').select('title').eq('id', bid.campaign_id).single();
    const campaignTitle = campData?.title || 'a listing';

    await createNotification({
      userId: bid.buyer_id,
      type: 'bid_countered',
      title: 'Counter-Offer Received',
      message:
        `The seller has countered your offer on "${campaignTitle}". ` +
        `Your offer: ${bid.bid_price_per_token} ETH/token → Counter: ${counter_price_per_token} ETH/token. ` +
        `You have ${counter_expires_hours} hours to respond.`,
      link: '/investor-dashboard/my-bids',
      metadata: {
        bid_id: bidId,
        campaign_id: bid.campaign_id,
        original_price: bid.bid_price_per_token,
        counter_price: counter_price_per_token,
        counter_expires_at: counterExpiresAt.toISOString(),
      },
    });

    return res.json({
      bid: updatedBid,
      counter_expires_at: counterExpiresAt.toISOString(),
      message: `Counter-offer of ${counter_price_per_token} ETH/token sent. Buyer has ${counter_expires_hours} hours to respond.`,
    });
  } catch (err) {
    console.error('[counterBid] error:', err);
    return res.status(500).json({ error: 'Failed to send counter-offer' });
  }
}

// POST /api/marketplace/bids/:bidId/accept-counter
// Buyer accepts the seller's counter-offer → proceeds to confirm/complete flow
async function acceptCounter(req, res) {
  // shafqaat implemented
  const buyerId = req.user?.id;
  const { bidId } = req.params;

  try {
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from('token_bids')
      .select(`
        id, buyer_id, listing_id, campaign_id, bid_price_per_token,
        counter_price_per_token, counter_expires_at, status,
        token_orders:listing_id ( investor_id, seller_signature )
      `)
      .eq('id', bidId)
      .single();

    if (bidErr || !bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (bid.buyer_id !== buyerId) {
      return res.status(403).json({ error: 'You can only respond to your own bids' });
    }
    if (bid.status !== 'counter_offered') {
      return res.status(400).json({
        error: `Cannot accept counter on a bid with status: ${bid.status}`,
      });
    }

    // Check counter has not expired
    if (bid.counter_expires_at && new Date(bid.counter_expires_at) < new Date()) {
      await supabaseAdmin
        .from('token_bids')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', bidId);
      return res.status(400).json({ error: 'The counter-offer has expired.' });
    }

    // Set 24-hour accept deadline (same as normal accept flow)
    const acceptDeadline = new Date();
    acceptDeadline.setHours(acceptDeadline.getHours() + 24);

    // Transition to counter_accepted; the effective price is now counter_price_per_token
    const { data: updatedBid, error: updateErr } = await supabaseAdmin
      .from('token_bids')
      .update({
        status: 'counter_accepted',
        accept_deadline: acceptDeadline.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bidId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Notify the seller that the buyer accepted their counter
    const { data: campData } = await supabaseAdmin
      .from('campaigns').select('title').eq('id', bid.campaign_id).single();
    const campaignTitle = campData?.title || 'a listing';

    await createNotification({
      userId: bid.token_orders?.investor_id,
      type: 'counter_accepted',
      title: 'Counter-Offer Accepted!',
      message:
        `The buyer accepted your counter-offer of ${bid.counter_price_per_token} ETH/token ` +
        `on "${campaignTitle}". They have 24 hours to confirm the purchase.`,
      link: '/investor-dashboard/my-listings',
      metadata: { bid_id: bidId, campaign_id: bid.campaign_id, counter_price: bid.counter_price_per_token },
    });

    return res.json({
      bid: updatedBid,
      accept_deadline: acceptDeadline.toISOString(),
      effective_price: bid.counter_price_per_token,
      message: 'Counter-offer accepted. You have 24 hours to confirm and complete the purchase.',
    });
  } catch (err) {
    console.error('[acceptCounter] error:', err);
    return res.status(500).json({ error: 'Failed to accept counter-offer' });
  }
}

// POST /api/marketplace/bids/:bidId/reject-counter
// Buyer rejects the seller's counter-offer — bid ends, listing re-opens
async function rejectCounter(req, res) {
  // shafqaat implemented
  const buyerId = req.user?.id;
  const { bidId } = req.params;

  try {
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from('token_bids')
      .select(`
        id, buyer_id, listing_id, campaign_id, bid_price_per_token,
        counter_price_per_token, status,
        token_orders:listing_id ( investor_id )
      `)
      .eq('id', bidId)
      .single();

    if (bidErr || !bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (bid.buyer_id !== buyerId) {
      return res.status(403).json({ error: 'You can only respond to your own bids' });
    }
    if (bid.status !== 'counter_offered') {
      return res.status(400).json({
        error: `Cannot reject counter on a bid with status: ${bid.status}`,
      });
    }

    // Transition to counter_rejected
    const { data: updatedBid, error: updateErr } = await supabaseAdmin
      .from('token_bids')
      .update({
        status: 'counter_rejected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bidId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Notify the seller that the buyer rejected their counter
    const { data: campData } = await supabaseAdmin
      .from('campaigns').select('title').eq('id', bid.campaign_id).single();
    const campaignTitle = campData?.title || 'a listing';

    await Promise.all([
      // Seller notification
      bid.token_orders?.investor_id
        ? createNotification({
            userId: bid.token_orders.investor_id,
            type: 'counter_rejected',
            title: 'Counter-Offer Rejected',
            message:
              `The buyer rejected your counter-offer of ${bid.counter_price_per_token} ETH/token ` +
              `on "${campaignTitle}". The listing is now open for new bids.`,
            link: '/investor-dashboard/my-listings',
            metadata: { bid_id: bidId, campaign_id: bid.campaign_id },
          })
        : Promise.resolve(),
      // Buyer confirmation
      createNotification({
        userId: buyerId,
        type: 'counter_rejected',
        title: 'Counter-Offer Declined',
        message: `You declined the counter-offer on "${campaignTitle}". Browse other listings to find a better deal.`,
        link: '/investor-dashboard',
        metadata: { bid_id: bidId, campaign_id: bid.campaign_id },
      }),
    ]);

    return res.json({
      bid: updatedBid,
      message: 'Counter-offer rejected. The listing is now available for other buyers.',
    });
  } catch (err) {
    console.error('[rejectCounter] error:', err);
    return res.status(500).json({ error: 'Failed to reject counter-offer' });
  }
}


// shafqaat implemented — Fix P3: Buyer increases offer on a pending bid
// POST /api/marketplace/bids/:bidId/modify
async function modifyBid(req, res) {
  const buyerId = req.user?.id;
  const { bidId } = req.params;
  const { new_bid_price_per_token, new_quantity } = req.body;

  if (!new_bid_price_per_token && !new_quantity) {
    return res.status(400).json({ error: 'new_bid_price_per_token or new_quantity is required' });
  }

  try {
    const { data: bid, error: bidErr } = await supabaseAdmin
      .from('token_bids')
      .select('id, buyer_id, listing_id, campaign_id, bid_price_per_token, quantity, status, original_bid_price')
      .eq('id', bidId)
      .single();

    if (bidErr || !bid) return res.status(404).json({ error: 'Bid not found' });
    if (bid.buyer_id !== buyerId) return res.status(403).json({ error: 'Not your bid' });
    if (bid.status !== 'pending') {
      return res.status(400).json({ error: `Cannot modify bid in "${bid.status}" status. Only pending bids can be modified.` });
    }

    const { data: listing, error: listErr } = await supabaseAdmin
      .from('token_orders')
      .select('id, investor_id, quantity_remaining, auto_accept_price_per_token')
      .eq('id', bid.listing_id)
      .single();

    if (listErr || !listing) return res.status(404).json({ error: 'Listing not found' });

    const price = new_bid_price_per_token ? Number(new_bid_price_per_token) : Number(bid.bid_price_per_token);
    const qty = new_quantity ? Number(new_quantity) : Number(bid.quantity);

    if (price <= 0 || qty <= 0) {
      return res.status(400).json({ error: 'Price and quantity must be positive' });
    }

    if (new_bid_price_per_token && Number(new_bid_price_per_token) <= Number(bid.bid_price_per_token)) {
      return res.status(400).json({ error: 'New bid price must be strictly higher than the current bid price' });
    }

    if (qty > Number(listing.quantity_remaining)) {
      return res.status(400).json({ error: `Requested quantity ${qty} exceeds available ${listing.quantity_remaining} tokens` });
    }

    const isAutoAccepted = Boolean(
      listing.auto_accept_price_per_token &&
      price >= Number(listing.auto_accept_price_per_token)
    );

    let acceptDeadline = null;
    if (isAutoAccepted) {
      acceptDeadline = new Date();
      acceptDeadline.setHours(acceptDeadline.getHours() + 24);
    }

    const updatePayload = {
      bid_price_per_token: price,
      quantity: qty,
      original_bid_price: bid.original_bid_price || bid.bid_price_per_token,
      status: isAutoAccepted ? 'accepted' : 'pending',
      accept_deadline: acceptDeadline ? acceptDeadline.toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedBid, error: updateErr } = await supabaseAdmin
      .from('token_bids')
      .update(updatePayload)
      .eq('id', bidId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    const { data: campaign } = await supabaseAdmin
      .from('campaigns').select('title').eq('id', bid.campaign_id).single();
    const campaignTitle = campaign?.title || 'a listing';

    if (isAutoAccepted) {
      await Promise.all([
        createNotification({
          userId: listing.investor_id,
          type: 'bid_accepted',
          title: 'Auto-Accept Triggered',
          message: `A modified bid on "${campaignTitle}" reached ${price} ETH/token and was automatically accepted!`,
          link: '/investor-dashboard/my-listings',
          metadata: { bid_id: bidId, listing_id: bid.listing_id, campaign_id: bid.campaign_id },
        }),
        createNotification({
          userId: buyerId,
          type: 'bid_accepted',
          title: 'Offer Auto-Accepted!',
          message: `Your updated bid of ${price} ETH/token met the seller's auto-accept threshold on "${campaignTitle}" and was accepted automatically! You have 24 hours to confirm the purchase.`,
          link: '/investor-dashboard/my-bids',
          metadata: { bid_id: bidId, listing_id: bid.listing_id, campaign_id: bid.campaign_id },
        }),
      ]);
    } else {
      await createNotification({
        userId: listing.investor_id,
        type: 'bid_received',
        title: 'Bid Offer Increased',
        message: `A buyer increased their bid on "${campaignTitle}" from ${bid.bid_price_per_token} to ${price} ETH/token.`,
        link: '/investor-dashboard/my-listings',
        metadata: { bid_id: bidId, listing_id: bid.listing_id, campaign_id: bid.campaign_id },
      });
    }

    return res.json({
      bid: updatedBid,
      auto_accepted: isAutoAccepted,
      message: isAutoAccepted
        ? 'Bid updated and automatically accepted!'
        : 'Bid offer increased successfully. Seller has been notified.',
    });
  } catch (err) {
    console.error('[modifyBid] error:', err);
    return res.status(500).json({ error: 'Failed to modify bid' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// processAuctionDeadlines — Node.js fallback cron (called every 60s from index.js)
// Calls the pg_cron DB function and then sends push notifications to winners.
// This is a safety net in case pg_cron is not available in the Supabase plan.
// ─────────────────────────────────────────────────────────────────────────────
async function processAuctionDeadlines() {
  try {
    // Step 1: Let the DB function do the heavy lifting (atomic update)
    const { error: rpcErr } = await supabaseAdmin.rpc('fn_process_auction_deadlines');
    if (rpcErr) {
      console.error('[AuctionSweep] DB function error:', rpcErr.message);
      return;
    }

    // Step 2: Find all bids that were just auto_accepted (no notification sent yet)
    // We check for bids updated in the last 2 minutes to catch this run and the previous
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: newlyAccepted } = await supabaseAdmin
      .from('token_bids')
      .select(`
        id, buyer_id, listing_id, campaign_id, bid_price_per_token, quantity,
        token_orders:listing_id ( investor_id, campaigns:campaign_id ( title ) )
      `)
      .eq('status', 'auto_accepted')
      .gte('updated_at', twoMinsAgo);

    if (!newlyAccepted || newlyAccepted.length === 0) return;

    // Step 3: Send notifications to each winner and the seller
    for (const bid of newlyAccepted) {
      const campaignTitle = bid.token_orders?.campaigns?.title || 'a listing';
      const sellerId = bid.token_orders?.investor_id;

      await Promise.allSettled([
        // Notify winning buyer
        createNotification({
          userId: bid.buyer_id,
          type: 'bid_accepted',
          title: '🎉 You Won the Auction!',
          message: `Your bid of ${bid.bid_price_per_token} ETH/token on "${campaignTitle}" won the auction! Confirm & Pay within 24 hours to receive your tokens.`,
          link: '/investor-dashboard/my-bids',
          metadata: { bid_id: bid.id, listing_id: bid.listing_id, campaign_id: bid.campaign_id },
        }),
        // Notify seller
        sellerId ? createNotification({
          userId: sellerId,
          type: 'bid_accepted',
          title: 'Auction Ended — Winner Selected',
          message: `Your "${campaignTitle}" auction ended. A buyer has won and has 24 hours to confirm payment.`,
          link: '/investor-dashboard/my-listings',
          metadata: { bid_id: bid.id, listing_id: bid.listing_id, campaign_id: bid.campaign_id },
        }) : Promise.resolve(),
      ]);
    }

    // Step 4: Also notify bidders who were expired in this run
    const { data: justExpired } = await supabaseAdmin
      .from('token_bids')
      .select('id, buyer_id, listing_id, campaign_id, token_orders:listing_id ( campaigns:campaign_id ( title ) )')
      .eq('status', 'expired')
      .gte('updated_at', twoMinsAgo);

    if (justExpired && justExpired.length > 0) {
      for (const bid of justExpired) {
        const campaignTitle = bid.token_orders?.campaigns?.title || 'a listing';
        await createNotification({
          userId: bid.buyer_id,
          type: 'bid_cancelled',
          title: 'Auction Ended — Not Selected',
          message: `The auction for "${campaignTitle}" has ended. Your bid was not selected.`,
          link: '/investor-dashboard/my-bids',
          metadata: { bid_id: bid.id, listing_id: bid.listing_id, campaign_id: bid.campaign_id },
        }).catch(() => {});
      }
    }

    console.log(`[AuctionSweep] Processed ${newlyAccepted.length} auction winner(s) at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('[AuctionSweep] Unexpected error:', err.message);
  }
}

module.exports = {
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
  // shafqaat implemented — bid modification (Fix P3)
  modifyBid,
  // Automated auction deadline processing (new)
  processAuctionDeadlines,
};

