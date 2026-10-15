require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// shafqaat implemented — Fix 1: Restrict CORS to known origins only.
// Previously `cors()` was called with no config, allowing ANY origin to hit the API.
// Now only the frontend origin(s) listed in ALLOWED_ORIGINS are permitted.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: Origin "${origin}" is not allowed.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

// IMPORTANT: Mount didit routes BEFORE express.json() because the webhook needs the raw body
const diditRoutes = require('./routes/diditRoutes');
app.use('/api/didit', diditRoutes);

app.use(express.json());

// Routes
const campaignRoutes = require('./routes/campaignRoutes');
app.use('/api/campaigns', campaignRoutes);

// shafqaat implemented — Fix 2: Removed duplicate marketplaceRoutes mount.
// Previously marketplaceRoutes was mounted twice (lines 31 and 38), causing every
// marketplace request to be processed twice, doubling DB calls and corrupting the
// in-memory order book. Now each router is mounted exactly once.
const marketplaceRoutes = require('./routes/marketplaceRoutes');
const walletRoutes = require('./routes/walletRoutes');
const biddingRoutes = require('./routes/biddingRoutes'); // Auction-style bidding system

app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/marketplace', biddingRoutes); // Bidding routes share the /api/marketplace prefix
app.use('/api/wallet', walletRoutes);

const notificationRoutes = require('./routes/notificationRoutes');
app.use('/api/notifications', notificationRoutes);

// shafqaat implemented — Fix 6 (Node.js fallback): Sweep expired bids every 5 minutes.
// This ensures `pending` bids past bid_expires_at and `accepted` bids past
// accept_deadline are automatically transitioned to `expired` status.
// The primary mechanism is the Supabase pg_cron job in 0007_bid_expiry_sweep.sql;
// this interval is a safety net if pg_cron is unavailable.
const { supabaseAdmin } = require('./config/supabaseAdmin');
setInterval(async () => {
  try {
    const { error } = await supabaseAdmin.rpc('fn_sweep_expired_bids');
    if (error) console.warn('[expiry-sweep] RPC error:', error.message);
  } catch (err) {
    console.warn('[expiry-sweep] fn_sweep_expired_bids failed:', err.message);
  }
}, 5 * 60 * 1000); // every 5 minutes


function runRiskAssessmentForCampaign(campaignId) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, '..', 'ai', 'score_campaigns.py');
    const pythonBin = process.env.PYTHON_BIN || 'python';

    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`AI scorer not found at ${scriptPath}`));
      return;
    }

    const child = spawn(
      pythonBin,
      [scriptPath, '--campaign-id', String(campaignId)],
      {
        cwd: path.dirname(scriptPath),
        env: process.env,
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `AI scorer exited with code ${code}`));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

async function scorePendingCampaignsOnStartup() {
  if (!supabase) {
    console.warn('[risk] Supabase env vars are missing; skipping startup risk scan');
    return;
  }

  try {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, title, risk_score')
      .is('risk_score', null);

    if (error) {
      console.error('[risk] Failed to load pending campaigns:', error.message);
      return;
    }

    if (!data || data.length === 0) {
      console.log('[risk] No pending campaigns found at startup');
      return;
    }

    console.log(`[risk] Found ${data.length} pending campaign(s)`);

    for (const campaign of data) {
      try {
        console.log(`[risk] Scoring campaign ${campaign.id} (${campaign.title || 'Untitled'})`);
        const output = await runRiskAssessmentForCampaign(campaign.id);
        console.log(`[risk] Completed campaign ${campaign.id}`);
        if (output) {
          console.log(output);
        }
      } catch (err) {
        console.error(`[risk] Failed campaign ${campaign.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[risk] Startup risk scan failed:', err);
  }
}

app.post('/api/campaigns/:id/analyze', async (req, res) => {
  try {
    const campaignId = req.params.id;
    console.log(`[risk API] Triggering manual AI risk analysis for campaign ${campaignId}...`);
    await runRiskAssessmentForCampaign(campaignId);

    const { data: updatedCampaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (error) throw error;
    return res.json({ success: true, campaign: updatedCampaign });
  } catch (err) {
    console.error('[risk API] Error analyzing campaign:', err);
    return res.status(500).json({ error: err.message || 'Failed to run AI risk assessment' });
  }
});

const http = require('http');
const { initMarketplaceSocket } = require('./sockets/marketplaceSocket');

app.get('/', (req, res) => {
  res.send('FundXprout Backend Running');
});

const server = http.createServer(app);
initMarketplaceSocket(server);

// Initialize Supabase realtime listeners for AI fair price auto-recalculation.
// Fires whenever a token_trade is settled or a new bid is placed.
const { initRealtimeListeners } = require('./services/fairPriceService');
initRealtimeListeners();

// ── Auction Deadline Fallback Cron ──────────────────────────────────────────
// Calls fn_process_auction_deadlines() every 60 seconds as a safety net in case
// pg_cron is not available. The DB function is idempotent (deadline_processed=true
// prevents double-execution), so running this and pg_cron simultaneously is safe.
const { processAuctionDeadlines } = require('./controllers/biddingController');
setInterval(() => {
  processAuctionDeadlines().catch((err) =>
    console.error('[AuctionSweep] Interval error:', err.message)
  );
}, 60 * 1000); // every 60 seconds

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  scorePendingCampaignsOnStartup();
  // Run auction sweep immediately on startup to catch any deadlines missed during downtime
  processAuctionDeadlines().catch((err) =>
    console.error('[AuctionSweep] Startup sweep error:', err.message)
  );
});
