const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

// GET /api/analytics
router.get('/', auth, async (req, res) => {
  try {
    res.json({
      message: 'Analytics endpoint',
      stats: {
        totalInstances: 0,
        totalMessages: 0,
        uptime: process.uptime()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;