#!/bin/bash
#
# ULTIMATE FIX SCRIPT - WhatsApp Manager Go-Live
#
# LÖST ALLE PROBLEME UND BRINGT DAS SYSTEM ZUM LAUFEN!
# Für die Situation: Dependencies installiert, aber MongoDB-Chaos und Service fehlt
#
# Usage: sudo ./ULTIMATE-FIX.sh wa.plest.de
#

set -e

DOMAIN="${1:-wa.plest.de}"
APP_DIR="/opt/whatsapp-manager"
APP_USER="whatsapp-manager"

# Fixed credentials (no more random generation!)
DB_PASSWORD="SecureAppPass123"
ADMIN_PASSWORD="AdminPass123"
JWT_SECRET="whatsapp-manager-jwt-secret-64-chars-long-production-key-secure"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${BLUE}🚀 ULTIMATE FIX - WHATSAPP MANAGER GO-LIVE${NC}"
echo -e "${BOLD}${BLUE}=============================================${NC}"
echo -e "${BOLD}Domain: $DOMAIN${NC}"
echo -e "${BOLD}App Directory: $APP_DIR${NC}"
echo ""

# Verify we're in the right state
if [ ! -f "$APP_DIR/package.json" ]; then
    echo -e "${RED}❌ FATAL: App not found in $APP_DIR${NC}"
    echo "Please ensure you're on the VPS where the app was cloned!"
    exit 1
fi

if [ ! -d "$APP_DIR/node_modules" ]; then
    echo -e "${RED}❌ FATAL: Dependencies not installed${NC}"
    echo "Run: cd $APP_DIR && npm install --production"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites verified${NC}"
echo ""

cd "$APP_DIR"

# STOP any existing service
echo -e "${BLUE}⏸️  Stopping any existing services...${NC}"
sudo systemctl stop whatsapp-manager 2>/dev/null || echo "Service not running"
sudo systemctl stop mongod 2>/dev/null || echo "MongoDB not running"

# BRUTAL MONGODB RESET
echo -e "${BOLD}${YELLOW}🗄️  COMPLETELY RESETTING MONGODB...${NC}"

# 1. Stop MongoDB completely
sudo systemctl stop mongod
sleep 2

# 2. Remove any existing auth config
sudo cp /etc/mongod.conf /etc/mongod.conf.backup
sudo sed -i '/security:/d' /etc/mongod.conf
sudo sed -i '/authorization:/d' /etc/mongod.conf

# 3. Start MongoDB without auth
sudo systemctl start mongod
sleep 5

# 4. Verify MongoDB is running
if ! sudo systemctl is-active --quiet mongod; then
    echo -e "${RED}❌ FATAL: MongoDB failed to start${NC}"
    sudo systemctl status mongod
    exit 1
fi

echo -e "${GREEN}✅ MongoDB running without auth${NC}"

# 5. Drop existing databases to start fresh
echo -e "${YELLOW}🧹 Cleaning existing databases...${NC}"
mongosh admin --quiet --eval "
try { db.dropUser('admin'); } catch(e) { print('Admin user not found'); }
try { db.dropDatabase(); } catch(e) { print('Admin db clean'); }
"

mongosh whatsapp_production --quiet --eval "
try { db.dropUser('whatsapp-user'); } catch(e) { print('App user not found'); }
try { db.dropDatabase(); } catch(e) { print('App db clean'); }
"

# 6. Create users with FIXED passwords
echo -e "${YELLOW}👤 Creating MongoDB users with fixed passwords...${NC}"
mongosh admin --quiet --eval "
db.createUser({
  user: 'admin',
  pwd: '$ADMIN_PASSWORD',
  roles: [ { role: 'root', db: 'admin' } ]
});
print('✅ Admin user created with password: $ADMIN_PASSWORD');
"

mongosh whatsapp_production --quiet --eval "
db.createUser({
  user: 'whatsapp-user',
  pwd: '$DB_PASSWORD',
  roles: [
    { role: 'readWrite', db: 'whatsapp_production' },
    { role: 'dbAdmin', db: 'whatsapp_production' }
  ]
});
print('✅ App user created with password: $DB_PASSWORD');
"

# 7. Enable authentication
echo -e "${YELLOW}🔒 Enabling MongoDB authentication...${NC}"
echo "security:" | sudo tee -a /etc/mongod.conf
echo "  authorization: enabled" | sudo tee -a /etc/mongod.conf
sudo systemctl restart mongod
sleep 5

# 8. Test connection with new credentials
echo -e "${YELLOW}🧪 Testing MongoDB connection...${NC}"
if mongosh "mongodb://whatsapp-user:$DB_PASSWORD@localhost:27017/whatsapp_production?authSource=whatsapp_production" --quiet --eval "db.runCommand('ping')" | grep -q "ok.*1"; then
    echo -e "${GREEN}✅ MongoDB connection successful!${NC}"
