'use client';
// frontend/hooks/useFairPrice.ts
// React hook that:
//   1. Fetches the fair price from the backend API on mount
//   2. Subscribes to Socket.IO 'fairPriceUpdated' events for real-time refresh
//      whenever a new bid is placed or a trade completes on the same campaign
//
// Usage:
//   const { data, loading, error } = useFairPrice(campaignId, listingPrice);

import { useState, useEffect, useCallback } from 'react';

export interface FairPriceBreakdown {
  factor:    string;
  impact:    string;   // e.g. "+5.2%" or "-12.0%"
  direction: 'positive' | 'negative' | 'neutral';
}

export interface FairPriceResult {
  // Core price range
  fair_price_low:      number;
  fair_price_high:     number;
  fair_price_midpoint: number;

  // AI verdict
  confidence:       'high' | 'medium' | 'low';
  confidence_reason: string;
  buyer_verdict:    string;
  seller_guidance:  string;

  // Breakdown factors (expandable list in UI)
  breakdown_bullets: FairPriceBreakdown[];

  // Market context
  market_trend:        'rising' | 'falling' | 'stable' | 'insufficient_data';
  recommended_bid_eth: number;

  // Listing context (added by controller)
  listing_price_eth?:     number;
  listing_deviation_pct?: number;
  listing_is_overpriced?: boolean;
  listing_is_underpriced?: boolean;

  // Meta
  from_cache?:    boolean;
  calculated_at?: string;
}

interface UseFairPriceReturn {
  data:    FairPriceResult | null;
  loading: boolean;
  error:   string | null;
  refresh: () => void;  // Manually force a recalculation (cache bypass)
}

export function useFairPrice(
  campaignId: string | number | null | undefined,
  listingPrice?: number | null,
): UseFairPriceReturn {
  const [data,    setData]    = useState<FairPriceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchFairPrice = useCallback(async (forceRefresh = false) => {
    if (!campaignId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (listingPrice != null) params.set('listingPrice', String(listingPrice));
      if (forceRefresh)          params.set('refresh', 'true');

      const url = `${API_BASE}/api/marketplace/campaigns/${campaignId}/fair-price?${params.toString()}`;
      const res = await fetch(url, { cache: 'no-store' });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const json: FairPriceResult = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Failed to load fair price');
    } finally {
      setLoading(false);
    }
  }, [campaignId, listingPrice, API_BASE]);

  // Initial fetch
  useEffect(() => {
    fetchFairPrice(false);
  }, [fetchFairPrice]);

  // Socket.IO real-time listener
  useEffect(() => {
    if (!campaignId) return;

    let socket: any = null;

    // Dynamic import to avoid SSR issues
    import('socket.io-client').then(({ io }) => {
      socket = io(`${API_BASE}/marketplace`, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
      });

      socket.emit('joinCampaign', String(campaignId));

      socket.on('fairPriceUpdated', (payload: { campaignId: string } & FairPriceResult) => {
        if (String(payload.campaignId) === String(campaignId)) {
          setData(payload);
          setLoading(false);
        }
      });
    }).catch(() => {
      // socket.io-client may not be installed in all environments — degrade gracefully
      console.warn('[useFairPrice] socket.io-client import failed — real-time updates disabled.');
    });

    return () => {
      if (socket) {
        socket.emit('leaveCampaign', String(campaignId));
        socket.disconnect();
      }
    };
  }, [campaignId, API_BASE]);

  const refresh = useCallback(() => fetchFairPrice(true), [fetchFairPrice]);

  return { data, loading, error, refresh };
}
