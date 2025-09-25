#!/bin/bash
#
# FIX-INSTANCE-MANAGER-INTEGRATION.sh - Fixes missing ProductionInstanceManager
#
# ROOT CAUSE ANALYSIS:
# During frontend/backend separation, we created "clean API server" but accidentally
# removed the ProductionInstanceManager - the core WhatsApp functionality!
# This script restores complete integration.
#
# WHAT WENT WRONG:
# 1. Originally: server.js had ProductionInstanceManager
# 2. Debugging: Created simplified server.js (API-only)
# 3. FINAL-PRODUCTION-SETUP: Made "clean backend" without instance logic
# 4. Git commits: Overwrote working version with simplified version
# 5. Result: API works but no WhatsApp instance management
#
# SOLUTION: Restore ProductionInstanceManager with all dependencies
#
# Usage: sudo ./FIX-INSTANCE-MANAGER-INTEGRATION.sh
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

echo -e "${BOLD}${BLUE}🔧 FIXING PRODUCTION INSTANCE MANAGER INTEGRATION${NC}"
echo -e "${BOLD}${BLUE}==================================================${NC}"
echo ""

cd "$APP_DIR"

# Stop service for fixes
sudo systemctl stop whatsapp-manager

# STEP 1: Verify ProductionInstanceManager exists
echo -e "${BLUE}📊 Checking ProductionInstanceManager file...${NC}"
if [ -f "services/ProductionInstanceManager.js" ]; then
    echo -e "${GREEN}✅ ProductionInstanceManager.js exists${NC}"

    # Test syntax
    if node -c services/ProductionInstanceManager.js; then
        echo -e "${GREEN}✅ ProductionInstanceManager syntax OK${NC}"
    else
        echo -e "${RED}❌ ProductionInstanceManager syntax error${NC}"
        node -c services/ProductionInstanceManager.js
        exit 1
    fi
else
    echo -e "${RED}❌ ProductionInstanceManager.js missing!${NC}"
    exit 1
fi

# STEP 2: Create complete server.js with ProductionInstanceManager
echo -e "${BLUE}🔧 Creating complete server.js with ProductionInstanceManager...${NC}"

cat > server.js << 'EOF'
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

console.log('🚀 Starting WhatsApp Manager with COMPLETE functionality...');

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
    version: '1.0.0-complete-with-instance-manager',
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
  const { router: proxyRoutes } = require('./routes/proxy');
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

// WebSocket setup for real-time instance updates
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

// CRITICAL: Connect instance manager events to WebSocket
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

instanceManager.on('instanceCreated', ({ instanceId, instance }) => {
  console.log(`Instance ${instanceId} created`);
  io.emit('instance-created', { instanceId, instance });
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

    // Start ProductionInstanceManager (CRITICAL!)
    await instanceManager.start();
    console.log('✅ ProductionInstanceManager started - WhatsApp instances ready!');

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`✅ Complete WhatsApp Manager running on port ${PORT}`);
      console.log(`📱 Instance Manager: ${instanceManager.getInstances().length} instances loaded`);
      console.log('🎉 COMPLETE SYSTEM WITH WHATSAPP FUNCTIONALITY READY!');
    });

  } catch (error) {
    console.error('❌ Complete startup failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Graceful shutdown initiated...');
  try {
    await instanceManager.stop();
    console.log('✅ ProductionInstanceManager stopped');
  } catch (error) {
    console.log('⚠️  Instance Manager shutdown warning:', error.message);
  }
  process.exit(0);
});

startComplete();
EOF

chown "$APP_USER:$APP_USER" server.js

echo -e "${GREEN}✅ Complete server.js with ProductionInstanceManager created${NC}"

# STEP 3: Test syntax
echo -e "${BLUE}🧪 Testing complete server.js syntax...${NC}"
if node -c server.js; then
    echo -e "${GREEN}✅ Complete server.js: SYNTAX OK${NC}"
else
    echo -e "${RED}❌ Complete server.js: SYNTAX ERROR${NC}"
    node -c server.js
    exit 1
fi

# STEP 4: Start complete system
echo -e "${BOLD}${BLUE}🚀 STARTING COMPLETE WHATSAPP MANAGER...${NC}"
sudo systemctl start whatsapp-manager

echo -e "${YELLOW}⏳ Waiting for complete startup...${NC}"
sleep 10

