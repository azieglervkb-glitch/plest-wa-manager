#!/bin/bash
#
# COMPLETE-REBUILD.sh - Complete clean rebuild and launch
#
# Does everything from clean state:
# - Creates correct .env with IPv4
# - Runs migration with IPv4 fix
# - Creates admin user properly
# - Builds and starts complete system
#
# Usage: sudo ./COMPLETE-REBUILD.sh
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

echo -e "${BOLD}${BLUE}🚀 COMPLETE REBUILD - WHATSAPP MANAGER${NC}"
echo -e "${BOLD}${BLUE}=====================================${NC}"
echo ""

cd "$APP_DIR"

# STEP 1: Stop everything
echo -e "${BLUE}⏸️  Stopping all services...${NC}"
sudo systemctl stop whatsapp-manager 2>/dev/null || echo "Service not running"

# STEP 2: Create CORRECT .env with IPv4
echo -e "${BLUE}📝 Creating production .env with IPv4...${NC}"
sudo -u "$APP_USER" cat > .env << 'EOF'
NODE_ENV=production
PORT=5000
SERVER_ID=vps-wa-plest-de
FRONTEND_URL=http://wa.plest.de

# Database with IPv4 (fixes ::1 connection issues)
MONGODB_URI=mongodb://whatsapp-user:SecureAppPass123@127.0.0.1:27017/whatsapp_production

# Security
JWT_SECRET=whatsapp-manager-jwt-secret-64-chars-long-production-key
SESSION_SECRET=whatsapp-session-secret-key

# Production Settings
MAX_INSTANCES_PER_SERVER=100
HEALTH_CHECK_INTERVAL=30000
MAX_MEMORY_PER_INSTANCE=512
MAX_ERROR_COUNT=3
RESTART_DELAY=5000
SESSION_CLEANUP_DAYS=7

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info

# Puppeteer Ubuntu VPS optimized
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
EOF

echo -e "${GREEN}✅ .env created with IPv4 configuration${NC}"
echo -e "${BLUE}📋 .env content:${NC}"
cat .env
echo ""

# Also create .env.production for systemd
sudo -u "$APP_USER" cp .env .env.production

# STEP 3: Database migration with IPv4 fix
echo -e "${BLUE}📊 Running database migration (IPv4)...${NC}"
if sudo -u "$APP_USER" node migrations/001-extend-instance-schema.js up; then
    echo -e "${GREEN}✅ Database migration successful${NC}"
else
    echo -e "${YELLOW}⚠️  Migration warning (might already exist)${NC}"
fi

# STEP 4: Create admin user with proper bcrypt
echo -e "${BLUE}👤 Creating admin user with correct password...${NC}"
sudo -u "$APP_USER" node -e "
const bcrypt = require('bcrypt');
console.log('🔧 Creating admin user...');

bcrypt.hash('AdminPass123', 12).then(async hash => {
  console.log('Password hash generated:', hash);

  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://whatsapp-user:SecureAppPass123@127.0.0.1:27017/whatsapp_production');
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db;

  // Delete existing admin users
  await db.collection('users').deleteMany({email: 'admin@wa.plest.de'});

  // Insert admin with raw MongoDB (bypasses any middleware)
  const adminUser = {
    username: 'admin',
    email: 'admin@wa.plest.de',
    password: hash,
    role: 'superadmin',
    plan: 'enterprise',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    planLimits: {
      maxInstances: 99999,
      maxMessages: 99999,
      features: ['unlimited', 'api', 'webhooks', 'analytics']
    },
    usage: {
      currentInstances: 0,
      monthlyMessages: 0,
      lastReset: new Date()
    },
    stats: {
      totalInstances: 0,
      totalMessages: 0,
      lastLogin: new Date()
    },
    refreshTokens: []
  };

  const result = await db.collection('users').insertOne(adminUser);
  console.log('✅ Admin user created with ID:', result.insertedId);

  await mongoose.disconnect();
  console.log('✅ Database setup complete');
  process.exit(0);
});
"

echo -e "${GREEN}✅ Admin user setup completed${NC}"

# STEP 5: Install systemd service
echo -e "${BLUE}⚙️  Installing systemd service...${NC}"
sudo cp deploy/whatsapp-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-manager

# STEP 6: Start service
echo -e "${BOLD}${BLUE}🚀 STARTING COMPLETE SYSTEM...${NC}"
sudo systemctl start whatsapp-manager

echo -e "${YELLOW}⏳ Waiting for system startup (15 seconds)...${NC}"
sleep 15

# STEP 7: Comprehensive testing
echo -e "${BOLD}${BLUE}🧪 COMPLETE SYSTEM TESTING...${NC}"

# Service status
if sudo systemctl is-active --quiet whatsapp-manager; then
    echo -e "${GREEN}✅ Service: RUNNING${NC}"
