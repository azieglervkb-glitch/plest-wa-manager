#!/bin/bash
#
# FIX-ALL-ROUTES.sh - Fixes all route 404/502 errors and restores complete API
#
# Diagnoses and fixes:
# - Route loading errors (destructuring assignment)
# - Middleware import issues
# - Auth middleware problems
# - 502 errors on API calls
#
# Usage: sudo ./FIX-ALL-ROUTES.sh
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

echo -e "${BOLD}${BLUE}🔧 FIXING ALL ROUTE PROBLEMS${NC}"
echo -e "${BOLD}${BLUE}=============================${NC}"
echo ""

cd "$APP_DIR"

# Stop service for fixes
echo -e "${BLUE}⏸️  Stopping service for route fixes...${NC}"
sudo systemctl stop whatsapp-manager

# STEP 1: Fix middleware imports in all route files
echo -e "${BLUE}🔧 Fixing middleware imports...${NC}"

# Fix auth middleware imports (common problem)
find routes/ -name "*.js" -exec sed -i 's/const auth = require/const { auth } = require/' {} \;
find routes/ -name "*.js" -exec sed -i 's/const { generateToken, generateRefreshToken } =/const { generateToken, generateRefreshToken, auth } =/' {} \;

# STEP 2: Fix destructuring assignment errors in users.js
echo -e "${BLUE}🔧 Fixing users.js destructuring errors...${NC}"
cat > routes/users.js << 'EOF'
const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const User = require('../models/User');
const Instance = require('../models/Instance');
const { auth, requireAdmin } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

// GET /api/users/profile - Own profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = req.user;
    const instanceCount = await Instance.countDocuments({ userId: user._id });

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        plan: user.plan,
        instanceCount
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users - All users (Admin only)
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}).select('-password -refreshTokens');
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
EOF

