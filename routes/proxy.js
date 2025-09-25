const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');

const WhatsAppProxy = require('../services/WhatsAppProxy');
const ProductionInstanceManager = require('../services/ProductionInstanceManager');
const rateLimit = require('../middleware/rateLimit');
const { logger } = require('../utils/logger');

// WICHTIG: In Production wird der globale instanceManager aus server.js verwendet
const instanceManager = global.instanceManager || new ProductionInstanceManager();
const whatsappProxy = new WhatsAppProxy(instanceManager);

// ZENTRALE Auth-Middleware verwenden
const { apiKeyAuth } = require('../middleware/auth');

// API-Key aus URL-Parameter extrahieren (für Proxy-Routes)
const extractApiKeyFromUrl = (req, res, next) => {
  if (req.params.apiKey) {
    req.headers['x-api-key'] = req.params.apiKey;
  }
  next();
};

// GET /proxy/methods - Alle verfügbaren Methoden auflisten
router.get('/methods', (req, res) => {
  const methods = whatsappProxy.getAvailableMethods();
  res.json({
    totalMethods: methods.length,
    methods,
    usage: {
      endpoint: '/proxy/{apiKey}/{method}',
      example: '/proxy/abc123.../sendMessage'
    }
  });
});

// POST /proxy/{apiKey}/{method} - Dynamische Methodenausführung
router.post('/:apiKey/:method',
  extractApiKeyFromUrl,
  apiKeyAuth,
  rateLimit({ max: 30, windowMs: 60000 }),
  body('params').optional().isArray().withMessage('params must be an array'),
  body('options').optional().isObject().withMessage('options must be an object'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { method } = req.params;
      const { params = [], options = {} } = req.body;
      const apiKey = req.apiKey; // Von apiKeyAuth middleware

      const result = await whatsappProxy.executeMethod(apiKey, method, params, options);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }

    } catch (error) {
      logger.error(`Proxy error for ${req.params.method}:`, error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }
);

// Convenience-Endpoints für häufige Operationen

