const express = require('express');
const router = express.Router();
const { param, query, validationResult } = require('express-validator');

const Instance = require('../models/Instance');
const Message = require('../models/Message');
const User = require('../models/User');
const auth = require('../middleware/auth');

// GET /api/analytics/dashboard - Dashboard-Übersicht
router.get('/dashboard', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Grundlegende Zähler
    const totalInstances = await Instance.countDocuments({ userId });
    const activeInstances = await Instance.countDocuments({
      userId,
      status: { $in: ['ready', 'connecting', 'qr_pending', 'authenticated'] }
    });

    // Nachrichten heute
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayMessages = await Message.countDocuments({
      userId,
      timestamp: { $gte: today, $lt: tomorrow }
    });

    // Erfolgsrate (letzte 24h)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const recentMessages = await Message.find({
      userId,
      timestamp: { $gte: yesterday },
      direction: 'outbound'
    });

    const successfulMessages = recentMessages.filter(msg => msg.ack >= 2).length;
    const successRate = recentMessages.length > 0 ?
      Math.round((successfulMessages / recentMessages.length) * 100) : 100;

    // Durchschnittliche Uptime
    const instances = await Instance.find({ userId, status: 'ready' });
    const avgUptime = instances.length > 0 ?
      instances.reduce((sum, inst) => sum + (inst.stats.uptime || 0), 0) / instances.length / 3600 : 0;

    // Nachrichten-Verlauf (7 Tage)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const messageHistory = await Message.aggregate([
      {
        $match: {
          userId: userId,
          timestamp: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$timestamp' },
            month: { $month: '$timestamp' },
            day: { $dayOfMonth: '$timestamp' }
          },
          sent: {
            $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] }
          },
          received: {
            $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      },
      {
        $project: {
          date: {
            $dateFromParts: {
              year: '$_id.year',
              month: '$_id.month',
              day: '$_id.day'
            }
          },
          sent: 1,
          received: 1
        }
      }
    ]);

    // Format für Frontend
    const formattedHistory = messageHistory.map(item => ({
      date: item.date.toISOString().split('T')[0],
      sent: item.sent,
      received: item.received
    }));

    res.json({
      activeInstances,
      totalInstances,
      todayMessages,
      successRate,
      avgUptime: Math.round(avgUptime * 10) / 10,
      messageHistory: formattedHistory
    });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der Dashboard-Daten', details: error.message });
  }
});

