const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

// Dummy WhatsApp methods for now
const WHATSAPP_METHODS = [
  'sendMessage', 'getChats', 'getContacts', 'createGroup', 'downloadMedia',
  'sendMedia', 'react', 'forward', 'deleteMessage', 'archiveChat'
];

// GET /api/proxy/methods
router.get('/methods', (req, res) => {
  res.json({
    totalMethods: WHATSAPP_METHODS.length,
    methods: WHATSAPP_METHODS.map(method => ({
      name: method,
      description: `Execute ${method} on WhatsApp client`
    })),
    usage: 'POST /api/proxy/{apiKey}/{method}'
  });
});

// POST /api/proxy/{apiKey}/sendMessage
router.post('/:apiKey/sendMessage',
  (req, res, next) => {
    req.headers['x-api-key'] = req.params.apiKey;
    next();
  },
  apiKeyAuth,
  rateLimit({ max: 20 }),
  async (req, res) => {
    try {
      const { chatId, message } = req.body;

      res.json({
        success: true,
        message: 'Message send requested',
        instanceId: req.instance.instanceId,
        chatId,
        messageBody: message,
        note: 'WhatsApp client integration in progress'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

module.exports = router;