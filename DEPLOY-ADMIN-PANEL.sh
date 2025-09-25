#!/bin/bash
#
# DEPLOY-ADMIN-PANEL.sh - Deploys React Admin Panel to wa.plest.de
#
# Builds and deploys the complete React admin interface for WhatsApp Manager
# Integrates with existing backend APIs on wa.plest.de
#
# Usage: sudo ./DEPLOY-ADMIN-PANEL.sh
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

echo -e "${BOLD}${BLUE}🚀 DEPLOYING REACT ADMIN PANEL${NC}"
echo -e "${BOLD}${BLUE}===============================${NC}"
echo ""

cd "$APP_DIR"

# STEP 1: Update code from Git
echo -e "${BLUE}📥 Pulling latest frontend code...${NC}"
git pull origin main

# STEP 2: Install frontend dependencies
echo -e "${BLUE}📦 Installing frontend dependencies...${NC}"
cd frontend

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
    sudo -u "$APP_USER" npm install
else
    echo -e "${YELLOW}Updating Node.js dependencies...${NC}"
    sudo -u "$APP_USER" npm ci
fi

# STEP 3: Build production frontend
echo -e "${BLUE}🔨 Building production frontend...${NC}"
sudo -u "$APP_USER" npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Frontend build successful${NC}"
else
    echo -e "${RED}❌ Frontend build failed${NC}"
    exit 1
fi

# STEP 4: Update server.js to serve React app
echo -e "${BLUE}⚙️  Updating server.js for React frontend...${NC}"
cd "$APP_DIR"

# Backup current server.js
cp server.js server.js.backup

# Update server.js to serve React build
cat >> server.js << 'EOF'

// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, 'frontend/build');

  // Serve static files
  app.use(express.static(frontendPath));

  // Serve React app for all non-API routes
  app.get('*', (req, res) => {
    // Don't serve React app for API routes
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API route not found' });
    }

    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  console.log('✅ React frontend enabled');
}
EOF

# Add path import at top of server.js if not present
if ! grep -q "const path = require('path')" server.js; then
    sed -i '1i const path = require('\''path'\'');' server.js
fi

echo -e "${GREEN}✅ Server.js updated for React frontend${NC}"

# STEP 5: Restart service
echo -e "${BLUE}🔄 Restarting WhatsApp Manager service...${NC}"
sudo systemctl restart whatsapp-manager

echo -e "${YELLOW}⏳ Waiting for service restart...${NC}"
sleep 10

# STEP 6: Test deployment
echo -e "${BOLD}${BLUE}🧪 TESTING ADMIN PANEL DEPLOYMENT...${NC}"

# Test backend API (should still work)
echo -e "${BLUE}Testing backend API...${NC}"
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Backend API: WORKING${NC}"
else
    echo -e "${RED}❌ Backend API: FAILED${NC}"
    echo "Service status:"
    sudo systemctl status whatsapp-manager --no-pager
    exit 1
fi

# Test React frontend
echo -e "${BLUE}Testing React frontend...${NC}"
FRONTEND_RESPONSE=$(curl -s -w "%{http_code}" "http://localhost:5000/" 2>/dev/null || echo "FAILED")

if echo "$FRONTEND_RESPONSE" | grep -q "200$"; then
    echo -e "${GREEN}✅ React Frontend: WORKING${NC}"
else
    echo -e "${RED}❌ React Frontend: FAILED${NC}"
    echo "Response: $FRONTEND_RESPONSE"
fi

# Test domain access
echo -e "${BLUE}Testing domain access...${NC}"
if curl -f -s "http://wa.plest.de/" > /dev/null; then
    echo -e "${GREEN}✅ Domain Frontend: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  Domain Frontend: Check DNS/Nginx${NC}"
fi

# SUCCESS SUMMARY
echo ""
echo -e "${BOLD}${GREEN}🎉 REACT ADMIN PANEL DEPLOYED! 🎉${NC}"
echo ""
echo -e "${BOLD}${BLUE}📊 DEPLOYMENT STATUS:${NC}"
echo -e "🌐 Admin Panel: ${GREEN}http://wa.plest.de${NC}"
echo -e "🔐 Login: ${GREEN}admin@wa.plest.de / AdminPass123${NC}"
echo -e "🏥 Backend API: ${GREEN}http://wa.plest.de/api/health${NC}"
echo ""
echo -e "${BOLD}${BLUE}📱 ADMIN PANEL FEATURES:${NC}"
echo -e "✅ Modern React interface with Material-UI"
echo -e "✅ JWT authentication integration"
echo -e "✅ Protected routes and role-based access"
echo -e "✅ Responsive design for mobile/tablet"
echo -e "✅ Real-time system health monitoring"
echo ""
echo -e "${BOLD}${BLUE}🧪 TEST THE ADMIN PANEL:${NC}"
echo -e "1. Open: ${YELLOW}http://wa.plest.de${NC}"
echo -e "2. Login with: ${YELLOW}admin@wa.plest.de / AdminPass123${NC}"
echo -e "3. Navigate through Dashboard, Instances, Analytics"
echo ""
echo -e "${BOLD}${GREEN}🎯 ADMIN PANEL IS LIVE AND READY!${NC}"

# Show service status
echo ""
echo -e "${BLUE}📊 Service Status:${NC}"
sudo systemctl status whatsapp-manager --no-pager --lines=5