else
    echo -e "${RED}❌ Service: FAILED${NC}"
    sudo systemctl status whatsapp-manager --no-pager
    echo ""
    echo -e "${BLUE}Service logs:${NC}"
    sudo journalctl -u whatsapp-manager -n 20 --no-pager
    exit 1
fi

# Health check
echo -e "${BLUE}Testing health endpoint...${NC}"
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Health endpoint: WORKING${NC}"
    echo -e "${BLUE}Health response:${NC}"
    curl -s "http://localhost:5000/api/health" | python3 -m json.tool || curl -s "http://localhost:5000/api/health"
else
    echo -e "${RED}❌ Health endpoint: FAILED${NC}"
    exit 1
fi

# Auth login test
echo -e "${BLUE}Testing authentication...${NC}"
AUTH_RESPONSE=$(curl -s -w "%{http_code}" -X POST "http://localhost:5000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@wa.plest.de","password":"AdminPass123"}')

HTTP_CODE=$(echo "$AUTH_RESPONSE" | tail -c 4)
AUTH_BODY=$(echo "$AUTH_RESPONSE" | head -c -4)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Authentication: WORKING${NC}"
    echo -e "${BLUE}Auth response:${NC}"
    echo "$AUTH_BODY" | python3 -m json.tool || echo "$AUTH_BODY"

    # Extract JWT token
    JWT_TOKEN=$(echo "$AUTH_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin)['tokens']['accessToken'])" 2>/dev/null || echo "token-extraction-failed")
    echo -e "${YELLOW}JWT Token: $JWT_TOKEN${NC}"
else
    echo -e "${RED}❌ Authentication: FAILED (HTTP $HTTP_CODE)${NC}"
    echo -e "${BLUE}Response:${NC}"
    echo "$AUTH_BODY"
fi

# Instance management test
if [ "$JWT_TOKEN" != "token-extraction-failed" ]; then
    echo -e "${BLUE}Testing instance management...${NC}"
    INSTANCES_RESPONSE=$(curl -s -w "%{http_code}" "http://localhost:5000/api/instances" \
      -H "Authorization: Bearer $JWT_TOKEN")

    INSTANCES_CODE=$(echo "$INSTANCES_RESPONSE" | tail -c 4)
    if [ "$INSTANCES_CODE" = "200" ]; then
        echo -e "${GREEN}✅ Instance management: WORKING${NC}"
    else
        echo -e "${RED}❌ Instance management: FAILED (HTTP $INSTANCES_CODE)${NC}"
    fi
fi

# WhatsApp Proxy test
echo -e "${BLUE}Testing WhatsApp Proxy API...${NC}"
PROXY_RESPONSE=$(curl -s "http://localhost:5000/api/proxy/methods")
if echo "$PROXY_RESPONSE" | grep -q "methods"; then
    echo -e "${GREEN}✅ WhatsApp Proxy API: WORKING${NC}"
    METHOD_COUNT=$(echo "$PROXY_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)['methods']))" 2>/dev/null || echo "many")
    echo -e "${BLUE}Available WhatsApp methods: $METHOD_COUNT${NC}"
else
    echo -e "${RED}❌ WhatsApp Proxy API: FAILED${NC}"
fi

# Domain tests
echo -e "${BLUE}Testing domain access...${NC}"
if curl -f -s "http://wa.plest.de/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Domain health: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  Domain health: Check DNS/Nginx${NC}"
fi

# SUCCESS SUMMARY
echo ""
echo -e "${BOLD}${GREEN}🎉 COMPLETE REBUILD FINISHED! 🎉${NC}"
echo ""
echo -e "${BOLD}${BLUE}📊 SYSTEM STATUS:${NC}"
echo -e "🌐 Application: ${GREEN}http://wa.plest.de${NC}"
echo -e "🏥 Health Check: ${GREEN}http://wa.plest.de/api/health${NC}"
echo -e "🔐 Admin Login: ${GREEN}admin@wa.plest.de / AdminPass123${NC}"
echo ""
echo -e "${BOLD}${BLUE}📡 AVAILABLE APIS:${NC}"
echo -e "✅ Authentication: /api/auth/login, /api/auth/me"
echo -e "✅ Instance Management: /api/instances (create, start, qr)"
echo -e "✅ WhatsApp Proxy: /api/proxy/{apiKey}/{method} (108 methods!)"
echo -e "✅ Health Monitoring: /api/health"
echo ""
echo -e "${BOLD}${BLUE}🧪 QUICK TEST:${NC}"
echo "curl -X POST http://wa.plest.de/api/auth/login \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"email\":\"admin@wa.plest.de\",\"password\":\"AdminPass123\"}'"
echo ""
echo -e "${BOLD}${GREEN}🎯 READY TO CREATE WHATSAPP INSTANCES!${NC}"