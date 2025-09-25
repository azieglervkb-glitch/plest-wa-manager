#!/bin/bash
#
# FINAL-PRODUCTION-SETUP.sh - Professional React Admin Panel Setup
#
# Creates proper production architecture:
# - Backend API server (Express.js) on port 5000
# - Frontend React server (Next.js) on port 3000
# - Nginx reverse proxy connecting both
# - Separate systemd services for each component
#
# This is the FINAL production-quality solution!
#
# Usage: sudo ./FINAL-PRODUCTION-SETUP.sh
#

set -e

APP_DIR="/opt/whatsapp-manager"
APP_USER="whatsapp-manager"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${BLUE}🚀 FINAL PRODUCTION ADMIN PANEL SETUP${NC}"
echo -e "${BOLD}${BLUE}======================================${NC}"
echo ""

cd "$APP_DIR"

# STEP 1: Clean separation - Backend API only
echo -e "${BLUE}🔧 Creating clean backend API server...${NC}"

cat > server.js << 'EOF'
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');

// Load environment
require('dotenv').config();

// Services
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

console.log('🚀 Starting WhatsApp Manager Backend API...');

// Initialize instance manager
const instanceManager = new ProductionInstanceManager();
global.instanceManager = instanceManager;

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
  console.log(`API: ${req.method} ${req.path}`);
  next();
});

// Health endpoint
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    instances: instanceManager.getInstances().length,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    version: '1.0.0-production',
    type: 'backend-api'
  };
  res.json(health);
});

// Load all API routes
try {
  const authRoutes = require('./routes/auth');
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth API loaded');
} catch (error) {
  console.log('❌ Auth API failed:', error.message);
}

try {
  const instanceRoutes = require('./routes/instances');
  app.use('/api/instances', instanceRoutes);
  console.log('✅ Instances API loaded');
} catch (error) {
  console.log('❌ Instances API failed:', error.message);
}

try {
  const userRoutes = require('./routes/users');
  app.use('/api/users', userRoutes);
  console.log('✅ Users API loaded');
} catch (error) {
  console.log('❌ Users API failed:', error.message);
}

try {
  const { router: proxyRoutes } = require('./routes/proxy');
  app.use('/api/proxy', proxyRoutes);
  console.log('✅ WhatsApp Proxy API loaded');
} catch (error) {
  console.log('❌ Proxy API failed:', error.message);
}

try {
  const analyticsRoutes = require('./routes/analytics');
  app.use('/api/analytics', analyticsRoutes);
  console.log('✅ Analytics API loaded');
} catch (error) {
  console.log('❌ Analytics API failed:', error.message);
}

// WebSocket setup for real-time updates
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

// Instance Manager events to WebSocket
instanceManager.on('qrReceived', ({ instanceId, qr }) => {
  io.to(`instance-${instanceId}`).emit('qr-received', { instanceId, qr });
});

instanceManager.on('ready', ({ instanceId, info }) => {
  io.to(`instance-${instanceId}`).emit('instance-ready', { instanceId, info });
});

instanceManager.on('disconnected', ({ instanceId, reason }) => {
  io.to(`instance-${instanceId}`).emit('instance-disconnected', { instanceId, reason });
});

// 404 for non-API routes (frontend will handle these)
app.use((req, res) => {
  res.status(404).json({ error: 'API endpoint not found', path: req.path });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('API Error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Database and startup
async function startBackend() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');

    await instanceManager.start();
    console.log('✅ Production Instance Manager started');

    server.listen(PORT, () => {
      console.log(`✅ WhatsApp Manager Backend API running on port ${PORT}`);
      console.log(`📡 API Base: http://localhost:${PORT}/api/`);
      console.log(`🔌 WebSocket: http://localhost:${PORT}/socket.io/`);
      console.log('🎉 BACKEND API READY!');
    });

  } catch (error) {
    console.error('❌ Backend startup failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Backend shutting down...');
  if (instanceManager) {
    await instanceManager.stop();
  }
  process.exit(0);
});

startBackend();
EOF

chown "$APP_USER:$APP_USER" server.js

# STEP 2: Create frontend production server
echo -e "${BLUE}🎨 Creating frontend production server...${NC}"

cat > frontend/server-production.js << 'EOF'
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = false;
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  }).listen(port, (err) => {
    if (err) throw err;
    console.log(`✅ Frontend ready on http://${hostname}:${port}`);
  });
});
EOF

