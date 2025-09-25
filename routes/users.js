const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const User = require('../models/User');
const Instance = require('../models/Instance');
const Message = require('../models/Message');
const { auth, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const logger = require('../utils/logger');

// GET /api/users/profile - Eigenes Profil abrufen
router.get('/profile', auth, async (req, res) => {
  try {
    const user = req.user;
    const instanceCount = await Instance.countDocuments({ userId: user._id });

    res.json({
      profile: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        plan: user.plan,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        usage: {
          ...user.usage,
          currentInstances: instanceCount
        },
        planLimits: user.planLimits,
        stats: user.stats
      }
    });

  } catch (error) {
    logger.logError(error, { context: 'get_profile', userId: req.user?.id });
    res.status(500).json({
      error: 'Failed to get profile',
      message: 'Internal server error'
    });
  }
});

// PUT /api/users/profile - Profil aktualisieren
router.put('/profile',
  auth,
  [
    body('username').optional().trim().isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Valid email required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username, email } = req.body;
      const user = req.user;

      // Prüfen ob Username/Email bereits vergeben (außer bei sich selbst)
      if (username && username !== user.username) {
        const existingUser = await User.findOne({ username, _id: { $ne: user._id } });
        if (existingUser) {
          return res.status(400).json({
            error: 'Username already taken',
            message: 'Please choose a different username'
          });
        }
        user.username = username;
      }

      if (email && email !== user.email) {
        const existingUser = await User.findOne({ email, _id: { $ne: user._id } });
        if (existingUser) {
          return res.status(400).json({
            error: 'Email already registered',
            message: 'Please choose a different email'
          });
        }
        user.email = email;
      }

      await user.save();

      res.json({
        message: 'Profile updated successfully',
        profile: {
          id: user._id,
          username: user.username,
          email: user.email,
          updatedAt: user.updatedAt
        }
      });

    } catch (error) {
      logger.logError(error, { context: 'update_profile', userId: req.user?.id });
      res.status(500).json({
        error: 'Profile update failed',
        message: 'Internal server error'
      });
    }
  }
);

// GET /api/users/stats - Benutzer-Statistiken
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { period = '7d' } = req.query;

    // Zeitraum berechnen
    const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 7;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    // Instanz-Statistiken
    const instances = await Instance.find({ userId }).lean();
    const activeInstances = instances.filter(inst => inst.status === 'ready').length;

    // Nachrichten-Statistiken
    const messageStats = await Message.aggregate([
      {
        $match: {
          userId,
          createdAt: { $gte: dateFrom }
        }
      },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          sentMessages: {
            $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] }
          },
          receivedMessages: {
            $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] }
          },
          mediaMessages: {
            $sum: { $cond: ['$media.hasMedia', 1, 0] }
          }
        }
      }
    ]);

    // Tägliche Nachrichten-Verteilung
    const dailyStats = await Message.aggregate([
      {
        $match: {
          userId,
          createdAt: { $gte: dateFrom }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 },
          sent: {
            $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] }
          },
          received: {
            $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    const stats = messageStats[0] || {
      totalMessages: 0,
      sentMessages: 0,
      receivedMessages: 0,
      mediaMessages: 0
    };

    res.json({
      period,
      instances: {
        total: instances.length,
        active: activeInstances,
        inactive: instances.length - activeInstances
      },
      messages: {
        total: stats.totalMessages,
        sent: stats.sentMessages,
        received: stats.receivedMessages,
        media: stats.mediaMessages
      },
      daily: dailyStats,
      usage: req.user.usage,
      limits: req.user.planLimits
    });

  } catch (error) {
    logger.logError(error, { context: 'get_user_stats', userId: req.user?.id });
    res.status(500).json({
      error: 'Failed to get statistics',
      message: 'Internal server error'
    });
  }
});

// DELETE /api/users/account - Account löschen
router.delete('/account',
  auth,
  rateLimit({ max: 2, windowMs: 60 * 60 * 1000 }), // Max 2 mal pro Stunde
  [
    body('password').notEmpty().withMessage('Password confirmation required'),
    body('confirmation').equals('DELETE_MY_ACCOUNT').withMessage('Please type DELETE_MY_ACCOUNT to confirm')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { password } = req.body;
      const user = await User.findById(req.user.id).select('+password');

      // Passwort bestätigen
      const bcrypt = require('bcrypt');
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(400).json({
          error: 'Invalid password',
          message: 'Please provide correct password to delete account'
        });
      }

      // Alle Instanzen des Benutzers stoppen und löschen
      const instances = await Instance.find({ userId: user._id });
      for (const instance of instances) {
        try {
          // Instanz aus InstanceManager entfernen (falls aktiv)
          const ProductionInstanceManager = require('../services/ProductionInstanceManager');
          const instanceManager = global.instanceManager || new ProductionInstanceManager();
          if (instanceManager.instances.has(instance.instanceId)) {
            await instanceManager.deleteInstance(instance.instanceId);
          }
        } catch (err) {
          logger.logError(err, { context: 'delete_instance_on_account_deletion', instanceId: instance.instanceId });
        }
      }

      // Alle Nachrichten löschen
      await Message.deleteMany({ userId: user._id });

      // Alle Instanzen löschen
      await Instance.deleteMany({ userId: user._id });

      // Benutzer löschen
      await User.deleteOne({ _id: user._id });

      logger.whatsappLogger.auth(user._id, 'account_deleted', true, req.ip, req.get('User-Agent'));

      res.json({
        message: 'Account deleted successfully',
        notice: 'All your data has been permanently removed'
      });

    } catch (error) {
      logger.logError(error, { context: 'delete_account', userId: req.user?.id });
      res.status(500).json({
        error: 'Account deletion failed',
        message: 'Internal server error'
      });
    }
  }
);

