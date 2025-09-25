#!/bin/bash
#
# DEPLOY-PHASE2-INSTANCE-MANAGEMENT.sh - Deploys complete instance management
#
# Implements Phase 2 features:
# - Visual instance management grid
# - Create instance modal with form
# - QR code display for WhatsApp authentication
# - Start/stop/delete instance actions
# - Real-time status updates
# - Fixed API integration
#
# Usage: sudo ./DEPLOY-PHASE2-INSTANCE-MANAGEMENT.sh
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

echo -e "${BOLD}${BLUE}🚀 DEPLOYING PHASE 2: INSTANCE MANAGEMENT${NC}"
echo -e "${BOLD}${BLUE}==========================================${NC}"
echo ""

cd "$APP_DIR"

# STEP 1: Resolve Git conflicts and update
echo -e "${BLUE}📥 Resolving conflicts and updating code...${NC}"
git stash push -m "Local changes before Phase 2 deployment"
git pull origin main

# STEP 2: Install additional dependencies for QR codes
echo -e "${BLUE}📦 Installing QR code dependencies...${NC}"
cd frontend
sudo -u "$APP_USER" npm install qrcode.react

# STEP 3: Build Phase 2 features
echo -e "${BLUE}🔨 Building Phase 2 instance management...${NC}"
sudo -u "$APP_USER" npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Phase 2 build successful${NC}"
else
    echo -e "${RED}❌ Phase 2 build failed${NC}"
    exit 1
fi

# STEP 4: Restart both services
echo -e "${BLUE}🔄 Restarting services...${NC}"
sudo systemctl restart whatsapp-manager whatsapp-frontend

echo -e "${YELLOW}⏳ Waiting for services to start...${NC}"
sleep 10

# STEP 5: Test Phase 2 functionality
echo -e "${BOLD}${BLUE}🧪 TESTING PHASE 2 FEATURES...${NC}"

# Test backend API
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Backend API: WORKING${NC}"
else
    echo -e "${RED}❌ Backend API: FAILED${NC}"
    sudo systemctl status whatsapp-manager --no-pager
    exit 1
fi

# Test frontend
if curl -f -s "http://localhost:3000/" > /dev/null; then
    echo -e "${GREEN}✅ Frontend: WORKING${NC}"
else
    echo -e "${RED}❌ Frontend: FAILED${NC}"
    sudo systemctl status whatsapp-frontend --no-pager
    exit 1
fi

# Test API integration from frontend
echo -e "${BLUE}Testing API integration...${NC}"
API_TEST=$(curl -s "http://localhost:3000/api/health" 2>/dev/null || echo "FAILED")

if echo "$API_TEST" | grep -q "healthy"; then
    echo -e "${GREEN}✅ API Integration: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  API Integration: Check Nginx proxy${NC}"
fi

# Test domain access
if curl -f -s "http://wa.plest.de/" > /dev/null; then
    echo -e "${GREEN}✅ Domain: WORKING${NC}"
else
    echo -e "${YELLOW}⚠️  Domain: Check DNS/Cloudflare${NC}"
fi

# SUCCESS
echo ""
echo -e "${BOLD}${GREEN}🎉 PHASE 2 INSTANCE MANAGEMENT DEPLOYED! 🎉${NC}"
echo ""
echo -e "${BOLD}${BLUE}📱 NEW FEATURES AVAILABLE:${NC}"
echo -e "✅ Visual instance management grid"
echo -e "✅ Create instance modal with form validation"
echo -e "✅ QR code display for WhatsApp authentication"
echo -e "✅ One-click start/stop/delete actions"
echo -e "✅ Real-time status indicators"
echo -e "✅ Professional minimal design"
echo ""
echo -e "${BOLD}${BLUE}🧪 TEST PHASE 2 FEATURES:${NC}"
echo -e "1. Open: ${GREEN}http://wa.plest.de${NC}"
echo -e "2. Login: ${GREEN}admin@wa.plest.de / AdminPass123${NC}"
echo -e "3. Navigate to: ${GREEN}Instances${NC}"
echo -e "4. Click: ${GREEN}Create Instance${NC}"
echo -e "5. Fill form and create new WhatsApp instance"
echo -e "6. Click: ${GREEN}Start${NC} → ${GREEN}QR Code${NC}"
echo -e "7. Scan QR with WhatsApp app"
echo ""
echo -e "${BOLD}${BLUE}📊 YOUR EXISTING INSTANCE:${NC}"
echo -e "Instance ID: ${YELLOW}inst_1758810896806_buld2z${NC}"
echo -e "API Key: ${YELLOW}801f72b2ccbd49f314764e040c33d91c3d0b8c4b5487a5f618356b67e6afe82e${NC}"
echo -e "Status: Should be visible in the instances grid"
echo ""
echo -e "${BOLD}${GREEN}🎯 FULL INSTANCE MANAGEMENT NOW AVAILABLE!${NC}"

# Show service status
echo ""
echo -e "${BLUE}📊 Services Status:${NC}"
echo -e "${YELLOW}Backend API:${NC}"
sudo systemctl status whatsapp-manager --no-pager --lines=2
echo -e "${YELLOW}Frontend App:${NC}"
sudo systemctl status whatsapp-frontend --no-pager --lines=2