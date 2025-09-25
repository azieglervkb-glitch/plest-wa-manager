const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

// GET /api/webhooks/events
router.get('/events', auth, async (req, res) => {
  try {
    res.json({
      events: ['message', 'qr', 'ready', 'authenticated', 'disconnected'],
      totalEvents: 5
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router };