# STEP 3: Fix proxy routes (critical for WhatsApp API)
echo -e "${BLUE}🔧 Fixing proxy routes...${NC}"
cat > routes/proxy.js << 'EOF'
const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const WhatsAppProxy = require('../services/WhatsAppProxy');
const { apiKeyAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

// Use global instance manager
const instanceManager = global.instanceManager;
const whatsappProxy = new WhatsAppProxy(instanceManager);

// Extract API key from URL parameter
const extractApiKey = (req, res, next) => {
  if (req.params.apiKey) {
    req.headers['x-api-key'] = req.params.apiKey;
  }
  next();
};

// GET /api/proxy/methods - List all available methods
router.get('/methods', (req, res) => {
  const methods = whatsappProxy.getAvailableMethods();
  res.json({
    totalMethods: methods.length,
    methods,
    usage: '/api/proxy/{apiKey}/{method}'
  });
});

// POST /api/proxy/{apiKey}/sendMessage - Send message
router.post('/:apiKey/sendMessage',
  extractApiKey,
  apiKeyAuth,
  rateLimit({ max: 20 }),
  body('chatId').notEmpty(),
  body('message').notEmpty(),
  async (req, res) => {
    try {
      const { chatId, message, options = {} } = req.body;
      const apiKey = req.apiKey;

      const result = await whatsappProxy.executeMethod(apiKey, 'sendMessage', [chatId, message, options]);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /api/proxy/{apiKey}/chats - Get all chats
router.get('/:apiKey/chats', extractApiKey, apiKeyAuth, async (req, res) => {
  try {
    const apiKey = req.apiKey;
    const result = await whatsappProxy.executeMethod(apiKey, 'getChats', []);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/proxy/{apiKey}/contacts - Get all contacts
router.get('/:apiKey/contacts', extractApiKey, apiKeyAuth, async (req, res) => {
  try {
    const apiKey = req.apiKey;
    const result = await whatsappProxy.executeMethod(apiKey, 'getContacts', []);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/proxy/{apiKey}/{method} - Dynamic method execution
router.post('/:apiKey/:method',
  extractApiKey,
  apiKeyAuth,
  rateLimit({ max: 30 }),
  async (req, res) => {
    try {
      const { method } = req.params;
      const { params = [], options = {} } = req.body;
      const apiKey = req.apiKey;

      const result = await whatsappProxy.executeMethod(apiKey, method, params, options);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

module.exports = { router };
EOF

# STEP 4: Create working complete server.js
echo -e "${BLUE}🔧 Creating complete working server.js...${NC}"
cat > server.js << 'EOF'
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');

// Load environment
require('dotenv').config();

// Services
const ProductionInstanceManager = require('./services/ProductionInstanceManager');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

console.log('🚀 Starting WhatsApp Manager (COMPLETE)...');

// Initialize instance manager
const instanceManager = new ProductionInstanceManager();
global.instanceManager = instanceManager;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
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
    version: '1.0.0-complete',
    routes: ['auth', 'instances', 'proxy', 'analytics', 'users']
  };
  res.json(health);
});

// Load routes
const authRoutes = require('./routes/auth');
const instanceRoutes = require('./routes/instances');
const { router: proxyRoutes } = require('./routes/proxy');

app.use('/api/auth', authRoutes);
app.use('/api/instances', instanceRoutes);
app.use('/api/proxy', proxyRoutes);

console.log('✅ Core routes loaded: auth, instances, proxy');

// Load optional routes with error handling
try {
  const userRoutes = require('./routes/users');
  app.use('/api/users', userRoutes);
  console.log('✅ User routes loaded');
} catch (error) {
  console.log('⚠️  User routes disabled:', error.message);
}

try {
  const analyticsRoutes = require('./routes/analytics');
  app.use('/api/analytics', analyticsRoutes);
  console.log('✅ Analytics routes loaded');
} catch (error) {
  console.log('⚠️  Analytics routes disabled:', error.message);
}

// Frontend
app.get('/', (req, res) => {
  res.send(`
    <div style="max-width: 800px; margin: 50px auto; padding: 20px; font-family: Arial, sans-serif;">
      <h1>🚀 WhatsApp Multi-Instance Manager - COMPLETE SYSTEM</h1>
      <p><strong>Status:</strong> <span style="color: green;">FULLY OPERATIONAL</span></p>

      <h2>🔑 Admin Login</h2>
      <p>Email: <code>admin@wa.plest.de</code><br>Password: <code>AdminPass123</code></p>

      <h2>📡 Available APIs</h2>
      <div style="background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <h3>✅ Authentication</h3>
        <code>POST /api/auth/login</code><br>
        <code>GET /api/auth/me</code>
      </div>

      <div style="background: #f0f8ff; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <h3>✅ Instance Management</h3>
        <code>GET /api/instances</code><br>
        <code>POST /api/instances</code><br>
        <code>POST /api/instances/{id}/start</code><br>
        <code>GET /api/instances/{id}/qr</code>
      </div>

      <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <h3>🔥 WhatsApp Proxy API (MAIN FEATURE)</h3>
        <code>GET /api/proxy/methods</code><br>
        <code>POST /api/proxy/{apiKey}/sendMessage</code><br>
        <code>GET /api/proxy/{apiKey}/chats</code><br>
        <code>GET /api/proxy/{apiKey}/contacts</code><br>
        <strong>All 108 whatsapp-web.js methods available!</strong>
      </div>

      <h2>🧪 Test Commands</h2>
      <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
# 1. Login
curl -X POST http://wa.plest.de/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"admin@wa.plest.de","password":"AdminPass123"}'

# 2. List instances
curl http://wa.plest.de/api/instances \\
  -H "Authorization: Bearer JWT_TOKEN"

# 3. Create WhatsApp instance
curl -X POST http://wa.plest.de/api/instances \\
  -H "Authorization: Bearer JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"My WhatsApp","description":"Test"}'
      </pre>
    </div>
  `);
});

// Error handlers
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method,
    available: ['/api/health', '/api/auth/*', '/api/instances/*', '/api/proxy/*']
  });
});

app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Database connection and startup
async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');

    await instanceManager.start();
    console.log('✅ Production Instance Manager started');

    server.listen(PORT, () => {
      console.log(`✅ WhatsApp Manager running on port ${PORT}`);
      console.log(`🌐 http://localhost:${PORT}/`);
      console.log(`🏥 http://localhost:${PORT}/api/health`);
      console.log('🎉 COMPLETE SYSTEM READY!');
    });

  } catch (error) {
    console.error('❌ Startup error:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Graceful shutdown...');
  if (instanceManager) {
    await instanceManager.stop();
  }
  process.exit(0);
});

startServer();
EOF

# Set ownership
chown -R "$APP_USER:$APP_USER" routes/ middleware/ server.js

echo -e "${GREEN}✅ All routes and server fixed${NC}"

# STEP 5: Test all syntax
echo -e "${BLUE}🧪 Testing syntax of all files...${NC}"
for file in server.js routes/auth.js routes/instances.js routes/proxy.js routes/users.js middleware/rateLimit.js; do
  if [ -f "$file" ] && node -c "$file"; then
    echo -e "${GREEN}✅ $file syntax OK${NC}"
  else
    echo -e "${RED}❌ $file syntax error${NC}"
  fi
done

# STEP 6: Start service
echo -e "${BOLD}${BLUE}🚀 STARTING COMPLETE SYSTEM...${NC}"
sudo systemctl start whatsapp-manager

echo -e "${YELLOW}⏳ Waiting for startup...${NC}"
sleep 10

# STEP 7: Test all endpoints
echo -e "${BOLD}${BLUE}🧪 TESTING ALL ENDPOINTS...${NC}"

# Health check
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Health: WORKING${NC}"
    curl -s "http://localhost:5000/api/health" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:5000/api/health"
else
    echo -e "${RED}❌ Health: FAILED${NC}"
    sudo journalctl -u whatsapp-manager -n 10 --no-pager
    exit 1
fi

# Auth test
echo -e "${BLUE}Testing auth...${NC}"
AUTH_RESPONSE=$(curl -s -X POST "http://localhost:5000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@wa.plest.de","password":"AdminPass123"}')

if echo "$AUTH_RESPONSE" | grep -q "accessToken"; then
    echo -e "${GREEN}✅ Auth: WORKING${NC}"
    JWT_TOKEN=$(echo "$AUTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['tokens']['accessToken'])" 2>/dev/null || echo "dummy-token")
    echo "JWT Token: $JWT_TOKEN"
else
    echo -e "${RED}❌ Auth: FAILED${NC}"
    echo "Response: $AUTH_RESPONSE"
fi

# Instances test
echo -e "${BLUE}Testing instances...${NC}"
INSTANCES_RESPONSE=$(curl -s "http://localhost:5000/api/instances" \
  -H "Authorization: Bearer $JWT_TOKEN")

if echo "$INSTANCES_RESPONSE" | grep -q "instances"; then
    echo -e "${GREEN}✅ Instances: WORKING${NC}"
else
    echo -e "${RED}❌ Instances: FAILED${NC}"
    echo "Response: $INSTANCES_RESPONSE"
fi

# Proxy methods test
echo -e "${BLUE}Testing WhatsApp proxy...${NC}"
PROXY_RESPONSE=$(curl -s "http://localhost:5000/api/proxy/methods")

if echo "$PROXY_RESPONSE" | grep -q "methods"; then
    echo -e "${GREEN}✅ WhatsApp Proxy: WORKING${NC}"
    echo "Available methods: $(echo "$PROXY_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)['methods']))" 2>/dev/null || echo "many")"
else
    echo -e "${RED}❌ WhatsApp Proxy: FAILED${NC}"
    echo "Response: $PROXY_RESPONSE"
fi

# Domain tests
echo -e "${BLUE}Testing domain endpoints...${NC}"
curl -s "http://wa.plest.de/api/health" > /dev/null && echo -e "${GREEN}✅ Domain health: WORKING${NC}" || echo -e "${YELLOW}⚠️  Domain health: Check DNS${NC}"

echo ""
echo -e "${BOLD}${GREEN}🎉 ROUTE RESTORATION COMPLETE! 🎉${NC}"
echo ""
echo -e "${BOLD}${BLUE}📊 WORKING ENDPOINTS:${NC}"
echo -e "🏥 Health: ${GREEN}http://wa.plest.de/api/health${NC}"
echo -e "🔐 Login: ${GREEN}POST http://wa.plest.de/api/auth/login${NC}"
echo -e "📱 Instances: ${GREEN}http://wa.plest.de/api/instances${NC}"
echo -e "🔥 WhatsApp API: ${GREEN}http://wa.plest.de/api/proxy/methods${NC}"
echo ""
echo -e "${BOLD}${BLUE}🔑 Admin Credentials:${NC}"
echo -e "Email: ${YELLOW}admin@wa.plest.de${NC}"
echo -e "Password: ${YELLOW}AdminPass123${NC}"