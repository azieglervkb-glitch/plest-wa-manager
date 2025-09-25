#!/bin/bash
#
# WhatsApp Manager - Complete Setup Fix Script
#
# Für die Situation: Dependencies installiert, aber MongoDB + Service-Setup fehlt
#
# Usage: sudo ./complete-setup.sh wa.plest.de
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

echo -e "${BLUE}🔧 WhatsApp Manager - Complete Setup${NC}"
echo -e "${BLUE}====================================${NC}"
echo "Domain: $DOMAIN"
echo "App Directory: $APP_DIR"
echo ""

# Check if we're in the right directory
if [ ! -f "$APP_DIR/package.json" ]; then
    echo -e "${RED}❌ App not found in $APP_DIR${NC}"
    echo "Please run this script from VPS where app is already cloned"
    exit 1
fi

cd "$APP_DIR"

# Step 1: Generate secure passwords
echo -e "${BLUE}🔐 Generating secure passwords...${NC}"
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
JWT_SECRET=$(openssl rand -base64 64 | tr -d "=+/")

echo "Database Password: $DB_PASSWORD"
echo "Admin Password: $ADMIN_PASSWORD"

# Step 2: Setup MongoDB with mongosh (not mongo)
echo -e "${BLUE}🗄️  Setting up MongoDB...${NC}"

# Enable authentication in MongoDB
if ! grep -q "security:" /etc/mongod.conf; then
    echo "security:" | sudo tee -a /etc/mongod.conf
    echo "  authorization: enabled" | sudo tee -a /etc/mongod.conf
    sudo systemctl restart mongod
    sleep 3
fi

# Create admin user
echo -e "${YELLOW}👤 Creating MongoDB admin user...${NC}"
mongosh admin --eval "
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
    print('❌ Error: ' + e.message);
  }
}
"

# Create application database and user
echo -e "${YELLOW}🗄️  Creating application database...${NC}"
mongosh whatsapp_production --eval "
try {
  db.createUser({
    user: 'whatsapp-user',
    pwd: '$DB_PASSWORD',
    roles: [
      { role: 'readWrite', db: 'whatsapp_production' },
      { role: 'dbAdmin', db: 'whatsapp_production' }
    ]
  });
  print('✅ Application user created');
} catch(e) {
  if (e.code === 11000) {
    print('⚠️  Application user already exists');
  } else {
    print('❌ Error: ' + e.message);
  }
}
"

# Step 3: Create production environment file
echo -e "${BLUE}📝 Creating production environment...${NC}"
cat > "$APP_DIR/.env" << EOF
# WhatsApp Manager Production Configuration
NODE_ENV=production
PORT=5000
SERVER_ID=vps-wa-plest-de
FRONTEND_URL=https://${DOMAIN}

# Database
MONGODB_URI=mongodb://whatsapp-user:${DB_PASSWORD}@localhost:27017/whatsapp_production?authSource=whatsapp_production

# Security
JWT_SECRET=${JWT_SECRET}
SESSION_SECRET=$(openssl rand -base64 32)

# Production Instance Manager
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

# Puppeteer (Ubuntu optimized)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
EOF

# Set secure permissions
chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

# Save credentials for later reference
cat > "$APP_DIR/.env.credentials" << EOF
# MongoDB Credentials (Generated $(date))
MONGODB_ADMIN_PASSWORD=${ADMIN_PASSWORD}
MONGODB_APP_PASSWORD=${DB_PASSWORD}
APP_JWT_SECRET=${JWT_SECRET}

# Connection strings:
# Admin: mongodb://admin:${ADMIN_PASSWORD}@localhost:27017/admin
# App:   mongodb://whatsapp-user:${DB_PASSWORD}@localhost:27017/whatsapp_production
EOF

chmod 600 "$APP_DIR/.env.credentials"
chown "$APP_USER:$APP_USER" "$APP_DIR/.env.credentials"

# Step 4: Run database migration
echo -e "${BLUE}📊 Running database migration...${NC}"
sudo -u "$APP_USER" node migrations/001-extend-instance-schema.js up

# Step 5: Create initial admin user
echo -e "${BLUE}👤 Creating application admin user...${NC}"
sudo -u "$APP_USER" ADMIN_EMAIL="admin@${DOMAIN}" ADMIN_PASSWORD="$ADMIN_PASSWORD" node scripts/create-admin.js

# Step 6: Install systemd service
echo -e "${BLUE}⚙️  Installing systemd service...${NC}"
cp deploy/whatsapp-manager.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable whatsapp-manager

# Step 7: Setup Nginx for domain
echo -e "${BLUE}🌐 Configuring Nginx for $DOMAIN...${NC}"
cp deploy/nginx-whatsapp-manager.conf /etc/nginx/sites-available/whatsapp-manager
sed -i "s/your-domain.com/$DOMAIN/g" /etc/nginx/sites-available/whatsapp-manager
ln -sf /etc/nginx/sites-available/whatsapp-manager /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Step 8: Setup SSL certificate
echo -e "${BLUE}🔐 Setting up SSL certificate for $DOMAIN...${NC}"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" --redirect

# Step 9: Start the service
echo -e "${BLUE}🚀 Starting WhatsApp Manager service...${NC}"
systemctl start whatsapp-manager

# Wait for startup
sleep 10

# Step 10: Verify everything works
echo -e "${BLUE}🧪 Testing installation...${NC}"

# Test local health
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Local health check passed${NC}"
else
    echo -e "${RED}❌ Local health check failed${NC}"
    echo "Check logs: sudo journalctl -u whatsapp-manager -n 50"
fi

# Test domain health
if curl -f -s "https://$DOMAIN/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Domain health check passed${NC}"
else
    echo -e "${YELLOW}⚠️  Domain health check failed (SSL might still be setting up)${NC}"
fi

# Final summary
echo ""
echo -e "${GREEN}🎉 WhatsApp Manager setup completed!${NC}"
echo ""
echo -e "${BLUE}📋 Important Information:${NC}"
echo "Application URL: https://$DOMAIN"
echo "Health Check: https://$DOMAIN/api/health"
echo "API Docs: https://$DOMAIN (shows usage examples)"
echo ""
echo -e "${BLUE}🔐 Admin Credentials:${NC}"
echo "Email: admin@$DOMAIN"
echo "Password: $ADMIN_PASSWORD"
echo ""
echo -e "${BLUE}📁 Important Files:${NC}"
echo "Environment: $APP_DIR/.env"
echo "Credentials: $APP_DIR/.env.credentials"
echo "Logs: sudo journalctl -u whatsapp-manager -f"
echo ""
echo -e "${BLUE}⚙️  Service Commands:${NC}"
echo "Status: sudo systemctl status whatsapp-manager"
echo "Restart: sudo systemctl restart whatsapp-manager"
echo "Logs: sudo journalctl -u whatsapp-manager -f"
echo ""
echo -e "${BLUE}🔄 Future Updates:${NC}"
echo "Update: sudo $APP_DIR/deploy/deploy-app.sh update"
echo ""
echo -e "${GREEN}✅ Your WhatsApp Multi-Instance Manager is ready!${NC}"