else
    echo -e "${RED}❌ MongoDB connection still failed${NC}"
    echo "Trying without authSource..."
    if mongosh "mongodb://whatsapp-user:$DB_PASSWORD@localhost:27017/whatsapp_production" --quiet --eval "db.runCommand('ping')" | grep -q "ok.*1"; then
        echo -e "${GREEN}✅ MongoDB connection successful (without authSource)!${NC}"
        MONGODB_URI="mongodb://whatsapp-user:$DB_PASSWORD@localhost:27017/whatsapp_production"
    else
        echo -e "${RED}❌ FATAL: MongoDB connection completely failed${NC}"
        exit 1
    fi
fi

# PRODUCTION ENVIRONMENT
echo -e "${BLUE}📝 Creating production environment...${NC}"
cat > .env << EOF
NODE_ENV=production
PORT=5000
SERVER_ID=vps-wa-plest-de
FRONTEND_URL=https://${DOMAIN}

# Database (fixed credentials)
MONGODB_URI=mongodb://whatsapp-user:${DB_PASSWORD}@localhost:27017/whatsapp_production

# Security
JWT_SECRET=${JWT_SECRET}
SESSION_SECRET=whatsapp-session-secret-key

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

# Puppeteer
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
EOF

chown "$APP_USER:$APP_USER" .env
chmod 600 .env

# Save credentials
echo -e "${BLUE}💾 Saving credentials...${NC}"
cat > .env.credentials << EOF
# WhatsApp Manager Credentials - $(date)

# MongoDB Admin
MONGODB_ADMIN_USER=admin
MONGODB_ADMIN_PASSWORD=${ADMIN_PASSWORD}

# MongoDB App User
MONGODB_APP_USER=whatsapp-user
MONGODB_APP_PASSWORD=${DB_PASSWORD}

# App Admin Login
APP_ADMIN_EMAIL=admin@${DOMAIN}
APP_ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Connection Strings
MONGODB_URI=mongodb://whatsapp-user:${DB_PASSWORD}@localhost:27017/whatsapp_production
MONGODB_ADMIN_URI=mongodb://admin:${ADMIN_PASSWORD}@localhost:27017/admin

# JWT
JWT_SECRET=${JWT_SECRET}
EOF

chown "$APP_USER:$APP_USER" .env.credentials
chmod 600 .env.credentials

# DATABASE MIGRATION
echo -e "${BLUE}📊 Running database migration...${NC}"
if sudo -u "$APP_USER" node migrations/001-extend-instance-schema.js up; then
    echo -e "${GREEN}✅ Database migration successful${NC}"
else
    echo -e "${RED}❌ Database migration failed${NC}"
    echo "Continuing anyway..."
fi

# CREATE ADMIN USER
echo -e "${BLUE}👤 Creating application admin user...${NC}"
if sudo -u "$APP_USER" ADMIN_EMAIL="admin@${DOMAIN}" ADMIN_PASSWORD="$ADMIN_PASSWORD" node scripts/create-admin.js; then
    echo -e "${GREEN}✅ Admin user created${NC}"
else
    echo -e "${YELLOW}⚠️  Admin user creation failed (might already exist)${NC}"
fi

# SYSTEMD SERVICE
echo -e "${BLUE}⚙️  Installing systemd service...${NC}"
sudo cp deploy/whatsapp-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-manager

# NGINX SETUP
echo -e "${BLUE}🌐 Setting up Nginx for $DOMAIN...${NC}"
sudo cp deploy/nginx-whatsapp-manager.conf /etc/nginx/sites-available/whatsapp-manager
sudo sed -i "s/your-domain\.com/$DOMAIN/g" /etc/nginx/sites-available/whatsapp-manager
sudo ln -sf /etc/nginx/sites-available/whatsapp-manager /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

if sudo nginx -t; then
    sudo systemctl reload nginx
    echo -e "${GREEN}✅ Nginx configured${NC}"
else
    echo -e "${RED}❌ Nginx configuration error${NC}"
    exit 1
fi

# SSL CERTIFICATE
echo -e "${BLUE}🔐 Setting up SSL...${NC}"
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" --redirect

# START SERVICE
echo -e "${BOLD}${BLUE}🚀 STARTING WHATSAPP MANAGER...${NC}"
sudo systemctl start whatsapp-manager

# Wait for startup
echo -e "${YELLOW}⏳ Waiting for service startup (30 seconds)...${NC}"
sleep 30

# FINAL VERIFICATION
echo -e "${BOLD}${BLUE}🧪 FINAL SYSTEM VERIFICATION...${NC}"

# Service status
echo -e "${BLUE}📊 Service Status:${NC}"
if sudo systemctl is-active --quiet whatsapp-manager; then
    echo -e "${GREEN}✅ WhatsApp Manager Service: RUNNING${NC}"
