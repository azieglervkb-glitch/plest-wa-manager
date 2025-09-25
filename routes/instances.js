const express = require('express');
const router = express.Router();
const Instance = require('../models/Instance');
const { auth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

// GET /api/instances
router.get('/', auth, async (req, res) => {
  try {
    const instances = await Instance.find({ userId: req.user._id });
    res.json({
      instances,
      total: instances.length
    });
  } catch (error) {
    console.error('Get instances error:', error);
    res.status(500).json({ error: 'Failed to get instances', details: error.message });
  }
});

// POST /api/instances - Create and load into memory
router.post('/', auth, rateLimit({ max: 10, windowMs: 60000 }), async (req, res) => {
  try {
    const instanceId = `inst_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const instanceData = {
      instanceId,
      name: req.body.name || 'WhatsApp Instance',
      description: req.body.description || '',
      userId: req.user._id,
      config: req.body.config || {}
    };

    // Use global instance manager to create (loads into memory automatically)
    if (global.instanceManager) {
      const instance = await global.instanceManager.createInstance(instanceData);
      res.status(201).json({
        message: 'Instance created and loaded into memory',
        instance
      });
    } else {
      // Fallback: Direct database creation
      const instance = new Instance({
        ...instanceData,
        serverId: 'vps-wa-plest-de',
        apiKey: require('crypto').randomBytes(32).toString('hex')
      });

      await instance.save();

      res.status(201).json({
        message: 'Instance created (memory loading may be required)',
        instance
      });
    }
  } catch (error) {
    console.error('Create instance error:', error);
    res.status(500).json({ error: 'Failed to create instance', details: error.message });
  }
});

// POST /api/instances/:instanceId/start - Start with memory check
router.post('/:instanceId/start', auth, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user._id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found in database' });
    }

    if (global.instanceManager) {
      // Check if instance is in memory, if not load it first
      if (!global.instanceManager.instances.has(req.params.instanceId)) {
        console.log(`Loading instance ${req.params.instanceId} into memory before start...`);

        try {
          const client = await global.instanceManager.createWhatsAppClient(req.params.instanceId, instance);
          global.instanceManager.instances.set(req.params.instanceId, {
            client,
            instance,
            startTime: Date.now(),
            messageCount: 0,
            lastActivity: Date.now()
          });
          console.log(`Instance ${req.params.instanceId} loaded into memory`);
        } catch (loadError) {
          console.error(`Failed to load instance ${req.params.instanceId}:`, loadError);
          return res.status(500).json({
            error: 'Failed to load instance into memory',
            details: loadError.message
          });
        }
      }

      // Now start the instance
      try {
        await global.instanceManager.startInstance(req.params.instanceId);
        res.json({
          message: 'Instance started successfully',
          instanceId: req.params.instanceId
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to start instance',
          details: error.message
        });
      }
    } else {
      res.status(500).json({
        error: 'Instance manager not available'
      });
    }
  } catch (error) {
    console.error('Start instance error:', error);
    res.status(500).json({ error: 'Failed to start instance', details: error.message });
  }
});

// GET /api/instances/:instanceId/qr
router.get('/:instanceId/qr', auth, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user._id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    res.json({
      instanceId: instance.instanceId,
      qrCode: instance.qrCode,
      status: instance.status
    });
  } catch (error) {
    console.error('Get QR error:', error);
    res.status(500).json({ error: 'Failed to get QR code', details: error.message });
  }
});

// DELETE /api/instances/:instanceId
router.delete('/:instanceId', auth, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      instanceId: req.params.instanceId,
      userId: req.user._id
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    if (global.instanceManager) {
      try {
        await global.instanceManager.deleteInstance(req.params.instanceId);
      } catch (error) {
        console.log('Instance manager delete warning:', error.message);
      }
    }

    await Instance.deleteOne({ instanceId: req.params.instanceId });

    res.json({
      message: 'Instance deleted successfully',
      instanceId: req.params.instanceId
    });
  } catch (error) {
    console.error('Delete instance error:', error);
    res.status(500).json({ error: 'Failed to delete instance', details: error.message });
  }
});

module.exports = router;