// POST /proxy/{apiKey}/sendMessage - Nachricht senden
router.post('/:apiKey/sendMessage',
  extractApiKeyFromUrl,
  apiKeyAuth,
  rateLimit({ max: 20, windowMs: 60000 }),
  body('chatId').notEmpty().withMessage('chatId is required'),
  body('message').notEmpty().withMessage('message is required'),
  async (req, res) => {
    try {
      const apiKey = req.apiKey; // Von apiKeyAuth middleware
      const { chatId, message, options = {} } = req.body;

      const result = await whatsappProxy.executeWithWebhook(
        apiKey,
        'sendMessage',
        [chatId, message, options],
        'message_sent'
      );

      res.json(result);

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /proxy/{apiKey}/sendMedia - Media senden
router.post('/:apiKey/sendMedia',
  extractApiKeyFromUrl,
  apiKeyAuth,
  rateLimit({ max: 10, windowMs: 60000 }),
  body('chatId').notEmpty(),
  body('media').notEmpty(),
  async (req, res) => {
    try {
      const apiKey = req.apiKey; // Von apiKeyAuth middleware
      const { chatId, media, options = {} } = req.body;

      // MessageMedia-Objekt aus Base64 erstellen
      const { MessageMedia } = require('whatsapp-web.js');
      let mediaObj;

      if (typeof media === 'string') {
        // Base64-String
        mediaObj = new MessageMedia('image/jpeg', media);
      } else if (media.data && media.mimetype) {
        // MessageMedia-Objekt
        mediaObj = new MessageMedia(media.mimetype, media.data, media.filename);
      } else {
        return res.status(400).json({ error: 'Invalid media format' });
      }

      const result = await whatsappProxy.executeMethod(
        apiKey,
        'sendMessage',
        [chatId, mediaObj, options]
      );

      res.json(result);

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /proxy/{apiKey}/chats - Alle Chats abrufen
router.get('/:apiKey/chats', extractApiKeyFromUrl, apiKeyAuth, async (req, res) => {
  try {
    const apiKey = req.apiKey; // Von apiKeyAuth middleware

    const result = await whatsappProxy.executeMethod(apiKey, 'getChats');

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /proxy/{apiKey}/contacts - Alle Kontakte abrufen
router.get('/:apiKey/contacts', extractApiKeyFromUrl, apiKeyAuth, async (req, res) => {
  try {
    const apiKey = req.apiKey; // Von apiKeyAuth middleware

    const result = await whatsappProxy.executeMethod(apiKey, 'getContacts');

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /proxy/{apiKey}/bulk - Bulk-Operationen
router.post('/:apiKey/bulk',
  extractApiKeyFromUrl,
  apiKeyAuth,
  rateLimit({ max: 5, windowMs: 60000 }),
  body('operations').isArray().withMessage('operations must be an array'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const apiKey = req.apiKey; // Von apiKeyAuth middleware
      const { operations } = req.body;

      // Bulk-Operations limitieren
      if (operations.length > 10) {
        return res.status(400).json({
          error: 'Too many operations',
          max: 10,
          provided: operations.length
        });
      }

      const results = await whatsappProxy.executeBulk(apiKey, operations);

      res.json({
        success: true,
        totalOperations: operations.length,
        results
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /proxy/{apiKey}/groups/create - Gruppe erstellen
router.post('/:apiKey/groups/create',
  extractApiKeyFromUrl,
  apiKeyAuth,
  body('name').notEmpty().withMessage('Group name is required'),
  body('participants').isArray().withMessage('Participants must be an array'),
  async (req, res) => {
    try {
      const apiKey = req.apiKey; // Von apiKeyAuth middleware
      const { name, participants } = req.body;

      const result = await whatsappProxy.executeMethod(
        apiKey,
        'createGroup',
        [name, participants]
      );

      res.json(result);

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /proxy/{apiKey}/groups/{groupId}/participants/add - Teilnehmer hinzufügen
router.post('/:apiKey/groups/:groupId/participants/add',
  extractApiKeyFromUrl,
  apiKeyAuth,
  body('participants').isArray().withMessage('Participants must be an array'),
  async (req, res) => {
    try {
      const { apiKey, groupId } = req.params;
      const { participants } = req.body;

      const result = await whatsappProxy.executeMethod(
        apiKey,
        'addParticipants',
        [groupId, participants]
      );

      res.json(result);

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /proxy/{apiKey}/info - Instance-Informationen
router.get('/:apiKey/info', extractApiKeyFromUrl, apiKeyAuth, async (req, res) => {
  try {
    const apiKey = req.apiKey; // Von apiKeyAuth middleware

    const instanceInfo = await whatsappProxy.resolveInstance(apiKey);
    const clientInfo = await whatsappProxy.executeMethod(apiKey, 'getInfo');

    res.json({
      instance: {
        id: instanceInfo.instanceId,
        name: instanceInfo.instance.name,
        status: instanceInfo.instance.status,
        phoneNumber: instanceInfo.instance.phoneNumber
      },
      whatsapp: clientInfo.result,
      methods: whatsappProxy.whatsappMethods.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket-Events für Real-time Updates
const setupWebSocketProxy = (io, whatsappProxy) => {
  io.on('connection', (socket) => {
    socket.on('subscribe-instance', async (apiKey) => {
      try {
        const { instanceId } = await whatsappProxy.resolveInstance(apiKey);
        socket.join(`proxy-${instanceId}`);

        socket.emit('subscription-success', { instanceId });
      } catch (error) {
        socket.emit('subscription-error', { error: error.message });
      }
    });

    socket.on('proxy-call', async (data) => {
      const { apiKey, method, params, callId } = data;

      try {
        const result = await whatsappProxy.executeMethod(apiKey, method, params);
        socket.emit('proxy-result', { callId, result });
      } catch (error) {
        socket.emit('proxy-error', { callId, error: error.message });
      }
    });
  });
};

module.exports = { router, setupWebSocketProxy };