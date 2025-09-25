const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { auth, requireAdmin } = require('../middleware/auth');

// GET /api/users/profile
router.get('/profile', auth, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role,
        plan: req.user.plan
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users (admin only)
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}).select('-password');
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;