// GET /api/analytics/instances/:instanceId/detailed - Detaillierte Instanz-Statistiken
router.get('/instances/:instanceId/detailed', auth, param('instanceId').notEmpty(), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { instanceId } = req.params;
    const { period = '7d' } = req.query;

    // Instanz-Berechtigung prüfen
    const instance = await Instance.findOne({
      instanceId,
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
    const messageStats = await Message.aggregate([
      {
        $match: {
          instanceId,
          timestamp: { $gte: dateFrom }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
          received: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$ack', -1] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $gte: ['$ack', 2] }, 1, 0] } },
          read: { $sum: { $cond: [{ $gte: ['$ack', 3] }, 1, 0] } },
          media: { $sum: { $cond: ['$media.hasMedia', 1, 0] } }
        }
      }
    ]);

    // Nachrichten-Typen
    const messageTypes = await Message.aggregate([
      {
        $match: {
          instanceId,
          timestamp: { $gte: dateFrom }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Stündliche Verteilung
    const hourlyDistribution = await Message.aggregate([
      {
        $match: {
          instanceId,
          timestamp: { $gte: dateFrom }
        }
      },
      {
        $group: {
          _id: { hour: { $hour: '$timestamp' } },
          count: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
          received: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } }
        }
      },
      {
        $sort: { '_id.hour': 1 }
      },
      {
        $project: {
          hour: '$_id.hour',
          count: 1,
          sent: 1,
          received: 1
        }
      }
    ]);

    // Top-Kontakte (most active chats)
    const topContacts = await Message.aggregate([
      {
        $match: {
          instanceId,
          timestamp: { $gte: dateFrom }
        }
      },
      {
        $group: {
          _id: '$chatId',
          messageCount: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
          received: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } },
          lastMessage: { $max: '$timestamp' }
        }
      },
      {
        $sort: { messageCount: -1 }
      },
      {
        $limit: 10
      },
      {
        $project: {
          chatId: '$_id',
          messageCount: 1,
          sent: 1,
          received: 1,
          lastMessage: 1
        }
      }
    ]);

    // Response-Zeiten (Zeit zwischen eingehender und ausgehender Nachricht)
    const responseTimesData = await Message.aggregate([
      {
        $match: {
          instanceId,
          direction: 'inbound',
          timestamp: { $gte: dateFrom }
        }
      },
      {
        $lookup: {
          from: 'messages',
          let: { chatId: '$chatId', incomingTime: '$timestamp' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$instanceId', instanceId] },
                    { $eq: ['$chatId', '$$chatId'] },
                    { $eq: ['$direction', 'outbound'] },
                    { $gt: ['$timestamp', '$$incomingTime'] }
                  ]
                }
              }
            },
            { $sort: { timestamp: 1 } },
            { $limit: 1 }
          ],
          as: 'response'
        }
      },
      {
        $match: { response: { $ne: [] } }
      },
      {
        $project: {
          responseTime: {
            $subtract: [
              { $arrayElemAt: ['$response.timestamp', 0] },
              '$timestamp'
            ]
          }
        }
      }
    ]);

    const responseTimes = responseTimesData.map(item => item.responseTime / 1000 / 60); // in Minuten
    const avgResponseTime = responseTimes.length > 0 ?
      responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0;

    // Fehler-Analyse
    const errorAnalysis = await Message.aggregate([
      {
        $match: {
          instanceId,
          ack: -1,
          timestamp: { $gte: dateFrom }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    res.json({
      instance: {
        instanceId: instance.instanceId,
        name: instance.name,
        status: instance.status,
        phoneNumber: instance.phoneNumber,
        createdAt: instance.createdAt,
        lastConnected: instance.lastConnected
      },
      period,
      stats: messageStats[0] || {
        total: 0, sent: 0, received: 0, failed: 0, delivered: 0, read: 0, media: 0
      },
      messageTypes: messageTypes.map(type => ({
        type: type._id,
        count: type.count
      })),
      hourlyDistribution: Array.from({ length: 24 }, (_, hour) => {
        const data = hourlyDistribution.find(h => h.hour === hour);
        return {
          hour,
          count: data?.count || 0,
          sent: data?.sent || 0,
          received: data?.received || 0
        };
      }),
      topContacts,
      avgResponseTime: Math.round(avgResponseTime * 10) / 10,
      errorAnalysis
    });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der detaillierten Statistiken', details: error.message });
  }
});

// GET /api/analytics/system - System-weite Statistiken (nur Admins)
router.get('/system', auth, async (req, res) => {
  try {
    // Admin-Berechtigung prüfen
    const user = await User.findById(req.user.id);
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Keine Berechtigung für System-Statistiken' });
    }

    const { period = '7d' } = req.query;

    // Zeitraum berechnen
    const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 7;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    // System-Übersicht
    const systemStats = await Promise.all([
      User.countDocuments(),
      Instance.countDocuments(),
      Instance.countDocuments({ status: 'ready' }),
      Message.countDocuments({ timestamp: { $gte: dateFrom } })
    ]);

    const [totalUsers, totalInstances, activeInstances, recentMessages] = systemStats;

    // Benutzer nach Plan
    const usersByPlan = await User.aggregate([
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 }
        }
      }
    ]);

    // Instanzen nach Status
    const instancesByStatus = await Instance.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Top-Benutzer nach Aktivität
    const topUsers = await Message.aggregate([
      {
        $match: { timestamp: { $gte: dateFrom } }
      },
      {
        $group: {
          _id: '$userId',
          messageCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $project: {
          userId: '$_id',
          messageCount: 1,
          username: { $arrayElemAt: ['$user.username', 0] },
          email: { $arrayElemAt: ['$user.email', 0] }
        }
      },
      {
        $sort: { messageCount: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Server-Performance
    const serverStats = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      nodeVersion: process.version,
      platform: process.platform
    };

    // Fehler-Rate
    const errorRate = await Message.aggregate([
      {
        $match: { timestamp: { $gte: dateFrom } }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          errors: { $sum: { $cond: [{ $eq: ['$ack', -1] }, 1, 0] } }
        }
      },
      {
        $project: {
          errorRate: {
            $cond: [
              { $eq: ['$total', 0] },
              0,
              { $multiply: [{ $divide: ['$errors', '$total'] }, 100] }
            ]
          }
        }
      }
    ]);

    // Tägliche Nachrichten-Trends
    const dailyTrends = await Message.aggregate([
      {
        $match: { timestamp: { $gte: dateFrom } }
      },
      {
        $group: {
          _id: {
            year: { $year: '$timestamp' },
            month: { $month: '$timestamp' },
            day: { $dayOfMonth: '$timestamp' }
          },
          count: { $sum: 1 },
          users: { $addToSet: '$userId' }
        }
      },
      {
        $project: {
          date: {
            $dateFromParts: {
              year: '$_id.year',
              month: '$_id.month',
              day: '$_id.day'
            }
          },
          messages: '$count',
          activeUsers: { $size: '$users' }
        }
      },
      {
        $sort: { date: 1 }
      }
    ]);

    res.json({
      period,
      overview: {
        totalUsers,
        totalInstances,
        activeInstances,
        recentMessages
      },
      usersByPlan,
      instancesByStatus,
      topUsers,
      serverStats,
      errorRate: errorRate[0]?.errorRate || 0,
      dailyTrends: dailyTrends.map(trend => ({
        date: trend.date.toISOString().split('T')[0],
        messages: trend.messages,
        activeUsers: trend.activeUsers
      }))
    });

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der System-Statistiken', details: error.message });
  }
});

// GET /api/analytics/export - Daten-Export
router.get('/export', auth, query('format').optional().isIn(['json', 'csv']), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { instanceId, format = 'json', period = '30d' } = req.query;

    // Zeitraum berechnen
    const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 30;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    let query = {
      userId: req.user.id,
      timestamp: { $gte: dateFrom }
    };

    if (instanceId) {
      // Instanz-Berechtigung prüfen
      const instance = await Instance.findOne({
        instanceId,
        userId: req.user.id
      });

      if (!instance) {
        return res.status(404).json({ error: 'Instanz nicht gefunden' });
      }

      query.instanceId = instanceId;
    }

    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(10000) // Max. 10k Nachrichten
      .lean();

    if (format === 'csv') {
      const csv = [
        'Timestamp,Instance,Chat,Direction,Type,Body,Status',
        ...messages.map(msg => [
          msg.timestamp.toISOString(),
          msg.instanceId,
          msg.chatId,
          msg.direction,
          msg.type,
          `"${(msg.body || '').replace(/"/g, '""')}"`,
          msg.ack >= 2 ? 'delivered' : msg.ack === -1 ? 'failed' : 'pending'
        ].join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="messages-${Date.now()}.csv"`);
      res.send(csv);
    } else {
      res.json({
        exportDate: new Date().toISOString(),
        period,
        totalMessages: messages.length,
        messages
      });
    }

  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Exportieren der Daten', details: error.message });
  }
});

module.exports = router;