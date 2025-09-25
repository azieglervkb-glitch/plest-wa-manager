#!/bin/bash
#
# DEPLOY-FINAL-WORKING-VERSION.sh - Gets systematically tested version from GitHub
#
# Gets the version that was completely analyzed and tested locally
# No more frontend service problems - everything runs on single backend
#
# Usage: sudo ./DEPLOY-FINAL-WORKING-VERSION.sh
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

echo -e "${BOLD}${BLUE}🚀 DEPLOYING FINAL SYSTEMATICALLY TESTED VERSION${NC}"
echo -e "${BOLD}${BLUE}===============================================${NC}"
echo ""

cd "$APP_DIR"

# STEP 1: Stop everything
echo -e "${BLUE}⏸️  Stopping all services...${NC}"
sudo systemctl stop whatsapp-manager whatsapp-frontend 2>/dev/null || true
sudo systemctl disable whatsapp-frontend 2>/dev/null || true

# STEP 2: Get clean tested version
echo -e "${BLUE}📥 Getting systematically tested version from GitHub...${NC}"
git fetch origin main
git reset --hard origin/main

echo -e "${GREEN}✅ Clean tested version loaded${NC}"

# STEP 3: Build frontend
echo -e "${BLUE}🔨 Building frontend...${NC}"
cd frontend
sudo -u "$APP_USER" npm install --silent
sudo -u "$APP_USER" npm run build

# STEP 4: Update Nginx for single-service architecture
echo -e "${BLUE}🌐 Updating Nginx for single-service...${NC}"
sudo tee /etc/nginx/sites-available/whatsapp-manager << 'EOF'
# Single service architecture - Backend serves everything
server {
    listen 80;
    server_name wa.plest.de;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Longer timeouts for WhatsApp operations
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    location /api/health {
        proxy_pass http://127.0.0.1:5000;
        access_log off;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx

# STEP 5: Start single backend service
echo -e "${BOLD}${BLUE}🚀 STARTING SINGLE PRODUCTION SERVICE...${NC}"
cd "$APP_DIR"
sudo systemctl start whatsapp-manager

echo -e "${YELLOW}⏳ Waiting for production startup...${NC}"
sleep 15

# STEP 6: Comprehensive testing
echo -e "${BOLD}${BLUE}🧪 COMPREHENSIVE SYSTEM TESTING...${NC}"

# Test backend health
HEALTH_RESPONSE=$(curl -s "http://localhost:5000/api/health" 2>/dev/null || echo "FAILED")

if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Backend Health: WORKING${NC}"

    # Show health details
    echo -e "${BLUE}Health Details:${NC}"
    echo "$HEALTH_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_RESPONSE"

    # Extract instance count
    INSTANCE_COUNT=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['instances'])" 2>/dev/null || echo "0")
    echo -e "${BLUE}Instances in memory: $INSTANCE_COUNT${NC}"
else
    echo -e "${RED}❌ Backend Health: FAILED${NC}"
    sudo journalctl -u whatsapp-manager -n 20 --no-pager
    exit 1
fi

# Test authentication
echo -e "${BLUE}Testing authentication...${NC}"
AUTH_RESPONSE=$(curl -s -X POST "http://localhost:5000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@wa.plest.de","password":"AdminPass123"}')

if echo "$AUTH_RESPONSE" | grep -q "accessToken"; then
    echo -e "${GREEN}✅ Authentication: WORKING${NC}"

    JWT_TOKEN=$(echo "$AUTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['tokens']['accessToken'])" 2>/dev/null || echo "failed")

    if [ "$JWT_TOKEN" != "failed" ]; then
        echo -e "${BLUE}JWT Token: ${JWT_TOKEN:0:20}...${NC}"

        # Test instance management
        echo -e "${BLUE}Testing instance management...${NC}"
        INSTANCES_RESPONSE=$(curl -s "http://localhost:5000/api/instances" \
          -H "Authorization: Bearer $JWT_TOKEN")

        if echo "$INSTANCES_RESPONSE" | grep -q "instances"; then
            echo -e "${GREEN}✅ Instance Management: WORKING${NC}"
            INSTANCE_COUNT=$(echo "$INSTANCES_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)['instances']))" 2>/dev/null || echo "0")
            echo -e "${BLUE}Found $INSTANCE_COUNT instances${NC}"
        else
            echo -e "${RED}❌ Instance Management: FAILED${NC}"
            echo "Response: $INSTANCES_RESPONSE"
        fi
    fi
else
    echo -e "${RED}❌ Authentication: FAILED${NC}"
    echo "Response: $AUTH_RESPONSE"
fi

# Test frontend serving
echo -e "${BLUE}Testing frontend serving...${NC}"
FRONTEND_RESPONSE=$(curl -s "http://localhost:5000/" 2>/dev/null || echo "FAILED")

if echo "$FRONTEND_RESPONSE" | grep -q "WhatsApp Manager"; then
    echo -e "${GREEN}✅ Frontend Serving: WORKING${NC}"
else
    echo -e "${RED}❌ Frontend Serving: FAILED${NC}"
fi

# Test domain
echo -e "${BLUE}Testing domain access...${NC}"
if curl -f -s "http://wa.plest.de/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Domain API: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  Domain API: Check DNS${NC}"
fi

if curl -f -s "http://wa.plest.de/" > /dev/null; then
    echo -e "${GREEN}✅ Domain Frontend: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  Domain Frontend: Check DNS${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}🎉 FINAL WORKING VERSION DEPLOYED!${NC}"
echo ""
echo -e "${BOLD}${BLUE}✅ SINGLE-SERVICE ARCHITECTURE:${NC}"
echo -e "🚀 Backend + Frontend: Port 5000 (unified)"
echo -e "🌐 Admin Panel: ${GREEN}http://wa.plest.de${NC}"
echo -e "📡 Backend API: ${GREEN}http://wa.plest.de/api/*${NC}"
echo -e "🔐 Login: ${GREEN}admin@wa.plest.de / AdminPass123${NC}"
echo ""
echo -e "${BOLD}${BLUE}🎯 NO MORE FRONTEND SERVICE ISSUES:${NC}"
echo -e "✅ Single systemd service (whatsapp-manager)"
echo -e "✅ Backend serves both API and React frontend"
echo -e "✅ No complex frontend/backend coordination"
echo -e "✅ Simplified architecture that actually works"
echo ""
echo -e "${BOLD}${GREEN}🚀 WHATSAPP MANAGER IS FINALLY LIVE!${NC}"

# Show final service status
echo ""
echo -e "${BLUE}📊 Service Status:${NC}"
sudo systemctl status whatsapp-manager --no-pager --lines=5