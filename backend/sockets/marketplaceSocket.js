// backend/sockets/marketplaceSocket.js
const { Server } = require('socket.io');

let io = null;

function isSocketOriginAllowed(origin, callback) {
  if (!origin) return callback(null, true);
  const cleanOrigin = origin.trim().replace(/\/$/, '');
  const allowed = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''));
  if (allowed.includes(cleanOrigin)) return callback(null, true);
  try {
    const { hostname } = new URL(cleanOrigin);
    if (hostname.endsWith('.vercel.app') || hostname === 'localhost' || hostname === '127.0.0.1') {
      return callback(null, true);
    }
  } catch (e) {}
  return callback(null, false);
}

function initMarketplaceSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: isSocketOriginAllowed,
      credentials: true,
    },
  });

  // ── Existing: public campaign order-book rooms ────────────────────
  const marketplace = io.of('/marketplace');
  marketplace.on('connection', (socket) => {
    socket.on('joinCampaign', (campaignId) => socket.join(String(campaignId)));
    socket.on('leaveCampaign', (campaignId) => socket.leave(String(campaignId)));
  });

  // ── New: private per-user notification rooms ──────────────────────
  // Each investor connects here and joins a room named "user:<their_user_id>".
  // Only that specific investor receives events emitted to their room.
  const notifications = io.of('/notifications');
  notifications.on('connection', (socket) => {
    socket.on('joinUserRoom', (userId) => {
      if (userId) socket.join(`user:${userId}`);
    });
    socket.on('leaveUserRoom', (userId) => {
      if (userId) socket.leave(`user:${userId}`);
    });
  });

  return io;
}

function formatSide(orders) {
  return orders.map((o) => ({
    price: o.price,
    quantity: o.quantity_remaining,
    total: o.price * o.quantity_remaining,
  }));
}

function emitBookUpdate(campaignId, rawSnapshot) {
  if (!io) return;
  const snapshot = { bids: formatSide(rawSnapshot.bids), asks: formatSide(rawSnapshot.asks) };
  io.of('/marketplace').to(String(campaignId)).emit('bookUpdate', { campaignId: String(campaignId), snapshot });
}

function emitTradeExecuted(campaignId, trade) {
  if (!io) return;
  const formatted = {
    id: trade.id,
    side: trade.buyer_id ? 'buy' : 'sell',
    price: trade.price,
    quantity: trade.quantity,
    total: trade.price * trade.quantity,
    buyer: trade.buyer_id,
    seller: trade.seller_id,
    timestamp: trade.executed_at,
  };
  io.of('/marketplace').to(String(campaignId)).emit('tradeExecuted', { campaignId: String(campaignId), trade: formatted });
}

// Push a single notification object to a specific user's private room
function emitNotificationToUser(userId, notification) {
  if (!io) return;
  io.of('/notifications').to(`user:${userId}`).emit('newNotification', notification);
}

// Push live fair-price update to all clients watching a campaign room.
// Called by fairPriceService after each AI recalculation.
function emitFairPriceUpdate(campaignId, fairPriceData) {
  if (!io) return;
  io.of('/marketplace')
    .to(String(campaignId))
    .emit('fairPriceUpdated', { campaignId: String(campaignId), ...fairPriceData });
}

module.exports = { initMarketplaceSocket, emitBookUpdate, emitTradeExecuted, emitNotificationToUser, emitFairPriceUpdate };