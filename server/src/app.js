require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const whatsappRoutes = require('./routes/whatsapp');
const connector = require('./whatsapp/connector-service');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static prototype UI
app.use(express.static(path.join(__dirname, '../public')));

// WhatsApp connector routes
app.use('/api/whatsapp', whatsappRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`[WaCRM Server] Running on http://localhost:${PORT}`);
    console.log(`[WaCRM Phase 0] WhatsApp Feasibility prototype available at http://localhost:${PORT}`);
  });
}

// Graceful cleanup on process exit
function cleanup() {
  console.log('\n[WaCRM Server] Cleaning up WhatsApp sessions and shutting down...');
  connector.destroy();
  if (server) {
    server.close(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

module.exports = app;
