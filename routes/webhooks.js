const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');

const Instance = require('../models/Instance');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const logger = require('../utils/logger');

// Webhook-Event-Types
const WEBHOOK_EVENTS = [
  'qr',
  'ready',
  'authenticated',
  'auth_failure',
  'disconnected',
  'message',
  'message_ack',
  'message_reaction',
  'message_edit',
  'group_join',
  'group_leave',
  'group_admin_changed',
  'contact_changed',
  'call'
];

// POST /api/webhooks/test - Webhook-URL testen
router.post('/test',
  auth,
  rateLimit({ max: 10, windowMs: 60000 }),
  [
    body('webhookUrl').isURL().withMessage('Valid webhook URL required'),
    body('instanceId').optional().notEmpty().withMessage('Instance ID required if provided')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { webhookUrl, instanceId } = req.body;

      // Instance-Berechtigung prüfen falls instanceId angegeben
      if (instanceId) {
        const instance = await Instance.findOne({ instanceId, userId: req.user.id });
        if (!instance) {
          return res.status(404).json({
            error: 'Instance not found',
            message: 'Instance not found or no permission'
          });
        }
      }

      // Test-Webhook senden
      const testPayload = {
        instanceId: instanceId || 'test',
        event: 'webhook_test',
        timestamp: new Date().toISOString(),
        data: {
          message: 'This is a test webhook from WhatsApp Manager',
          testId: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          userId: req.user.id
        }
      };

      const webhookResult = await sendWebhookRequest(webhookUrl, testPayload);

      res.json({
        success: webhookResult.success,
        webhookUrl,
        testPayload,
        response: {
          status: webhookResult.status,
          statusText: webhookResult.statusText,
          headers: webhookResult.headers,
          data: webhookResult.data,
          duration: webhookResult.duration
        }
      });

    } catch (error) {
      logger.logError(error, { context: 'webhook_test', userId: req.user?.id });
      res.status(500).json({
        error: 'Webhook test failed',
        message: 'Internal server error'
      });
    }
  }
);

// GET /api/webhooks/events - Verfügbare Webhook-Events auflisten
router.get('/events', auth, (req, res) => {
  const eventDescriptions = {
    'qr': 'QR code received for authentication',
    'ready': 'WhatsApp client is ready',
    'authenticated': 'Authentication successful',
    'auth_failure': 'Authentication failed',
    'disconnected': 'Client disconnected from WhatsApp',
    'message': 'New message received',
    'message_ack': 'Message acknowledgment changed',
    'message_reaction': 'Message reaction added/removed',
    'message_edit': 'Message was edited',
    'group_join': 'User joined group',
    'group_leave': 'User left group',
    'group_admin_changed': 'Group admin permissions changed',
    'contact_changed': 'Contact information changed',
    'call': 'Incoming call received'
  };

  const events = WEBHOOK_EVENTS.map(event => ({
    event,
    description: eventDescriptions[event] || 'Event description not available'
  }));

  res.json({
    events,
    totalEvents: events.length,
    documentation: {
      format: 'All webhooks are sent as POST requests with JSON payload',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-Manager-Webhook/1.0'
      },
      timeout: '30 seconds',
      retries: 3
    }
  });
});

// POST /api/webhooks/replay - Webhook erneut senden
router.post('/replay',
  auth,
  rateLimit({ max: 20, windowMs: 60000 }),
  [
    body('instanceId').notEmpty().withMessage('Instance ID required'),
    body('event').isIn(WEBHOOK_EVENTS).withMessage('Invalid event type'),
    body('data').optional().isObject().withMessage('Data must be an object')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { instanceId, event, data } = req.body;

      // Instance-Berechtigung prüfen
      const instance = await Instance.findOne({ instanceId, userId: req.user.id });
      if (!instance) {
        return res.status(404).json({
          error: 'Instance not found',
          message: 'Instance not found or no permission'
        });
      }

      if (!instance.config.webhookUrl) {
        return res.status(400).json({
          error: 'No webhook configured',
          message: 'Please configure a webhook URL for this instance first'
        });
      }

      // Webhook-Payload erstellen
      const payload = {
        instanceId,
        event,
        timestamp: new Date().toISOString(),
        data: data || { replayed: true, originalEvent: event }
      };

      const webhookResult = await sendWebhookRequest(instance.config.webhookUrl, payload);

      // Webhook-Log erstellen
      logger.whatsappLogger.webhook(
        instanceId,
        instance.config.webhookUrl,
        event,
        webhookResult.success,
        webhookResult,
        webhookResult.error
      );

      res.json({
        success: webhookResult.success,
        instanceId,
        event,
        webhookUrl: instance.config.webhookUrl,
        payload,
        response: {
          status: webhookResult.status,
          statusText: webhookResult.statusText,
          duration: webhookResult.duration
        }
      });

    } catch (error) {
      logger.logError(error, { context: 'webhook_replay', userId: req.user?.id });
      res.status(500).json({
        error: 'Webhook replay failed',
        message: 'Internal server error'
      });
    }
  }
);

// GET /api/webhooks/logs/:instanceId - Webhook-Logs für eine Instanz
router.get('/logs/:instanceId',
  auth,
  [
    param('instanceId').notEmpty().withMessage('Instance ID required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { instanceId } = req.params;
      const { limit = 50, page = 1 } = req.query;

      // Instance-Berechtigung prüfen
      const instance = await Instance.findOne({ instanceId, userId: req.user.id });
      if (!instance) {
        return res.status(404).json({
          error: 'Instance not found',
          message: 'Instance not found or no permission'
        });
      }

      // Webhook-Logs aus Winston-Logs lesen wäre komplex
      // Für jetzt geben wir eine vereinfachte Antwort zurück
      // In einer echten Implementation würde man Webhook-Logs in einer separaten Collection speichern

      res.json({
        instanceId,
        webhookUrl: instance.config.webhookUrl || null,
        logs: [],
        message: 'Webhook logs feature coming soon',
        suggestion: 'Check application logs for webhook events in the meantime',
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 0
        }
      });

    } catch (error) {
      logger.logError(error, { context: 'webhook_logs', userId: req.user?.id });
      res.status(500).json({
        error: 'Failed to get webhook logs',
        message: 'Internal server error'
      });
    }
  }
);

