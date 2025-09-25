const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');

// Load environment
require('dotenv').config();

// CRITICAL: Load ProductionInstanceManager for WhatsApp functionality
const ProductionInstanceManager = require('./services/ProductionInstanceManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://wa.plest.de", "https://wa.plest.de"],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

console.log('🚀 Starting WhatsApp Manager (PRODUCTION)...');

// CRITICAL: Initialize ProductionInstanceManager
const instanceManager = new ProductionInstanceManager();
global.instanceManager = instanceManager;

console.log('✅ ProductionInstanceManager initialized');

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: ["http://localhost:3000", "http://wa.plest.de", "https://wa.plest.de"],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} API: ${req.method} ${req.path}`);
  next();
});

// Health endpoint with instance manager info
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    instances: instanceManager.getInstances().length,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    version: '1.0.0-production-stable',
    instanceManager: 'ProductionInstanceManager active'
  };
  res.json(health);
});

// Load API routes
try {
  const authRoutes = require('./routes/auth');
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes loaded');
} catch (error) {
  console.log('❌ Auth routes failed:', error.message);
}

try {
  const instanceRoutes = require('./routes/instances');
  app.use('/api/instances', instanceRoutes);
  console.log('✅ Instance routes loaded');
} catch (error) {
  console.log('❌ Instance routes failed:', error.message);
}

try {
  const userRoutes = require('./routes/users');
  app.use('/api/users', userRoutes);
  console.log('✅ User routes loaded');
} catch (error) {
  console.log('❌ User routes failed:', error.message);
}

try {
  const proxyRoutes = require('./routes/proxy');
  app.use('/api/proxy', proxyRoutes);
  console.log('✅ WhatsApp Proxy routes loaded');
} catch (error) {
  console.log('❌ Proxy routes failed:', error.message);
}

try {
  const analyticsRoutes = require('./routes/analytics');
  app.use('/api/analytics', analyticsRoutes);
  console.log('✅ Analytics routes loaded');
} catch (error) {
  console.log('❌ Analytics routes failed:', error.message);
}

try {
  const webhookRoutes = require('./routes/webhooks');
  app.use('/api/webhooks', webhookRoutes);
  console.log('✅ Webhook routes loaded');
} catch (error) {
  console.log('❌ Webhook routes failed:', error.message);
}

// Simple WebSocket setup (no complex proxy setup)
io.on('connection', (socket) => {
  console.log('Frontend connected:', socket.id);

  socket.on('join-instance', (instanceId) => {
    socket.join(`instance-${instanceId}`);
    console.log(`Socket joined instance: ${instanceId}`);
  });

  socket.on('disconnect', () => {
    console.log('Frontend disconnected:', socket.id);
  });
});

// Connect instance manager events to WebSocket
instanceManager.on('qrReceived', ({ instanceId, qr }) => {
  console.log(`QR received for instance ${instanceId}`);
  io.to(`instance-${instanceId}`).emit('qr-received', { instanceId, qr });
});

instanceManager.on('ready', ({ instanceId, info }) => {
  console.log(`Instance ${instanceId} ready`);
  io.to(`instance-${instanceId}`).emit('instance-ready', { instanceId, info });
});

instanceManager.on('disconnected', ({ instanceId, reason }) => {
  console.log(`Instance ${instanceId} disconnected: ${reason}`);
  io.to(`instance-${instanceId}`).emit('instance-disconnected', { instanceId, reason });
});

// Error handlers
app.use((req, res) => {
  res.status(404).json({ error: 'API endpoint not found', path: req.path });
});

app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Database and startup
async function startComplete() {
  try {
    // Connect to database
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');

    // Start ProductionInstanceManager
    await instanceManager.start();
    console.log('✅ ProductionInstanceManager started - WhatsApp ready!');

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`✅ WhatsApp Manager (PRODUCTION) running on port ${PORT}`);
      console.log(`📱 Instances in memory: ${instanceManager.getInstances().length}`);
      console.log('🎉 PRODUCTION SYSTEM READY!');
    });

  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Graceful shutdown...');
  try {
    await instanceManager.stop();
    console.log('✅ Instance Manager stopped');
  } catch (error) {
    console.log('⚠️  Shutdown warning:', error.message);
  }
  process.exit(0);
});

// Serve React frontend from backend (production solution)
const path = require('path');

// Serve static files from Next.js build
app.use('/_next/static', express.static(path.join(__dirname, 'frontend/.next/static')));
app.use('/static', express.static(path.join(__dirname, 'frontend/.next/static')));

// Serve React app for all non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }

  // Try to serve static HTML from Next.js build
  const indexPath = path.join(__dirname, 'frontend/.next/server/pages/index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Fallback: Serve React login redirect
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp Manager</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body>
          <div id="root">
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: Arial;">
              <div style="text-align: center;">
                <h1>WhatsApp Manager</h1>
                <p>Loading admin panel...</p>
                <script>
                  setTimeout(() => {
                    fetch('/api/health')
                      .then(r => r.json())
                      .then(data => {
                        if (data.status === 'healthy') {
                          window.location.href = '/login';
                        }
                      })
                      .catch(() => {
                        document.body.innerHTML = '<h1>System Starting...</h1><p>Please wait and refresh.</p>';
                      });
                  }, 1000);
                </script>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
  }
});

console.log('✅ React frontend serving enabled');

startComplete();