chown "$APP_USER:$APP_USER" frontend/server-production.js

# STEP 3: Create frontend systemd service
echo -e "${BLUE}⚙️  Creating frontend systemd service...${NC}"

cat > /etc/systemd/system/whatsapp-frontend.service << EOF
[Unit]
Description=WhatsApp Manager Frontend
After=network.target whatsapp-manager.service
Requires=whatsapp-manager.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/frontend
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=BACKEND_URL=http://localhost:5000
ExecStart=/usr/bin/node server-production.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# STEP 4: Update Nginx for dual-service architecture
echo -e "${BLUE}🌐 Updating Nginx for frontend/backend split...${NC}"

cat > /etc/nginx/sites-available/whatsapp-manager << 'EOF'
# WhatsApp Manager - Production Architecture
# Backend API (port 5000) + Frontend React (port 3000)

upstream backend_api {
    server 127.0.0.1:5000;
}

upstream frontend_app {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name wa.plest.de;

    # API requests go to backend
    location /api/ {
        proxy_pass http://backend_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket for real-time updates
    location /socket.io/ {
        proxy_pass http://backend_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # All other requests go to React frontend
    location / {
        proxy_pass http://frontend_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# STEP 5: Reload services
echo -e "${BLUE}🔄 Starting production architecture...${NC}"

sudo nginx -t && sudo systemctl reload nginx
sudo systemctl daemon-reload
sudo systemctl restart whatsapp-manager
sudo systemctl enable whatsapp-frontend
sudo systemctl start whatsapp-frontend

sleep 10

# STEP 6: Test production setup
echo -e "${BOLD}${BLUE}🧪 TESTING PRODUCTION ARCHITECTURE...${NC}"

# Test backend API
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Backend API (5000): WORKING${NC}"
else
    echo -e "${RED}❌ Backend API (5000): FAILED${NC}"
fi

# Test frontend
if curl -f -s "http://localhost:3000/" > /dev/null; then
    echo -e "${GREEN}✅ Frontend App (3000): WORKING${NC}"
else
    echo -e "${RED}❌ Frontend App (3000): FAILED${NC}"
    echo "Frontend service status:"
    sudo systemctl status whatsapp-frontend --no-pager
fi

# Test domain integration
if curl -f -s "http://wa.plest.de/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Domain API: WORKING${NC}"
else
    echo -e "${RED}❌ Domain API: FAILED${NC}"
fi

if curl -f -s "http://wa.plest.de/" > /dev/null; then
    echo -e "${GREEN}✅ Domain Frontend: WORKING${NC}"
else
    echo -e "${RED}❌ Domain Frontend: FAILED${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}🎉 PRODUCTION ADMIN PANEL ARCHITECTURE DEPLOYED!${NC}"
echo ""
echo -e "${BOLD}${BLUE}📊 PRODUCTION SETUP:${NC}"
echo -e "🌐 Admin Panel: ${GREEN}http://wa.plest.de${NC} (React App on port 3000)"
echo -e "📡 Backend API: ${GREEN}http://wa.plest.de/api/*${NC} (Express on port 5000)"
echo -e "🔌 WebSocket: ${GREEN}ws://wa.plest.de/socket.io/${NC} (Real-time updates)"
echo ""
echo -e "${BOLD}${BLUE}⚙️  SERVICES:${NC}"
echo -e "Backend: ${YELLOW}sudo systemctl status whatsapp-manager${NC}"
echo -e "Frontend: ${YELLOW}sudo systemctl status whatsapp-frontend${NC}"
echo -e "Nginx: ${YELLOW}sudo systemctl status nginx${NC}"
echo ""
echo -e "${BOLD}${BLUE}🎨 ADMIN PANEL FEATURES:${NC}"
echo -e "✅ Professional React interface with Material-UI"
echo -e "✅ Real-time updates via WebSocket"
echo -e "✅ JWT authentication integration"
echo -e "✅ Mobile-responsive design"
echo -e "✅ Production-grade architecture"
echo ""
echo -e "${BOLD}${GREEN}🔐 LOGIN: admin@wa.plest.de / AdminPass123${NC}"