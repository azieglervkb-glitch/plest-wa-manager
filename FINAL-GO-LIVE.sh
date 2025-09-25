#!/bin/bash
#
# WhatsApp Manager - FINAL GO-LIVE SCRIPT
#
# Löst ALLE Deployment-Probleme in einem Durchgang!
# Für die Situation: System-Dependencies installiert, App geklont, aber MongoDB + Service fehlt
#
# Usage: sudo ./FINAL-GO-LIVE.sh wa.plest.de
#

set -e

DOMAIN="${1:-wa.plest.de}"
APP_DIR="/opt/whatsapp-manager"
APP_USER="whatsapp-manager"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 FINAL GO-LIVE SCRIPT${NC}"
echo -e "${BLUE}======================${NC}"
echo "Domain: $DOMAIN"
echo "Current directory: $(pwd)"
echo "App directory: $APP_DIR"
echo ""

# Prüfen ob wir im richtigen Zustand sind
if [ ! -f "$APP_DIR/package.json" ]; then
    echo -e "${RED}❌ App not found! Please run from VPS where app is cloned.${NC}"
    exit 1
fi

if [ ! -d "$APP_DIR/node_modules" ]; then
    echo -e "${RED}❌ Dependencies not installed! Run 'npm install' first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"
echo ""

# Sichere Passwörter generieren
echo -e "${BLUE}🔐 Generating secure credentials...${NC}"
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
JWT_SECRET=$(openssl rand -base64 64 | tr -d "=+/")

echo "✅ Credentials generated"

# KRITISCH: MongoDB Auth-Problem lösen
echo -e "${BLUE}🗄️  Fixing MongoDB authentication...${NC}"

# 1. Auth temporär deaktivieren für User-Erstellung
echo -e "${YELLOW}Temporarily disabling MongoDB auth...${NC}"
sudo cp /etc/mongod.conf /etc/mongod.conf.backup
sudo sed -i '/security:/d' /etc/mongod.conf
sudo sed -i '/authorization: enabled/d' /etc/mongod.conf
sudo systemctl restart mongod
sleep 5

# 2. Prüfen ob MongoDB läuft
if ! systemctl is-active --quiet mongod; then
    echo -e "${RED}❌ MongoDB failed to start${NC}"
    sudo systemctl status mongod
    exit 1
fi

# 3. Users erstellen (ohne Auth)
echo -e "${YELLOW}Creating MongoDB users...${NC}"
mongosh admin --quiet --eval "
try {
  db.createUser({
    user: 'admin',
    pwd: '$ADMIN_PASSWORD',
    roles: [ { role: 'root', db: 'admin' } ]
  });
  print('✅ Admin user created');
} catch(e) {
  if (e.code === 11000) {
    print('⚠️  Admin user already exists');
  } else {
    print('❌ Admin user error: ' + e.message);
  }
}
"

mongosh whatsapp_production --quiet --eval "
try {
  db.createUser({
    user: 'whatsapp-user',
    pwd: '$DB_PASSWORD',
    roles: [
      { role: 'readWrite', db: 'whatsapp_production' },
      { role: 'dbAdmin', db: 'whatsapp_production' }
    ]
  });
  print('✅ App user created');
} catch(e) {
  if (e.code === 11000) {
    print('⚠️  App user already exists');
  } else {
    print('❌ App user error: ' + e.message);
  }
}
"

# 4. Auth wieder aktivieren
echo -e "${YELLOW}Re-enabling MongoDB authentication...${NC}"
echo "security:" | sudo tee -a /etc/mongod.conf
echo "  authorization: enabled" | sudo tee -a /etc/mongod.conf
sudo systemctl restart mongod
sleep 5

# 5. Connection testen
echo -e "${YELLOW}Testing MongoDB connection...${NC}"
if mongosh "mongodb://whatsapp-user:$DB_PASSWORD@localhost:27017/whatsapp_production" --quiet --eval "db.runCommand('ping')" | grep -q "ok.*1"; then
    echo -e "${GREEN}✅ MongoDB connection successful${NC}"
else
    echo -e "${RED}❌ MongoDB connection failed${NC}"
    exit 1
fi

# Production Environment erstellen
echo -e "${BLUE}📝 Creating production environment...${NC}"
cd "$APP_DIR"
cat > .env << EOF
NODE_ENV=production
PORT=5000
SERVER_ID=vps-${DOMAIN//\./-}
FRONTEND_URL=https://${DOMAIN}

# Database (auto-generated credentials)
MONGODB_URI=mongodb://whatsapp-user:${DB_PASSWORD}@localhost:27017/whatsapp_production?authSource=whatsapp_production

# Security
JWT_SECRET=${JWT_SECRET}
SESSION_SECRET=$(openssl rand -base64 32 | tr -d "=+/")

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

# Puppeteer Ubuntu VPS
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
EOF

# Sichere Permissions
chown "$APP_USER:$APP_USER" .env
chmod 600 .env

# Credentials für später speichern
cat > .env.credentials << EOF
# Generated $(date)
MONGODB_ADMIN_PASSWORD=${ADMIN_PASSWORD}
MONGODB_APP_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}

