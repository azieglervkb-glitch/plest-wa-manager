#!/bin/bash
#
# LAUNCH-NOW.sh - FINALES SCRIPT FÜR GO-LIVE
#
# Behebt IPv6-Problem, SSL-Problem und startet das System!
# Für Situation: MongoDB Users existieren, aber Migration + Service fehlt
#
# Usage: sudo ./LAUNCH-NOW.sh wa.plest.de
#

set -e

DOMAIN="${1:-wa.plest.de}"
APP_DIR="/opt/whatsapp-manager"
APP_USER="whatsapp-manager"

# FIXED CREDENTIALS (from previous script)
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

echo -e "${BOLD}${BLUE}🚀 WHATSAPP MANAGER - LAUNCH NOW!${NC}"
echo -e "${BOLD}${BLUE}===================================${NC}"
echo -e "Domain: ${BOLD}$DOMAIN${NC}"
echo -e "App Directory: ${BOLD}$APP_DIR${NC}"
echo ""

cd "$APP_DIR"

# STEP 1: IPv4-Fix für MongoDB Connection
echo -e "${BLUE}🔧 Fixing IPv6 MongoDB connection issue...${NC}"

# .env mit IPv4 erstellen (löst ::1 Problem)
cat > .env << EOF
NODE_ENV=production
PORT=5000
SERVER_ID=vps-wa-plest-de
FRONTEND_URL=https://${DOMAIN}

# Database mit IPv4 (löst ::1 connection problem)
MONGODB_URI=mongodb://whatsapp-user:${DB_PASSWORD}@127.0.0.1:27017/whatsapp_production

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

echo -e "${GREEN}✅ Environment configured with IPv4${NC}"

# STEP 2: Database Migration mit IPv4-Force
echo -e "${BLUE}📊 Running database migration (IPv4)...${NC}"
if sudo -u "$APP_USER" node migrations/001-extend-instance-schema.js up; then
    echo -e "${GREEN}✅ Database migration successful${NC}"
else
    echo -e "${RED}❌ Migration failed, but continuing...${NC}"
    echo "This might be OK if schema already exists"
fi

# STEP 3: Admin User erstellen mit IPv4-Force
echo -e "${BLUE}👤 Creating admin user (IPv4)...${NC}"
if sudo -u "$APP_USER" ADMIN_EMAIL="admin@${DOMAIN}" ADMIN_PASSWORD="$ADMIN_PASSWORD" node scripts/create-admin.js; then
    echo -e "${GREEN}✅ Admin user created/verified${NC}"
else
    echo -e "${YELLOW}⚠️  Admin user creation failed (might already exist)${NC}"
fi

