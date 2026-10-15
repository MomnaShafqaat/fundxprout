// backend/controllers/fairPriceController.js
// HTTP handler for the Fair Price API endpoint.
// Route: GET /api/marketplace/campaigns/:campaignId/fair-price
//
// Query params:
//   ?listingPrice=0.15   (optional) current ask price in ETH — used for
//                        deviation calculation in the UI without a DB lookup
//   ?refresh=true        (optional) force bypass cache and recalculate now

'use strict';

const { getFairPrice, triggerFairPriceRecalculation } = require('../services/fairPriceService');

async function getCampaignFairPrice(req, res) {
  const { campaignId } = req.params;
  const listingPrice   = req.query.listingPrice ? Number(req.query.listingPrice) : null;
  const forceRefresh   = req.query.refresh === 'true';

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  try {
    let result;

    if (forceRefresh) {
      console.log(`[fairPriceController] Force refresh requested for campaign ${campaignId}`);
      result = await triggerFairPriceRecalculation(campaignId, listingPrice);
    } else {
      result = await getFairPrice(campaignId, listingPrice);
    }

    if (!result) {
      return res.status(503).json({
        error: 'Fair price analysis is temporarily unavailable for this campaign.',
        hint:  'The campaign may not have enough data yet (no AI scores or pricing set).',
      });
    }

    // Attach listing price deviation to the response for convenience
    if (listingPrice && result.fair_price_midpoint) {
      const deviation = ((listingPrice - result.fair_price_midpoint) / result.fair_price_midpoint) * 100;
      result.listing_price_eth       = listingPrice;
      result.listing_deviation_pct   = Math.round(deviation * 10) / 10;
      result.listing_is_overpriced   = deviation > 15;
      result.listing_is_underpriced  = deviation < -15;
    }

    return res.json(result);
  } catch (err) {
    console.error('[fairPriceController] Error:', err.message);
    return res.status(500).json({ error: 'Failed to calculate fair price', details: err.message });
  }
}

module.exports = { getCampaignFairPrice };
