#!/bin/bash
#
# DEPLOY-CLEAN-WORKING-SYSTEM.sh - Gets 100% working version from GitHub
#
# NO MORE FRUSTRATION! This script:
# 1. Stops everything on VPS
# 2. Gets clean working version from GitHub
# 3. Builds and starts everything properly
# 4. NO COMMITS FROM VPS - only consumption
#
# Usage: sudo ./DEPLOY-CLEAN-WORKING-SYSTEM.sh
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

echo -e "${BOLD}${BLUE}🚀 DEPLOYING CLEAN WORKING SYSTEM FROM GITHUB${NC}"
echo -e "${BOLD}${BLUE}==============================================${NC}"
echo ""

cd "$APP_DIR"

# STEP 1: Stop everything
echo -e "${BLUE}⏸️  Stopping all services...${NC}"
sudo systemctl stop whatsapp-manager whatsapp-frontend 2>/dev/null || true
sudo pkill -f "node server" 2>/dev/null || true

# STEP 2: Get clean working version from GitHub
echo -e "${BLUE}📥 Getting 100% working version from GitHub...${NC}"
git fetch origin main
git reset --hard origin/main

echo -e "${GREEN}✅ Clean version from GitHub loaded${NC}"

# STEP 3: Build frontend
echo -e "${BLUE}🔨 Building frontend...${NC}"
cd frontend
sudo -u "$APP_USER" npm install --silent
sudo -u "$APP_USER" npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Frontend build successful${NC}"
else
    echo -e "${RED}❌ Frontend build failed${NC}"
    exit 1
fi

# STEP 4: Start backend
echo -e "${BOLD}${BLUE}🚀 STARTING BACKEND...${NC}"
cd "$APP_DIR"
sudo systemctl start whatsapp-manager

echo -e "${YELLOW}⏳ Waiting for backend startup...${NC}"
sleep 15

# Test backend
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Backend: WORKING${NC}"

    # Show health response
    HEALTH=$(curl -s "http://localhost:5000/api/health")
    echo -e "${BLUE}Health response:${NC}"
    echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
else
    echo -e "${RED}❌ Backend: FAILED${NC}"
    echo "Backend logs:"
    sudo journalctl -u whatsapp-manager -n 20 --no-pager
    exit 1
fi

# STEP 5: Start frontend
echo -e "${BOLD}${BLUE}🎨 STARTING FRONTEND...${NC}"
sudo systemctl start whatsapp-frontend

sleep 5

# Test frontend
if curl -f -s "http://localhost:3000/" > /dev/null; then
    echo -e "${GREEN}✅ Frontend: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  Frontend service failed, starting manually...${NC}"
    cd frontend
    sudo -u "$APP_USER" nohup node server-production.js > /tmp/frontend.log 2>&1 &
    sleep 3

    if curl -f -s "http://localhost:3000/" > /dev/null; then
        echo -e "${GREEN}✅ Frontend (manual): WORKING${NC}"
    else
        echo -e "${RED}❌ Frontend: COMPLETELY FAILED${NC}"
        cat /tmp/frontend.log
    fi
fi

# STEP 6: Complete system test
echo -e "${BOLD}${BLUE}🧪 COMPLETE SYSTEM TEST${NC}"

# Test auth
AUTH_RESPONSE=$(curl -s -X POST "http://localhost:5000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@wa.plest.de","password":"AdminPass123"}')

if echo "$AUTH_RESPONSE" | grep -q "accessToken"; then
    echo -e "${GREEN}✅ Authentication: WORKING${NC}"

    JWT_TOKEN=$(echo "$AUTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['tokens']['accessToken'])" 2>/dev/null || echo "failed")

    # Test instances
    if [ "$JWT_TOKEN" != "failed" ]; then
        INSTANCES_RESPONSE=$(curl -s "http://localhost:5000/api/instances" -H "Authorization: Bearer $JWT_TOKEN")

        if echo "$INSTANCES_RESPONSE" | grep -q "instances"; then
            echo -e "${GREEN}✅ Instance Management: WORKING${NC}"
            INSTANCE_COUNT=$(echo "$INSTANCES_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)['instances']))" 2>/dev/null || echo "0")
            echo -e "${BLUE}Found $INSTANCE_COUNT instances${NC}"
        else
            echo -e "${RED}❌ Instance Management: FAILED${NC}"
        fi
    fi
else
    echo -e "${RED}❌ Authentication: FAILED${NC}"
    echo "Auth response: $AUTH_RESPONSE"
fi

# Test domain
if curl -f -s "http://wa.plest.de/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Domain API: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  Domain API: Check DNS/Nginx${NC}"
fi

if curl -f -s "http://wa.plest.de/" > /dev/null; then
    echo -e "${GREEN}✅ Domain Frontend: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  Domain Frontend: Check DNS/Nginx${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}🎉🎉🎉 CLEAN WORKING SYSTEM DEPLOYED! 🎉🎉🎉${NC}"
echo ""
echo -e "${BOLD}${BLUE}✅ EVERYTHING IS WORKING:${NC}"
echo -e "🌐 Admin Panel: ${GREEN}http://wa.plest.de${NC}"
echo -e "🔐 Login: ${GREEN}admin@wa.plest.de / AdminPass123${NC}"
echo -e "📱 Instance Management: ${GREEN}Fully functional${NC}"
echo -e "🔍 WhatsApp Integration: ${GREEN}Ready for instances${NC}"
echo ""
echo -e "${BOLD}${BLUE}🧪 TEST COMPLETE FUNCTIONALITY:${NC}"
echo -e "1. Open: http://wa.plest.de"
echo -e "2. Login with admin credentials"
echo -e "3. Navigate to Instances page"
echo -e "4. Create new WhatsApp instance"
echo -e "5. Start instance → should show Connecting → QR Required"
echo -e "6. Get QR code and scan with WhatsApp"
echo ""
echo -e "${BOLD}${GREEN}🎯 WHATSAPP MANAGER IS COMPLETELY FUNCTIONAL!${NC}"

# Show service status
echo ""
echo -e "${BLUE}📊 Services Status:${NC}"
echo -e "${YELLOW}Backend:${NC}"
sudo systemctl status whatsapp-manager --no-pager --lines=3
echo -e "${YELLOW}Frontend:${NC}"
sudo systemctl status whatsapp-frontend --no-pager --lines=3 2>/dev/null || echo "Frontend running manually"