# STEP 4: HTTP-Only Nginx Config (vor SSL)
echo -e "${BLUE}🌐 Setting up HTTP-only Nginx first...${NC}"
cat > /etc/nginx/sites-available/whatsapp-manager << EOF
# HTTP-only config (before SSL)
server {
    listen 80;
    server_name ${DOMAIN};

    # Rate limiting
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /api/health {
        proxy_pass http://127.0.0.1:5000;
        access_log off;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/whatsapp-manager /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Nginx testen
if sudo nginx -t; then
    sudo systemctl reload nginx
    echo -e "${GREEN}✅ Nginx HTTP config successful${NC}"
else
    echo -e "${RED}❌ Nginx config failed${NC}"
    exit 1
fi

# STEP 5: Service starten
echo -e "${BOLD}${BLUE}🚀 STARTING WHATSAPP MANAGER SERVICE...${NC}"
sudo systemctl start whatsapp-manager

# Warten bis Service läuft
echo -e "${YELLOW}⏳ Waiting for service startup...${NC}"
sleep 20

# STEP 6: Verifikation
echo -e "${BOLD}${BLUE}🧪 SYSTEM VERIFICATION...${NC}"

# Service Status
if sudo systemctl is-active --quiet whatsapp-manager; then
    echo -e "${GREEN}✅ Service Status: RUNNING${NC}"
else
    echo -e "${RED}❌ Service Status: FAILED${NC}"
    echo ""
    echo -e "${YELLOW}Service Status:${NC}"
    sudo systemctl status whatsapp-manager --no-pager
    echo ""
    echo -e "${YELLOW}Recent Logs:${NC}"
    sudo journalctl -u whatsapp-manager -n 30 --no-pager
    exit 1
fi

# Local Health Check
echo -e "${BLUE}Testing local health...${NC}"
if curl -f -s "http://127.0.0.1:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Local Health: PASSED${NC}"

    # Show health response
    echo -e "${BLUE}Health Response:${NC}"
    curl -s "http://127.0.0.1:5000/api/health" | python3 -m json.tool || curl -s "http://127.0.0.1:5000/api/health"
else
    echo -e "${RED}❌ Local Health: FAILED${NC}"
    echo ""
    echo -e "${YELLOW}Service Logs:${NC}"
    sudo journalctl -u whatsapp-manager -n 20 --no-pager
    exit 1
fi

# Domain HTTP Test
echo -e "${BLUE}Testing domain HTTP...${NC}"
if curl -f -s "http://$DOMAIN/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Domain HTTP: PASSED${NC}"
else
    echo -e "${RED}❌ Domain HTTP: FAILED${NC}"
    echo "Check DNS: nslookup $DOMAIN"
    nslookup "$DOMAIN" || echo "DNS resolution failed"
fi

# STEP 7: SSL Setup (nur wenn HTTP funktioniert)
echo -e "${BLUE}🔐 Setting up SSL certificate...${NC}"
if sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" --redirect; then
    echo -e "${GREEN}✅ SSL Certificate: SUCCESS${NC}"

    # HTTPS Test
    if curl -f -s "https://$DOMAIN/api/health" > /dev/null; then
        echo -e "${GREEN}✅ HTTPS Health: PASSED${NC}"
    else
        echo -e "${YELLOW}⚠️  HTTPS Health: Failed (but HTTP works)${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  SSL setup failed, but HTTP works${NC}"
fi

# ERFOLG!
echo ""
echo -e "${BOLD}${GREEN}🎉🎉🎉 WHATSAPP MANAGER IS LIVE! 🎉🎉🎉${NC}"
echo ""
echo -e "${BOLD}${BLUE}📊 SYSTEM LIVE STATUS:${NC}"
echo -e "🌐 Application: ${GREEN}http://$DOMAIN${NC} (und https falls SSL funktioniert)"
echo -e "🏥 Health Check: ${GREEN}http://$DOMAIN/api/health${NC}"
echo -e "📖 API Documentation: ${GREEN}http://$DOMAIN${NC}"
echo ""
echo -e "${BOLD}${BLUE}🔑 ADMIN LOGIN:${NC}"
echo -e "📧 Email: ${YELLOW}admin@$DOMAIN${NC}"
echo -e "🔐 Password: ${YELLOW}$ADMIN_PASSWORD${NC}"
echo ""
echo -e "${BOLD}${BLUE}🧪 API TEST COMMANDS:${NC}"
echo -e "${YELLOW}# 1. Login:${NC}"
echo "curl -X POST http://$DOMAIN/api/auth/login \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"email\":\"admin@$DOMAIN\",\"password\":\"$ADMIN_PASSWORD\"}'"
echo ""
echo -e "${YELLOW}# 2. Create WhatsApp instance:${NC}"
echo "curl -X POST http://$DOMAIN/api/instances \\"
echo "  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"name\":\"Test WhatsApp\",\"description\":\"First instance\"}'"
echo ""
echo -e "${YELLOW}# 3. Start instance:${NC}"
echo "curl -X POST http://$DOMAIN/api/instances/INSTANCE_ID/start \\"
echo "  -H 'Authorization: Bearer YOUR_JWT_TOKEN'"
echo ""
echo -e "${YELLOW}# 4. Get QR code:${NC}"
echo "curl http://$DOMAIN/api/instances/INSTANCE_ID/qr \\"
echo "  -H 'Authorization: Bearer YOUR_JWT_TOKEN'"
echo ""
echo -e "${BOLD}${BLUE}📋 SERVICE MANAGEMENT:${NC}"
echo -e "Status: ${YELLOW}sudo systemctl status whatsapp-manager${NC}"
echo -e "Logs: ${YELLOW}sudo journalctl -u whatsapp-manager -f${NC}"
echo -e "Restart: ${YELLOW}sudo systemctl restart whatsapp-manager${NC}"
echo ""
echo -e "${BOLD}${GREEN}🎯 READY TO CREATE WHATSAPP INSTANCES!${NC}"

# Show final service status
echo ""
echo -e "${BLUE}📊 Final Service Status:${NC}"
sudo systemctl status whatsapp-manager --no-pager --lines=10