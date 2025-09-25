#!/bin/bash
#
# WhatsApp Manager - Quick Install Script
#
# Complete deployment in one command:
# curl -sSL https://raw.githubusercontent.com/yourrepo/whatsapp-multi-instance-manager/main/deploy/quick-install.sh | sudo bash -s your-domain.com
#

set -e

DOMAIN="${1:-localhost}"
REPO_URL="https://github.com/azieglervkb-glitch/plest-wa-manager.git"
TEMP_DIR="/tmp/whatsapp-manager-install"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 WhatsApp Manager - Quick Install${NC}"
echo -e "${BLUE}===================================${NC}"
echo "Domain: $DOMAIN"
echo "Repository: $REPO_URL"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root${NC}"
   echo "Usage: curl -sSL https://raw.githubusercontent.com/.../quick-install.sh | sudo bash -s your-domain.com"
   exit 1
fi

# Clean previous install attempts
rm -rf "$TEMP_DIR"

# Clone repository to temp directory
echo -e "${BLUE}📥 Downloading WhatsApp Manager...${NC}"
git clone "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR/deploy"

# Make scripts executable
chmod +x *.sh

# Step 1: Install system dependencies
echo -e "${BLUE}📦 Installing system dependencies...${NC}"
./install-ubuntu22.sh "$DOMAIN"

# Step 2: Initialize database
echo -e "${BLUE}🗄️  Setting up database...${NC}"
./init-database.sh

# Step 3: Deploy application
echo -e "${BLUE}🚀 Deploying application...${NC}"
REPO_URL="$REPO_URL" ./deploy-app.sh init

# Cleanup
rm -rf "$TEMP_DIR"

echo -e "${GREEN}🎉 WhatsApp Manager deployed successfully!${NC}"
echo ""
echo -e "${BLUE}📋 Important Information:${NC}"
echo "Application URL: https://$DOMAIN"
echo "Health Check: https://$DOMAIN/api/health"
echo "API Documentation: https://$DOMAIN (shows API usage)"
echo ""
echo -e "${BLUE}🔐 Admin Credentials:${NC}"
echo "Check: /opt/whatsapp-manager/.env.db"
echo ""
echo -e "${BLUE}⚙️  Service Management:${NC}"
echo "Status: sudo systemctl status whatsapp-manager"
echo "Logs: sudo journalctl -u whatsapp-manager -f"
echo "Restart: sudo systemctl restart whatsapp-manager"
echo ""
echo -e "${BLUE}🔄 Updates:${NC}"
echo "Update: sudo /opt/whatsapp-manager/deploy/deploy-app.sh update"
echo "Rollback: sudo /opt/whatsapp-manager/deploy/deploy-app.sh rollback"
echo ""
echo -e "${GREEN}✅ Your WhatsApp Multi-Instance Manager is ready for production!${NC}"