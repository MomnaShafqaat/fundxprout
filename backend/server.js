// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const campaignRoutes = require('./routes/campaignRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

const http = require('http');
const { initMarketplaceSocket } = require('./sockets/marketplaceSocket');

// Middleware
app.use(cors()); // Allows Frontend to connect

// IMPORTANT: Mount didit routes BEFORE express.json() because the webhook needs the raw body
const diditRoutes = require('./routes/diditRoutes');
app.use('/api/didit', diditRoutes);

app.use(express.json()); // Parses JSON data

// Routes
app.use('/api/campaigns', campaignRoutes);
const marketplaceRoutes = require('./routes/marketplaceRoutes');
const walletRoutes = require('./routes/walletRoutes');
const biddingRoutes = require('./routes/biddingRoutes'); // Auction-style bidding system
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/marketplace', biddingRoutes); // Bidding routes share the /api/marketplace prefix
app.use('/api/wallet', walletRoutes);

// Root Check
app.get('/', (req, res) => {
    res.send('FundXprout Backend is Live & Connected to IPFS/Supabase 🚀');
});

const server = http.createServer(app);

// Initialize sockets after server creation
initMarketplaceSocket(server);

// Initialize Supabase realtime listeners for fair price auto-recalculation.
// Fires whenever a token_trade is settled or a new bid is placed via direct DB writes.
const { initRealtimeListeners } = require('./services/fairPriceService');
initRealtimeListeners();

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});