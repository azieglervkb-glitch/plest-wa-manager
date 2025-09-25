#!/bin/bash
#
# DEPLOY-MINIMAL-DESIGN.sh - Deploys minimal clean admin panel design
#
# Replaces the current colorful interface with minimal white clean design:
# - Pure white backgrounds
# - Black/gray text and minimal colors
# - Clean borders and subtle shadows
# - Minimal typography and spacing
# - Professional clean look
#
# Usage: sudo ./DEPLOY-MINIMAL-DESIGN.sh
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

echo -e "${BOLD}${BLUE}🎨 DEPLOYING MINIMAL CLEAN DESIGN${NC}"
echo -e "${BOLD}${BLUE}=================================${NC}"
echo ""

cd "$APP_DIR"

# Stop frontend service
echo -e "${BLUE}⏸️  Stopping frontend service...${NC}"
sudo systemctl stop whatsapp-frontend

# Pull latest design changes
echo -e "${BLUE}📥 Pulling latest minimal design...${NC}"
git pull origin main

# Install/update dependencies
echo -e "${BLUE}📦 Updating frontend dependencies...${NC}"
cd frontend
sudo -u "$APP_USER" npm install

# Build with minimal design
echo -e "${BLUE}🔨 Building minimal design...${NC}"
sudo -u "$APP_USER" npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Minimal design build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

# Start frontend service
echo -e "${BLUE}🚀 Starting frontend with minimal design...${NC}"
sudo systemctl start whatsapp-frontend

echo -e "${YELLOW}⏳ Waiting for frontend startup...${NC}"
sleep 8

# Test frontend
echo -e "${BLUE}🧪 Testing minimal design deployment...${NC}"

if curl -f -s "http://localhost:3000/" > /dev/null; then
    echo -e "${GREEN}✅ Frontend (3000): WORKING${NC}"
else
    echo -e "${RED}❌ Frontend (3000): FAILED${NC}"
    sudo systemctl status whatsapp-frontend --no-pager
    exit 1
fi

# Test domain
if curl -f -s "http://wa.plest.de/" > /dev/null; then
    echo -e "${GREEN}✅ Domain: WORKING${NC}"
else
    echo -e "${RED}❌ Domain: FAILED${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}🎨 MINIMAL DESIGN DEPLOYED!${NC}"
echo ""
echo -e "${BOLD}${BLUE}✨ NEW DESIGN FEATURES:${NC}"
echo -e "✅ Pure white backgrounds"
echo -e "✅ Black/gray minimal color scheme"
echo -e "✅ Clean borders and subtle shadows"
echo -e "✅ Professional typography (Inter font)"
echo -e "✅ Minimal spacing and clean layout"
echo -e "✅ Subtle hover effects"
echo ""
echo -e "${BOLD}${BLUE}🌐 TEST THE NEW DESIGN:${NC}"
echo -e "1. Open: ${GREEN}http://wa.plest.de${NC}"
echo -e "2. Clear browser cache (Ctrl+F5) if needed"
echo -e "3. Login: ${GREEN}admin@wa.plest.de / AdminPass123${NC}"
echo -e "4. Navigate through clean minimal interface"
echo ""
echo -e "${BOLD}${GREEN}🎯 MINIMAL CLEAN ADMIN PANEL IS LIVE!${NC}"

# Show both service statuses
echo ""
echo -e "${BLUE}📊 Service Status:${NC}"
echo -e "${YELLOW}Backend:${NC}"
sudo systemctl status whatsapp-manager --no-pager --lines=3
echo -e "${YELLOW}Frontend:${NC}"
sudo systemctl status whatsapp-frontend --no-pager --lines=3