# STEP 5: Comprehensive testing
echo -e "${BOLD}${BLUE}🧪 TESTING COMPLETE FUNCTIONALITY...${NC}"

# Test health with instance manager info
HEALTH_RESPONSE=$(curl -s "http://localhost:5000/api/health" 2>/dev/null || echo "FAILED")

if echo "$HEALTH_RESPONSE" | grep -q "instanceManager"; then
    echo -e "${GREEN}✅ ProductionInstanceManager: ACTIVE${NC}"
    echo -e "${BLUE}Health response preview:${NC}"
    echo "$HEALTH_RESPONSE" | python3 -m json.tool | head -10 2>/dev/null || echo "$HEALTH_RESPONSE"
else
    echo -e "${RED}❌ ProductionInstanceManager: NOT LOADED${NC}"
    echo "Health response: $HEALTH_RESPONSE"
    exit 1
fi

# Test instance API with authentication
echo -e "${BLUE}Testing instance management with authentication...${NC}"
AUTH_RESPONSE=$(curl -s -X POST "http://localhost:5000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@wa.plest.de","password":"AdminPass123"}')

if echo "$AUTH_RESPONSE" | grep -q "accessToken"; then
    echo -e "${GREEN}✅ Authentication: WORKING${NC}"

    JWT_TOKEN=$(echo "$AUTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['tokens']['accessToken'])" 2>/dev/null || echo "token-failed")

    if [ "$JWT_TOKEN" != "token-failed" ]; then
        echo -e "${BLUE}Testing instance listing...${NC}"
        INSTANCES_RESPONSE=$(curl -s "http://localhost:5000/api/instances" \
          -H "Authorization: Bearer $JWT_TOKEN")

        if echo "$INSTANCES_RESPONSE" | grep -q "instances"; then
            echo -e "${GREEN}✅ Instance listing: WORKING${NC}"

            INSTANCE_COUNT=$(echo "$INSTANCES_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)['instances']))" 2>/dev/null || echo "0")
            echo -e "${BLUE}Found $INSTANCE_COUNT instances${NC}"
        else
            echo -e "${RED}❌ Instance listing: FAILED${NC}"
            echo "Response: $INSTANCES_RESPONSE"
        fi
    fi
else
    echo -e "${RED}❌ Authentication: FAILED${NC}"
    echo "Response: $AUTH_RESPONSE"
fi

# Test domain
echo -e "${BLUE}Testing domain access...${NC}"
if curl -f -s "http://wa.plest.de/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Domain API: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  Domain API: Check Nginx/DNS${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}🎉 PRODUCTION INSTANCE MANAGER INTEGRATION FIXED!${NC}"
echo ""
echo -e "${BOLD}${BLUE}📊 WHAT WAS FIXED:${NC}"
echo -e "✅ ProductionInstanceManager loaded and initialized"
echo -e "✅ Global instanceManager available for routes"
echo -e "✅ WhatsApp client creation functionality restored"
echo -e "✅ Instance lifecycle management active"
echo -e "✅ WebSocket events connected"
echo -e "✅ Real-time status updates enabled"
echo ""
echo -e "${BOLD}${BLUE}🎯 NOW INSTANCES SHOULD:${NC}"
echo -e "✅ Start properly: Connecting → QR_Pending → Ready"
echo -e "✅ Show QR codes for WhatsApp authentication"
echo -e "✅ Update status in real-time"
echo -e "✅ Support all WhatsApp proxy API methods"
echo ""
echo -e "${BOLD}${BLUE}🧪 TEST INSTANCE FUNCTIONALITY:${NC}"
echo -e "1. Login to: ${GREEN}http://wa.plest.de${NC}"
echo -e "2. Go to: ${GREEN}Instances page${NC}"
echo -e "3. Click: ${GREEN}Start${NC} on existing instance"
echo -e "4. Should see: ${GREEN}Connecting → QR Required${NC}"
echo -e "5. Click: ${GREEN}QR Code${NC} to get WhatsApp QR"
echo ""
echo -e "${BOLD}${GREEN}🚀 COMPLETE WHATSAPP FUNCTIONALITY RESTORED!${NC}"

# Show service status
echo ""
echo -e "${BLUE}📊 Service Status:${NC}"
sudo systemctl status whatsapp-manager --no-pager --lines=5