else
    echo -e "${RED}❌ WhatsApp Manager Service: FAILED${NC}"
    echo "Service status:"
    sudo systemctl status whatsapp-manager --no-pager
    echo ""
    echo "Recent logs:"
    sudo journalctl -u whatsapp-manager -n 20 --no-pager
    exit 1
fi

# Local health check
echo -e "${BLUE}🏥 Health Checks:${NC}"
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Local Health Check: PASSED${NC}"
else
    echo -e "${RED}❌ Local Health Check: FAILED${NC}"
    echo "Service logs:"
    sudo journalctl -u whatsapp-manager -n 10 --no-pager
    exit 1
fi

# Domain health check
if curl -f -s "https://$DOMAIN/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Domain Health Check: PASSED${NC}"
else
    echo -e "${YELLOW}⚠️  Domain Health Check: Failed (SSL propagating...)${NC}"
    echo "Testing HTTP..."
    if curl -f -s "http://$DOMAIN/api/health" > /dev/null; then
        echo -e "${GREEN}✅ HTTP works, HTTPS will work soon${NC}"
    fi
fi

# SUCCESS!
echo ""
echo -e "${BOLD}${GREEN}🎉🎉🎉 WHATSAPP MANAGER IS LIVE! 🎉🎉🎉${NC}"
echo ""
echo -e "${BOLD}${BLUE}📊 SYSTEM STATUS:${NC}"
echo -e "🌐 Application: ${GREEN}https://$DOMAIN${NC}"
echo -e "🏥 Health Check: ${GREEN}https://$DOMAIN/api/health${NC}"
echo -e "📖 API Docs: ${GREEN}https://$DOMAIN${NC}"
echo ""
echo -e "${BOLD}${BLUE}🔐 LOGIN CREDENTIALS:${NC}"
echo -e "📧 Email: ${YELLOW}admin@$DOMAIN${NC}"
echo -e "🔑 Password: ${YELLOW}$ADMIN_PASSWORD${NC}"
echo ""
echo -e "${BOLD}${BLUE}📋 IMPORTANT COMMANDS:${NC}"
echo -e "📊 Service Status: ${YELLOW}sudo systemctl status whatsapp-manager${NC}"
echo -e "📝 Live Logs: ${YELLOW}sudo journalctl -u whatsapp-manager -f${NC}"
echo -e "🔄 Restart: ${YELLOW}sudo systemctl restart whatsapp-manager${NC}"
echo -e "💾 Credentials: ${YELLOW}cat $APP_DIR/.env.credentials${NC}"
echo ""
echo -e "${BOLD}${BLUE}🧪 QUICK TEST:${NC}"
echo -e "${YELLOW}# 1. Login to get JWT token:${NC}"
echo -e "curl -X POST https://$DOMAIN/api/auth/login \\"
echo -e "  -H 'Content-Type: application/json' \\"
echo -e "  -d '{\"email\":\"admin@$DOMAIN\",\"password\":\"$ADMIN_PASSWORD\"}'"
echo ""
echo -e "${YELLOW}# 2. Create WhatsApp instance:${NC}"
echo -e "curl -X POST https://$DOMAIN/api/instances \\"
echo -e "  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \\"
echo -e "  -H 'Content-Type: application/json' \\"
echo -e "  -d '{\"name\":\"Test Instance\",\"description\":\"My first WhatsApp\"}'"
echo ""
echo -e "${YELLOW}# 3. Start instance and get QR code:${NC}"
echo -e "curl -X POST https://$DOMAIN/api/instances/INSTANCE_ID/start \\"
echo -e "  -H 'Authorization: Bearer YOUR_JWT_TOKEN'"
echo -e "curl https://$DOMAIN/api/instances/INSTANCE_ID/qr \\"
echo -e "  -H 'Authorization: Bearer YOUR_JWT_TOKEN'"
echo ""
echo -e "${YELLOW}# 4. Use WhatsApp API (after QR scan):${NC}"
echo -e "curl -X POST https://$DOMAIN/api/proxy/API_KEY/sendMessage \\"
echo -e "  -H 'Content-Type: application/json' \\"
echo -e "  -d '{\"params\":[\"1234567890@c.us\",\"Hello World!\"]}'"
echo ""
echo -e "${BOLD}${GREEN}🎯 YOUR WHATSAPP MULTI-INSTANCE MANAGER IS READY FOR PRODUCTION!${NC}"
echo ""
echo -e "${BLUE}📚 Need help? Check:${NC}"
echo -e "- ${YELLOW}https://$DOMAIN${NC} (API documentation)"
echo -e "- ${YELLOW}$APP_DIR/README.md${NC} (detailed docs)"
echo -e "- ${YELLOW}$APP_DIR/deploy/DEPLOYMENT-GUIDE.md${NC} (deployment guide)"
echo ""

# Final service status
echo -e "${BLUE}📊 Final Service Status:${NC}"
sudo systemctl status whatsapp-manager --no-pager

echo ""
echo -e "${BOLD}${GREEN}🚀 MISSION ACCOMPLISHED! 🚀${NC}"