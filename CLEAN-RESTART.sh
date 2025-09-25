#!/bin/bash
#
# CLEAN-RESTART.sh - Complete system clean restart
#
# Stops everything, cleans up, rebuilds, and restarts fresh
# Ensures clean state and proper functionality
#
# Usage: sudo ./CLEAN-RESTART.sh
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

echo -e "${BOLD}${BLUE}🔄 COMPLETE SYSTEM CLEAN RESTART${NC}"
echo -e "${BOLD}${BLUE}=================================${NC}"
echo ""

cd "$APP_DIR"

# STEP 1: Stop all services
echo -e "${BLUE}⏸️  Stopping all services...${NC}"
sudo systemctl stop whatsapp-manager 2>/dev/null || echo "Backend not running"
sudo systemctl stop whatsapp-frontend 2>/dev/null || echo "Frontend not running"

# STEP 2: Clean up processes
echo -e "${BLUE}🧹 Cleaning up processes...${NC}"
sudo pkill -f "node server.js" 2>/dev/null || echo "No node processes"
sudo pkill -f "chrome" 2>/dev/null || echo "No chrome processes"

sleep 2

# STEP 3: Clean build and restart fresh
echo -e "${BLUE}🔨 Clean rebuild...${NC}"
cd frontend
sudo -u "$APP_USER" rm -rf .next build node_modules/.cache 2>/dev/null || true
sudo -u "$APP_USER" npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Frontend rebuild successful${NC}"
else
    echo -e "${RED}❌ Frontend rebuild failed${NC}"
    exit 1
fi

# STEP 4: Start backend
echo -e "${BLUE}🚀 Starting backend...${NC}"
cd "$APP_DIR"
sudo systemctl reset-failed whatsapp-manager
sudo systemctl start whatsapp-manager

sleep 5

# Test backend
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Backend: RUNNING${NC}"
else
    echo -e "${RED}❌ Backend: FAILED${NC}"
    sudo journalctl -u whatsapp-manager -n 10 --no-pager
    exit 1
fi

# STEP 5: Start frontend
echo -e "${BLUE}🎨 Starting frontend...${NC}"
sudo systemctl start whatsapp-frontend

sleep 5

# Test frontend
if curl -f -s "http://localhost:3000/" > /dev/null; then
    echo -e "${GREEN}✅ Frontend: RUNNING${NC}"
else
    echo -e "${RED}❌ Frontend: FAILED${NC}"
    sudo systemctl status whatsapp-frontend --no-pager
fi

# STEP 6: Final verification
echo -e "${BOLD}${BLUE}🧪 FINAL SYSTEM TEST${NC}"

# Test domain
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

# Test auth
AUTH_TEST=$(curl -s -X POST "http://wa.plest.de/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@wa.plest.de","password":"AdminPass123"}')

if echo "$AUTH_TEST" | grep -q "accessToken"; then
    echo -e "${GREEN}✅ Authentication: WORKING${NC}"
else
    echo -e "${RED}❌ Authentication: FAILED${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}🎉 CLEAN RESTART COMPLETE!${NC}"
echo ""
echo -e "${BOLD}${BLUE}📊 SYSTEM STATUS:${NC}"
echo -e "🌐 Admin Panel: ${GREEN}http://wa.plest.de${NC}"
echo -e "🔐 Login: ${GREEN}admin@wa.plest.de / AdminPass123${NC}"
echo ""
echo -e "${BOLD}${BLUE}🧪 TEST PHASE 2 FEATURES:${NC}"
echo -e "1. Login to admin panel"
echo -e "2. Navigate to Instances page"
echo -e "3. View existing instance: inst_1758810896806_buld2z"
echo -e "4. Test Create Instance functionality"
echo -e "5. Test Start/QR Code workflow"
echo ""
echo -e "${BOLD}${GREEN}🎯 READY FOR PHASE 2 TESTING!${NC}"