const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const path = require('path');
const cron = require('node-cron');

// Middleware und Services
const { logger } = require('./utils/logger');
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const ProductionInstanceManager = require('./services/ProductionInstanceManager');
const MetricsService = require('./services/MetricsService');

// Routes
const authRoutes = require('./routes/auth');
const instanceRoutes = require('./routes/instances');
const userRoutes = require('./routes/users');
const webhookRoutes = require('./routes/webhooks');
const analyticsRoutes = require('./routes/analytics');
const { router: proxyRoutes, setupWebSocketProxy } = require('./routes/proxy');

// Umgebungsvariablen
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Globale Variablen
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-manager';
const instanceManager = new ProductionInstanceManager();
const metricsService = new MetricsService(instanceManager);

// KRITISCH: Globalen instanceManager für Routes verfügbar machen
global.instanceManager = instanceManager;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Für React-App
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request-Logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Socket.IO Setup
io.use((socket, next) => {
  // Authentifizierung für WebSocket-Verbindungen
  const token = socket.handshake.auth.token;
  if (token) {
    // Hier würde Token-Validierung stattfinden
    next();
  } else {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('join-instance', (instanceId) => {
    socket.join(`instance-${instanceId}`);
    logger.info(`Client ${socket.id} joined instance ${instanceId}`);
  });

  socket.on('leave-instance', (instanceId) => {
    socket.leave(`instance-${instanceId}`);
    logger.info(`Client ${socket.id} left instance ${instanceId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// 🚀 KRITISCH: WebSocket-Proxy für Reverse Proxy API setup
const WhatsAppProxy = require('./services/WhatsAppProxy');
const whatsappProxy = new WhatsAppProxy(instanceManager);
setupWebSocketProxy(io, whatsappProxy);

// Instance Manager Events zu WebSocket weiterleiten
instanceManager.on('qrReceived', ({ instanceId, qr }) => {
  io.to(`instance-${instanceId}`).emit('qr-received', { instanceId, qr });
});

instanceManager.on('authenticated', ({ instanceId }) => {
  io.to(`instance-${instanceId}`).emit('authenticated', { instanceId });
});

instanceManager.on('ready', ({ instanceId, info }) => {
  io.to(`instance-${instanceId}`).emit('ready', { instanceId, info });
});

instanceManager.on('disconnected', ({ instanceId, reason }) => {
  io.to(`instance-${instanceId}`).emit('disconnected', { instanceId, reason });
});

instanceManager.on('messageReceived', ({ instanceId, message }) => {
  io.to(`instance-${instanceId}`).emit('message-received', { instanceId, message });
});

instanceManager.on('instanceCreated', ({ instanceId, instance }) => {
  io.emit('instance-created', { instanceId, instance });
});

instanceManager.on('instanceDeleted', ({ instanceId }) => {
  io.emit('instance-deleted', { instanceId });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/instances', instanceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/analytics', analyticsRoutes);

// 🚀 KRITISCH: Reverse Proxy Routes (das Hauptfeature!)
app.use('/api/proxy', proxyRoutes);

// Production Health Check
app.get('/api/health', async (req, res) => {
  try {
    const health = await metricsService.getHealthCheck();
    const statusCode = health.status === 'healthy' ? 200 :
                      health.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check endpoint error:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// Prometheus Metrics Endpoint
app.get('/metrics', async (req, res) => {
  try {
    const metrics = await metricsService.generatePrometheusMetrics();
    res.setHeader('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    logger.error('Metrics endpoint error:', error);
    res.status(500).send('# Metrics collection failed');
  }
});

// Detailed Health Endpoint (for debugging)
app.get('/api/health/detailed', authMiddleware, async (req, res) => {
  try {
    const [health, metrics] = await Promise.all([
      metricsService.getHealthCheck(),
      metricsService.collectAllMetrics()
    ]);

    res.json({
      health,
      metrics,
      instances: instanceManager.getInstances().map(id => ({
        id,
        status: instanceManager.getInstanceStatus(id)
      }))
    });
  } catch (error) {
    logger.error('Detailed health check error:', error);
    res.status(500).json({
      error: 'Failed to collect detailed health information'
    });
  }
});

// System Info
app.get('/api/system', authMiddleware, (req, res) => {
  res.json({
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    loadAverage: require('os').loadavg(),
    totalInstances: instanceManager.getInstances().length,
    activeInstances: instanceManager.getInstances().filter(id =>
      instanceManager.getInstanceStatus(id)?.status === 'ready'
    ).length
  });
});

// Static Files (Frontend)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend/build')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/build/index.html'));
  });
}

// Error Handler
app.use(errorHandler);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route nicht gefunden' });
});

// Database Connection
async function connectDatabase() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info('MongoDB verbunden');
  } catch (error) {
    logger.error('MongoDB Verbindungsfehler:', error);
    process.exit(1);
  }
}

// HINWEIS: loadStartupInstances() ist jetzt in ProductionInstanceManager.start()
// Diese Funktion wurde entfernt, da sie duplizierten Code hatte.

// Cleanup bei Exit (Production-erweitert)
async function gracefulShutdown() {
  logger.info('🔄 Graceful shutdown initiated...');

  try {
    // Production Instance Manager stoppen (macht sauberes Cleanup aller Instanzen)
    await instanceManager.stop();

    // Database-Verbindung schließen
    await mongoose.disconnect();
    logger.info('✅ Database connection closed');

    // Server schließen
    server.close(() => {
      logger.info('✅ HTTP server closed');
      logger.info('👋 Shutdown completed successfully');
      process.exit(0);
    });

    // Fallback: Force-Exit nach 30 Sekunden
    setTimeout(() => {
      logger.warn('⚠️  Forced shutdown after timeout');
      process.exit(1);
    }, 30000);

  } catch (error) {
    logger.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Cron-Jobs für Wartung
cron.schedule('0 */6 * * *', async () => {
  logger.info('Führe Wartungsaufgaben aus...');

  try {
    // Alte Nachrichten löschen (älter als 90 Tage)
    const Message = require('./models/Message');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const deletedCount = await Message.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    logger.info(`${deletedCount.deletedCount} alte Nachrichten gelöscht`);
  } catch (error) {
    logger.error('Fehler bei Wartungsaufgaben:', error);
  }
});

// Monatlicher Reset der Benutzer-Statistiken
cron.schedule('0 0 1 * *', async () => {
  logger.info('Setze monatliche Benutzer-Statistiken zurück...');

  try {
    const User = require('./models/User');
    await User.updateMany(
      {},
      {
        $set: {
          'usage.monthlyMessages': 0,
          'usage.lastReset': new Date()
        }
      }
    );

    logger.info('Monatliche Statistiken zurückgesetzt');
  } catch (error) {
    logger.error('Fehler beim Zurücksetzen der Statistiken:', error);
  }
});

// Instanz-Health-Check alle 5 Minuten
cron.schedule('*/5 * * * *', async () => {
  const instances = instanceManager.getInstances();

  for (const instanceId of instances) {
    try {
      const status = instanceManager.getInstanceStatus(instanceId);
      const instance = await require('./models/Instance').findOne({ instanceId });

      if (instance && status) {
        // Uptime und Statistiken aktualisieren
        await instance.updateStats({
          uptime: status.uptime,
          lastActivity: new Date(status.lastActivity)
        });

        // Auto-Restart bei zu langer Inaktivität
        if (instance.config.autoReconnect &&
            Date.now() - status.lastActivity > 30 * 60 * 1000) { // 30 Minuten
          logger.warn(`Instanz ${instanceId} ist inaktiv - starte neu`);
          await instanceManager.restartInstance(instanceId);
        }
      }
    } catch (error) {
      logger.error(`Health-Check Fehler für ${instanceId}:`, error);
    }
  }
});

// Process Event Handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

// Server starten (Production-erweitert)
async function startServer() {
  try {
    // Database verbinden
    await connectDatabase();

    // Production Instance Manager starten
    await instanceManager.start();

    // Server starten
    server.listen(PORT, async () => {
      logger.info(`🚀 Production WhatsApp Manager started on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      logger.info(`Max instances per server: ${instanceManager.config.maxInstances}`);

      // HINWEIS: Instance-Recovery wird bereits in instanceManager.start() gemacht!
      logger.info('✅ WhatsApp Multi-Instance Manager ready for production! 🚀');
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();