// Admin-Only Routes

// GET /api/users - Alle Benutzer abrufen (Admin)
router.get('/',
  auth,
  requireAdmin,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('role').optional().isIn(['user', 'admin', 'superadmin']).withMessage('Invalid role'),
    query('plan').optional().isIn(['free', 'basic', 'premium', 'enterprise']).withMessage('Invalid plan'),
    query('active').optional().isBoolean().withMessage('Active must be boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { page = 1, limit = 20, role, plan, active, search } = req.query;

      const query = {};
      if (role) query.role = role;
      if (plan) query.plan = plan;
      if (active !== undefined) query.isActive = active === 'true';
      if (search) {
        query.$or = [
          { username: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      const users = await User.find(query)
        .select('-password -refreshTokens')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit));

      const total = await User.countDocuments(query);

      // Instanz-Zähler für jeden Benutzer
      const usersWithInstances = await Promise.all(
        users.map(async (user) => {
          const instanceCount = await Instance.countDocuments({ userId: user._id });
          return {
            ...user.toJSON(),
            instanceCount
          };
        })
      );

      res.json({
        users: usersWithInstances,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });

    } catch (error) {
      logger.logError(error, { context: 'get_all_users', userId: req.user?.id });
      res.status(500).json({
        error: 'Failed to get users',
        message: 'Internal server error'
      });
    }
  }
);

// GET /api/users/:userId - Einzelnen Benutzer abrufen (Admin)
router.get('/:userId',
  auth,
  requireAdmin,
  param('userId').isMongoId().withMessage('Invalid user ID'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = await User.findById(req.params.userId).select('-password -refreshTokens');
      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      // Zusätzliche Statistiken
      const instanceCount = await Instance.countDocuments({ userId: user._id });
      const messageCount = await Message.countDocuments({ userId: user._id });

      res.json({
        user: {
          ...user.toJSON(),
          instanceCount,
          messageCount
        }
      });

    } catch (error) {
      logger.logError(error, { context: 'get_user', userId: req.user?.id });
      res.status(500).json({
        error: 'Failed to get user',
        message: 'Internal server error'
      });
    }
  }
);

// PUT /api/users/:userId - Benutzer aktualisieren (Admin)
router.put('/:userId',
  auth,
  requireAdmin,
  [
    param('userId').isMongoId().withMessage('Invalid user ID'),
    body('role').optional().isIn(['user', 'admin', 'superadmin']).withMessage('Invalid role'),
    body('plan').optional().isIn(['free', 'basic', 'premium', 'enterprise']).withMessage('Invalid plan'),
    body('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
    body('planLimits.maxInstances').optional().isInt({ min: 0 }).withMessage('maxInstances must be non-negative'),
    body('planLimits.maxMessages').optional().isInt({ min: 0 }).withMessage('maxMessages must be non-negative')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { role, plan, isActive, planLimits } = req.body;

      // Super-Admin-Rolle nur von Super-Admin änderbar
      if (role === 'superadmin' && req.user.role !== 'superadmin') {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'Only super admins can grant super admin role'
        });
      }

      const updateData = {};
      if (role !== undefined) updateData.role = role;
      if (plan !== undefined) updateData.plan = plan;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (planLimits) {
        updateData.planLimits = { ...req.user.planLimits, ...planLimits };
      }

      const user = await User.findByIdAndUpdate(
        req.params.userId,
        updateData,
        { new: true, runValidators: true }
      ).select('-password -refreshTokens');

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      logger.whatsappLogger.auth(req.user.id, `user_updated_${req.params.userId}`, true, req.ip, req.get('User-Agent'));

      res.json({
        message: 'User updated successfully',
        user
      });

    } catch (error) {
      logger.logError(error, { context: 'update_user', userId: req.user?.id });
      res.status(500).json({
        error: 'User update failed',
        message: 'Internal server error'
      });
    }
  }
);

// DELETE /api/users/:userId - Benutzer löschen (Super Admin)
router.delete('/:userId',
  auth,
  requireSuperAdmin,
  param('userId').isMongoId().withMessage('Invalid user ID'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = await User.findById(req.params.userId);
      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The requested user does not exist'
        });
      }

      // Verhindern, dass sich Super-Admins selbst löschen
      if (user._id.toString() === req.user.id) {
        return res.status(400).json({
          error: 'Cannot delete yourself',
          message: 'You cannot delete your own account'
        });
      }

      // Alle Instanzen und Nachrichten des Benutzers löschen
      const instances = await Instance.find({ userId: user._id });
      for (const instance of instances) {
        try {
          const ProductionInstanceManager = require('../services/ProductionInstanceManager');
          const instanceManager = global.instanceManager || new ProductionInstanceManager();
          if (instanceManager.instances.has(instance.instanceId)) {
            await instanceManager.deleteInstance(instance.instanceId);
          }
        } catch (err) {
          logger.logError(err, { context: 'delete_instance_on_user_deletion', instanceId: instance.instanceId });
        }
      }

      await Message.deleteMany({ userId: user._id });
      await Instance.deleteMany({ userId: user._id });
      await User.deleteOne({ _id: user._id });

      logger.whatsappLogger.auth(req.user.id, `user_deleted_${req.params.userId}`, true, req.ip, req.get('User-Agent'));

      res.json({
        message: 'User deleted successfully',
        deletedUser: {
          id: user._id,
          username: user.username,
          email: user.email
        }
      });

    } catch (error) {
      logger.logError(error, { context: 'delete_user', userId: req.user?.id });
      res.status(500).json({
        error: 'User deletion failed',
        message: 'Internal server error'
      });
    }
  }
);

module.exports = router;