// PUT /api/webhooks/config/:instanceId - Webhook-Konfiguration aktualisieren
router.put('/config/:instanceId',
  auth,
  [
    param('instanceId').notEmpty().withMessage('Instance ID required'),
    body('webhookUrl').optional().custom(value => {
      if (value === null || value === '') return true; // Allow clearing webhook
      if (typeof value === 'string' && value.match(/^https?:\/\/.+/)) return true;
      throw new Error('Webhook URL must be a valid HTTP/HTTPS URL or null to disable');
    }),
    body('webhookEvents').optional().isArray().withMessage('Webhook events must be an array'),
    body('webhookEvents.*').optional().isIn(WEBHOOK_EVENTS).withMessage('Invalid webhook event')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { instanceId } = req.params;
      const { webhookUrl, webhookEvents } = req.body;

      // Instance-Berechtigung prüfen
      const instance = await Instance.findOne({ instanceId, userId: req.user.id });
      if (!instance) {
        return res.status(404).json({
          error: 'Instance not found',
          message: 'Instance not found or no permission'
        });
      }

      // Konfiguration aktualisieren
      const updateData = {};
      if (webhookUrl !== undefined) {
        updateData['config.webhookUrl'] = webhookUrl || null;
      }
      if (webhookEvents !== undefined) {
        updateData['config.webhookEvents'] = webhookEvents.length > 0 ? webhookEvents : WEBHOOK_EVENTS;
      }

      const updatedInstance = await Instance.findOneAndUpdate(
        { instanceId, userId: req.user.id },
        { $set: updateData },
        { new: true, runValidators: true }
      );

      logger.whatsappLogger.instance(instanceId, 'webhook_config_updated', {
        webhookUrl: webhookUrl ? 'configured' : 'disabled',
        eventCount: webhookEvents?.length || WEBHOOK_EVENTS.length
      });

      res.json({
        message: 'Webhook configuration updated successfully',
        instanceId,
        config: {
          webhookUrl: updatedInstance.config.webhookUrl,
          webhookEvents: updatedInstance.config.webhookEvents || WEBHOOK_EVENTS
        }
      });

    } catch (error) {
      logger.logError(error, { context: 'webhook_config_update', userId: req.user?.id });
      res.status(500).json({
        error: 'Webhook configuration update failed',
        message: 'Internal server error'
      });
    }
  }
);

// Hilfsfunktion: Webhook-Request senden
async function sendWebhookRequest(webhookUrl, payload) {
  const startTime = Date.now();
  let result = {
    success: false,
    status: null,
    statusText: null,
    headers: {},
    data: null,
    duration: 0,
    error: null
  };

  try {
    // Node-fetch verwenden (bereits in whatsapp-web.js als Dependency)
    const fetch = require('node-fetch');

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-Manager-Webhook/1.0'
      },
      body: JSON.stringify(payload),
      timeout: 30000 // 30 Sekunden Timeout
    });

    result.status = response.status;
    result.statusText = response.statusText;
    result.headers = Object.fromEntries(response.headers.entries());
    result.duration = Date.now() - startTime;

    // Response body lesen (limitiert auf 1MB)
    const responseText = await response.text();
    if (responseText.length < 1024 * 1024) {
      try {
        result.data = JSON.parse(responseText);
      } catch {
        result.data = responseText.substring(0, 1000); // Erste 1000 Zeichen falls kein JSON
      }
    }

    result.success = response.status >= 200 && response.status < 300;

    if (!result.success) {
      result.error = `HTTP ${response.status}: ${response.statusText}`;
    }

  } catch (error) {
    result.duration = Date.now() - startTime;
    result.error = error.message;

    // Spezielle Fehlerbehandlung
    if (error.code === 'ECONNREFUSED') {
      result.error = 'Connection refused - webhook URL not reachable';
    } else if (error.code === 'ENOTFOUND') {
      result.error = 'DNS resolution failed - invalid hostname';
    } else if (error.code === 'ETIMEDOUT' || error.type === 'request-timeout') {
      result.error = 'Request timeout - webhook took too long to respond';
    }
  }

  return result;
}

// Webhook-Sender-Service (wird vom InstanceManager verwendet)
const sendWebhook = async (instanceId, event, data) => {
  try {
    const instance = await Instance.findOne({ instanceId });
    if (!instance || !instance.config.webhookUrl) {
      return { success: false, error: 'No webhook configured' };
    }

    // Event-Filter prüfen
    const allowedEvents = instance.config.webhookEvents || WEBHOOK_EVENTS;
    if (!allowedEvents.includes(event)) {
      return { success: false, error: 'Event not enabled for webhook' };
    }

    const payload = {
      instanceId,
      event,
      timestamp: new Date().toISOString(),
      data
    };

    const result = await sendWebhookRequest(instance.config.webhookUrl, payload);

    // Log webhook attempt
    logger.whatsappLogger.webhook(
      instanceId,
      instance.config.webhookUrl,
      event,
      result.success,
      result,
      result.error
    );

    return result;

  } catch (error) {
    logger.logError(error, { context: 'send_webhook', instanceId, event });
    return { success: false, error: error.message };
  }
};

module.exports = {
  router,
  sendWebhook,
  WEBHOOK_EVENTS
};