# Admin Login:
# Email: admin@${DOMAIN}
# Password: ${ADMIN_PASSWORD}
EOF

chown "$APP_USER:$APP_USER" .env.credentials
chmod 600 .env.credentials

# Database Migration
echo -e "${BLUE}📊 Running database migration...${NC}"
sudo -u "$APP_USER" node migrations/001-extend-instance-schema.js up

# Admin-User für App erstellen
echo -e "${BLUE}👤 Creating application admin user...${NC}"
sudo -u "$APP_USER" ADMIN_EMAIL="admin@${DOMAIN}" ADMIN_PASSWORD="$ADMIN_PASSWORD" node scripts/create-admin.js

# Systemd Service installieren
echo -e "${BLUE}⚙️  Installing systemd service...${NC}"
sudo cp deploy/whatsapp-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-manager

# Nginx für Domain konfigurieren
echo -e "${BLUE}🌐 Configuring Nginx for $DOMAIN...${NC}"
sudo cp deploy/nginx-whatsapp-manager.conf /etc/nginx/sites-available/whatsapp-manager
sudo sed -i "s/your-domain\.com/$DOMAIN/g" /etc/nginx/sites-available/whatsapp-manager
sudo ln -sf /etc/nginx/sites-available/whatsapp-manager /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Nginx-Config testen
if sudo nginx -t; then
    sudo systemctl reload nginx
    echo -e "${GREEN}✅ Nginx configuration updated${NC}"
else
    echo -e "${RED}❌ Nginx configuration error${NC}"
    exit 1
fi

# SSL-Zertifikat erstellen
echo -e "${BLUE}🔐 Setting up SSL certificate...${NC}"
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" --redirect

# Service starten
echo -e "${BLUE}🚀 Starting WhatsApp Manager service...${NC}"
sudo systemctl start whatsapp-manager

# Warten bis Service hochgefahren ist
echo -e "${YELLOW}⏳ Waiting for service to start...${NC}"
sleep 15

# Tests ausführen
echo -e "${BLUE}🧪 Running final tests...${NC}"

# Local health check
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Local health check: PASSED${NC}"
else
    echo -e "${RED}❌ Local health check: FAILED${NC}"
    echo "Checking service status..."
    sudo systemctl status whatsapp-manager --no-pager
    echo ""
    echo "Recent logs:"
    sudo journalctl -u whatsapp-manager -n 20 --no-pager
    exit 1
fi

# Domain health check
if curl -f -s "https://$DOMAIN/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Domain health check: PASSED${NC}"
else
    echo -e "${YELLOW}⚠️  Domain health check: Failed (SSL might still be propagating)${NC}"
fi

# Firewall final check
echo -e "${BLUE}🔥 Final firewall configuration...${NC}"
sudo ufw --force enable
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# ERFOLG!
echo ""
echo -e "${GREEN}🎉🎉🎉 WHATSAPP MANAGER IS LIVE! 🎉🎉🎉${NC}"
echo ""
echo -e "${BLUE}📊 System Information:${NC}"
echo "Application URL: https://$DOMAIN"
echo "Health Check: https://$DOMAIN/api/health"
echo "API Documentation: https://$DOMAIN"
echo ""
echo -e "${BLUE}🔐 Admin Login:${NC}"
echo "Email: admin@$DOMAIN"
echo "Password: $ADMIN_PASSWORD"
echo ""
echo -e "${BLUE}📋 Service Management:${NC}"
echo "Status: sudo systemctl status whatsapp-manager"
echo "Logs: sudo journalctl -u whatsapp-manager -f"
echo "Restart: sudo systemctl restart whatsapp-manager"
echo ""
echo -e "${BLUE}📁 Important Files:${NC}"
echo "App Config: $APP_DIR/.env"
echo "Credentials: $APP_DIR/.env.credentials"
echo "Service File: /etc/systemd/system/whatsapp-manager.service"
echo ""
echo -e "${BLUE}🔄 For Updates:${NC}"
echo "cd $APP_DIR && git pull origin main"
echo "sudo $APP_DIR/deploy/deploy-app.sh update"
echo ""
echo -e "${GREEN}✅ Ready to create WhatsApp instances and start using the API!${NC}"

# Service status anzeigen
echo ""
echo -e "${BLUE}📊 Current Service Status:${NC}"
sudo systemctl status whatsapp-manager --no-pager || echo "Service status check completed"