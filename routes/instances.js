const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

const Instance = require('../models/Instance');
const User = require('../models/User');
const Message = require('../models/Message');
const ProductionInstanceManager = require('../services/ProductionInstanceManager');
const auth = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

// WICHTIG: In Production wird der globale instanceManager aus server.js verwendet
// Hier nur für Standalone-Route-Tests
const instanceManager = global.instanceManager || new ProductionInstanceManager();

// Validierungsregeln
const createInstanceValidation = [
  body('name').trim().isLength({ min: 3, max: 50 }).withMessage('Name muss 3-50 Zeichen lang sein'),
  body('description').optional().trim().isLength({ max: 200 }).withMessage('Beschreibung max. 200 Zeichen'),
  body('config.webhookUrl').optional().isURL().withMessage('Webhook-URL muss gültig sein'),
  body('config.rateLimitPerMinute').optional().isInt({ min: 1, max: 60 }).withMessage('Rate-Limit 1-60 pro Minute')
];

const sendMessageValidation = [
  body('chatId').notEmpty().withMessage('Chat-ID ist erforderlich'),
  body('message').notEmpty().withMessage('Nachricht ist erforderlich'),
  body('options').optional().isObject()
];

// GET /api/instances - Alle Instanzen des Benutzers abrufen
router.get('/', auth, async (req, res) => {
  try {
    const { status, limit = 20, page = 1 } = req.query;

    const query = { userId: req.user.id };
    if (status) query.status = status;

    const instances = await Instance.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('userId', 'username email');

    const total = await Instance.countDocuments(query);

    res.json({
      instances,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der Instanzen', details: error.message });
  }
});

// GET /api/instances/:instanceId - Einzelne Instanz abrufen
router.get('/:instanceId', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    // Runtime-Status hinzufügen
    const runtimeStatus = instanceManager.getInstanceStatus(req.params.instanceId);

    res.json({
      ...instance.toJSON(),
      runtime: runtimeStatus
    });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der Instanz', details: error.message });
  }
});

