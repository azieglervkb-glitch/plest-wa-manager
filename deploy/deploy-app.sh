#!/bin/bash
#
# WhatsApp Manager - Application Deployment Script
#
# Usage:
#   Initial deployment: ./deploy-app.sh init
#   Updates: ./deploy-app.sh update
#   Rollback: ./deploy-app.sh rollback
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
APP_USER="whatsapp-manager"
APP_DIR="/opt/whatsapp-manager"
REPO_URL="https://github.com/azieglervkb-glitch/plest-wa-manager.git"
BRANCH="${DEPLOY_BRANCH:-main}"
BACKUP_DIR="/opt/whatsapp-manager-backups"
SERVICE_NAME="whatsapp-manager"

# Deployment info
DEPLOY_DATE=$(date +"%Y%m%d_%H%M%S")
DEPLOY_TAG="deploy_${DEPLOY_DATE}"

echo -e "${BLUE}🚀 WhatsApp Manager Deployment Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo "Command: $1"
echo "Branch: $BRANCH"
echo "Deploy Date: $DEPLOY_DATE"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root (use sudo)${NC}"
   exit 1
fi

case "$1" in
  "init")
    echo -e "${BLUE}📥 Initial deployment...${NC}"

    # Create backup directory
    mkdir -p "$BACKUP_DIR"
    chown "$APP_USER:$APP_USER" "$BACKUP_DIR"

    # Clone repository
    echo -e "${YELLOW}📦 Cloning repository...${NC}"
    if [ -d "$APP_DIR/.git" ]; then
      echo "Repository already exists, pulling latest..."
      cd "$APP_DIR"
      sudo -u "$APP_USER" git fetch origin
      sudo -u "$APP_USER" git checkout "$BRANCH"
      sudo -u "$APP_USER" git pull origin "$BRANCH"
    else
      rm -rf "$APP_DIR"
      sudo -u "$APP_USER" git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
      cd "$APP_DIR"
    fi

    # Set ownership
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"

    # Install dependencies
    echo -e "${YELLOW}📦 Installing Node.js dependencies...${NC}"
    sudo -u "$APP_USER" npm ci --production --silent

    # Setup environment
    echo -e "${YELLOW}⚙️  Setting up environment...${NC}"
    if [ ! -f "$APP_DIR/.env" ]; then
      sudo -u "$APP_USER" cp "$APP_DIR/.env.example" "$APP_DIR/.env"
      echo -e "${YELLOW}⚠️  Please edit $APP_DIR/.env with your configuration!${NC}"
    fi

    # Create required directories
    sudo -u "$APP_USER" mkdir -p "$APP_DIR"/{sessions,browser-profiles,logs,backups}
    chmod 750 "$APP_DIR"/{sessions,browser-profiles}
    chmod 755 "$APP_DIR"/{logs,backups}

    # Build frontend
    echo -e "${YELLOW}🔨 Building frontend...${NC}"
    if [ -d "$APP_DIR/frontend" ]; then
      cd "$APP_DIR/frontend"
      sudo -u "$APP_USER" npm ci --silent
      sudo -u "$APP_USER" npm run build
    fi

    # Database migration
    echo -e "${YELLOW}📊 Running database migrations...${NC}"
    cd "$APP_DIR"
    sudo -u "$APP_USER" node migrations/001-extend-instance-schema.js up

    # Install systemd service
    echo -e "${YELLOW}⚙️  Installing systemd service...${NC}"
    cp "$APP_DIR/deploy/whatsapp-manager.service" "/etc/systemd/system/"
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"

    # Start service
    echo -e "${YELLOW}🚀 Starting service...${NC}"
    systemctl start "$SERVICE_NAME"

    # Create deployment tag
    cd "$APP_DIR"
    sudo -u "$APP_USER" git tag "$DEPLOY_TAG"

    echo -e "${GREEN}✅ Initial deployment completed!${NC}"
    echo -e "${BLUE}📊 Service status:${NC}"
    systemctl --no-pager status "$SERVICE_NAME"
    ;;

  "update")
    echo -e "${BLUE}🔄 Updating application...${NC}"

    # Create backup before update
    echo -e "${YELLOW}💾 Creating backup...${NC}"
    BACKUP_PATH="$BACKUP_DIR/backup_$DEPLOY_DATE.tar.gz"
    tar -czf "$BACKUP_PATH" -C "$(dirname $APP_DIR)" "$(basename $APP_DIR)" \
      --exclude=node_modules --exclude=sessions --exclude=browser-profiles \
      --exclude=logs --exclude=.git
    echo "Backup created: $BACKUP_PATH"

    # Stop service
    echo -e "${YELLOW}⏸️  Stopping service...${NC}"
    systemctl stop "$SERVICE_NAME"

    # Update code
    echo -e "${YELLOW}📥 Pulling latest code...${NC}"
    cd "$APP_DIR"
    sudo -u "$APP_USER" git fetch origin
    sudo -u "$APP_USER" git checkout "$BRANCH"
    sudo -u "$APP_USER" git pull origin "$BRANCH"

    # Update dependencies
    echo -e "${YELLOW}📦 Updating dependencies...${NC}"
    sudo -u "$APP_USER" npm ci --production --silent

    # Run migrations
    echo -e "${YELLOW}📊 Running migrations...${NC}"
    sudo -u "$APP_USER" node migrations/001-extend-instance-schema.js up

    # Build frontend
    if [ -d "$APP_DIR/frontend" ]; then
      echo -e "${YELLOW}🔨 Rebuilding frontend...${NC}"
      cd "$APP_DIR/frontend"
      sudo -u "$APP_USER" npm ci --silent
      sudo -u "$APP_USER" npm run build
    fi

    # Restart service
    echo -e "${YELLOW}🚀 Starting service...${NC}"
    cd "$APP_DIR"
    systemctl start "$SERVICE_NAME"

    # Create deployment tag
    sudo -u "$APP_USER" git tag "$DEPLOY_TAG"

    # Health check
    sleep 5
    if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
      echo -e "${GREEN}✅ Update successful!${NC}"
      systemctl --no-pager status "$SERVICE_NAME"
    else
      echo -e "${RED}❌ Update failed! Rolling back...${NC}"
      ./deploy-app.sh rollback
      exit 1
    fi
    ;;

  "rollback")
    echo -e "${BLUE}⏮️  Rolling back to previous version...${NC}"

    # Stop service
    systemctl stop "$SERVICE_NAME"

    # Find latest backup
    LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/backup_*.tar.gz 2>/dev/null | head -1)

    if [ -z "$LATEST_BACKUP" ]; then
      echo -e "${RED}❌ No backup found!${NC}"
      exit 1
    fi

    echo "Rolling back to: $LATEST_BACKUP"

    # Restore from backup
    cd "$(dirname $APP_DIR)"
    rm -rf "$APP_DIR"
    tar -xzf "$LATEST_BACKUP"
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"

    # Reinstall dependencies
    cd "$APP_DIR"
    sudo -u "$APP_USER" npm ci --production --silent

    # Restart service
    systemctl start "$SERVICE_NAME"

    echo -e "${GREEN}✅ Rollback completed!${NC}"
    ;;

  "status")
    echo -e "${BLUE}📊 Current deployment status:${NC}"

    # Service status
    systemctl --no-pager status "$SERVICE_NAME"

    # Current version
    if [ -d "$APP_DIR/.git" ]; then
      cd "$APP_DIR"
      echo -e "\n${BLUE}📋 Version info:${NC}"
      echo "Branch: $(sudo -u $APP_USER git branch --show-current)"
      echo "Commit: $(sudo -u $APP_USER git rev-parse --short HEAD)"
      echo "Last commit: $(sudo -u $APP_USER git log -1 --format='%cd' --date=short)"

      echo -e "\n${BLUE}🏷️  Recent deployments:${NC}"
      sudo -u "$APP_USER" git tag --sort=-creatordate | grep "deploy_" | head -5
    fi

    # Health check
    echo -e "\n${BLUE}🏥 Health check:${NC}"
    if curl -f -s "http://localhost:5000/api/health" | jq . 2>/dev/null; then
      echo -e "${GREEN}✅ Service is healthy${NC}"
    else
      echo -e "${RED}❌ Service health check failed${NC}"
    fi
    ;;

  "logs")
    echo -e "${BLUE}📋 Service logs:${NC}"
    journalctl -u "$SERVICE_NAME" -f --no-pager
    ;;

  *)
    echo "Usage: $0 {init|update|rollback|status|logs}"
    echo ""
    echo "Commands:"
    echo "  init     - Initial deployment from Git repository"
    echo "  update   - Update to latest version (with backup)"
    echo "  rollback - Rollback to previous backup"
    echo "  status   - Show current deployment status"
    echo "  logs     - Show live service logs"
    echo ""
    echo "Environment variables:"
    echo "  DEPLOY_BRANCH  - Git branch to deploy (default: main)"
    echo ""
    echo "Examples:"
    echo "  sudo ./deploy-app.sh init"
    echo "  sudo DEPLOY_BRANCH=production ./deploy-app.sh update"
    exit 1
    ;;
esac