// POST /api/instances - Neue Instanz erstellen
router.post('/', auth, rateLimit({ max: 10, windowMs: 60000 }), createInstanceValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Benutzer-Limits prüfen
    const user = await User.findById(req.user.id);
    if (!user.canCreateInstance) {
      return res.status(400).json({
        error: 'Instanz-Limit erreicht',
        limit: user.planLimits.maxInstances,
        current: user.usage.currentInstances
      });
    }

    // Eindeutige Instance-ID generieren
    const instanceId = `inst_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const instanceData = {
      instanceId,
      name: req.body.name,
      description: req.body.description,
      userId: req.user.id,
      config: req.body.config || {}
    };

    // Instanz erstellen
    const instance = await instanceManager.createInstance(instanceData);

    // Benutzer-Zähler erhöhen
    await user.incrementInstanceCount();

    res.status(201).json(instance);

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Erstellen der Instanz', details: error.message });
  }
});

// POST /api/instances/:instanceId/start - Instanz starten
router.post('/:instanceId/start', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    if (instance.status === 'ready') {
      return res.status(400).json({ error: 'Instanz läuft bereits' });
    }

    await instanceManager.startInstance(req.params.instanceId);

    res.json({ message: 'Instanz wird gestartet', instanceId: req.params.instanceId });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Starten der Instanz', details: error.message });
  }
});

// POST /api/instances/:instanceId/stop - Instanz stoppen
router.post('/:instanceId/stop', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    await instanceManager.stopInstance(req.params.instanceId);

    res.json({ message: 'Instanz gestoppt', instanceId: req.params.instanceId });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Stoppen der Instanz', details: error.message });
  }
});

// POST /api/instances/:instanceId/restart - Instanz neustarten
router.post('/:instanceId/restart', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    await instanceManager.restartInstance(req.params.instanceId);

    res.json({ message: 'Instanz wird neugestartet', instanceId: req.params.instanceId });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Neustarten der Instanz', details: error.message });
  }
});

// DELETE /api/instances/:instanceId - Instanz löschen
router.delete('/:instanceId', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    // Instanz löschen
    await instanceManager.deleteInstance(req.params.instanceId);

    // Benutzer-Zähler verringern
    const user = await User.findById(req.user.id);
    await user.decrementInstanceCount();

    res.json({ message: 'Instanz gelöscht', instanceId: req.params.instanceId });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Löschen der Instanz', details: error.message });
  }
});

// PUT /api/instances/:instanceId - Instanz aktualisieren
router.put('/:instanceId', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const updateFields = {};
    const allowedFields = ['name', 'description', 'config'];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateFields[field] = req.body[field];
      }
    });

    const instance = await Instance.findOneAndUpdate(
      { instanceId: req.params.instanceId, userId: req.user.id },
      updateFields,
      { new: true, runValidators: true }
    );

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    res.json(instance);

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Instanz', details: error.message });
  }
});

// GET /api/instances/:instanceId/qr - QR-Code abrufen
router.get('/:instanceId/qr', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    if (!instance.qrCode) {
      return res.status(400).json({ error: 'Kein QR-Code verfügbar' });
    }

    res.json({ qrCode: instance.qrCode, status: instance.status });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen des QR-Codes', details: error.message });
  }
});

// POST /api/instances/:instanceId/send - Nachricht senden
router.post('/:instanceId/send', auth, rateLimit({ max: 30, windowMs: 60000 }), sendMessageValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    if (instance.status !== 'ready') {
      return res.status(400).json({ error: 'Instanz nicht bereit zum Senden' });
    }

    const { chatId, message, options } = req.body;

    const sentMessage = await instanceManager.sendMessage(
      req.params.instanceId,
      chatId,
      message,
      options
    );

    res.json({
      success: true,
      messageId: sentMessage.id.id,
      chatId: sentMessage.to,
      timestamp: sentMessage.timestamp
    });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Senden der Nachricht', details: error.message });
  }
});

// GET /api/instances/:instanceId/messages - Nachrichten abrufen
router.get('/:instanceId/messages', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const { chatId, limit = 50, page = 1, direction, type } = req.query;

    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    const query = { instanceId: req.params.instanceId };
    if (chatId) query.chatId = chatId;
    if (direction) query.direction = direction;
    if (type) query.type = type;

    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Message.countDocuments(query);

    res.json({
      messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der Nachrichten', details: error.message });
  }
});

// GET /api/instances/:instanceId/stats - Instanz-Statistiken
router.get('/:instanceId/stats', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const { period = '7d' } = req.query;

    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    // Zeitraum berechnen
    const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 7;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    // Grundlegende Statistiken
    const basicStats = await Message.getMessageStats(req.params.instanceId, dateFrom);

    // Stündliche Statistiken
    const hourlyStats = await Message.getHourlyStats(req.params.instanceId, days);

    // Runtime-Status
    const runtimeStatus = instanceManager.getInstanceStatus(req.params.instanceId);

    res.json({
      basic: basicStats[0] || { total: 0, sent: 0, received: 0, failed: 0, media: 0 },
      hourly: hourlyStats,
      runtime: runtimeStatus,
      instance: {
        uptime: instance.stats.uptime,
        totalMessages: instance.stats.totalMessages,
        lastActivity: instance.stats.lastActivity
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der Statistiken', details: error.message });
  }
});

// GET /api/instances/:instanceId/chats - Aktive Chats abrufen
router.get('/:instanceId/chats', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user.id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instanz nicht gefunden' });
    }

    // Gruppiere Nachrichten nach Chat-ID
    const chats = await Message.aggregate([
      { $match: { instanceId: req.params.instanceId } },
      {
        $group: {
          _id: '$chatId',
          lastMessage: { $first: '$$ROOT' },
          messageCount: { $sum: 1 },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$direction', 'inbound'] }, { $lt: ['$ack', 3] }] },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { 'lastMessage.timestamp': -1 } },
      { $limit: 50 }
    ]);

    res.json({ chats });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der Chats', details: error.message });
  }
});

module.exports = router;