#!/bin/bash
#
# WhatsApp Multi-Instance Manager - Ubuntu 22 VPS Installation Script
#
# Usage: sudo ./install-ubuntu22.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/whatsapp-manager"
SERVICE_USER="whatsapp-manager"
SERVICE_GROUP="whatsapp-manager"
NODE_VERSION="18"
DOMAIN="${1:-your-domain.com}"

echo -e "${BLUE}🚀 WhatsApp Multi-Instance Manager - Ubuntu 22 VPS Setup${NC}"
echo -e "${BLUE}================================================================${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root (use sudo)${NC}"
   exit 1
fi

echo -e "${YELLOW}📋 System Information:${NC}"
echo "OS: $(lsb_release -d | cut -f2)"
echo "Kernel: $(uname -r)"
echo "Architecture: $(uname -m)"
echo "Install Directory: $INSTALL_DIR"
echo "Service User: $SERVICE_USER"
echo "Domain: $DOMAIN"
echo ""

# Update system
echo -e "${BLUE}🔄 Updating system packages...${NC}"
apt update && apt upgrade -y

# Install system dependencies
echo -e "${BLUE}📦 Installing system dependencies...${NC}"
apt install -y \
    curl \
    wget \
    git \
    build-essential \
    python3 \
    python3-pip \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    unzip \
    htop \
    nginx \
    certbot \
    python3-certbot-nginx \
    ufw \
    fail2ban \
    logrotate \
    cron

# Install Node.js
echo -e "${BLUE}📦 Installing Node.js ${NODE_VERSION}...${NC}"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt install -y nodejs

# Install MongoDB
echo -e "${BLUE}📦 Installing MongoDB...${NC}"
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/6.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-6.0.list
apt update
apt install -y mongodb-org

# Install Redis (optional for caching)
echo -e "${BLUE}📦 Installing Redis...${NC}"
apt install -y redis-server

# Install Google Chrome for Puppeteer
echo -e "${BLUE}📦 Installing Google Chrome...${NC}"
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt update
apt install -y google-chrome-stable

# Create service user
echo -e "${BLUE}👤 Creating service user...${NC}"
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
    usermod -aG sudo "$SERVICE_USER"
fi

# Create directory structure
echo -e "${BLUE}📁 Creating directory structure...${NC}"
mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/sessions"
mkdir -p "$INSTALL_DIR/browser-profiles"
mkdir -p "$INSTALL_DIR/logs"
mkdir -p "$INSTALL_DIR/backups"
mkdir -p "/var/log/whatsapp-manager"

# Set permissions
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "/var/log/whatsapp-manager"
chmod 755 "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR/sessions"
chmod 750 "$INSTALL_DIR/browser-profiles"
chmod 755 "$INSTALL_DIR/logs"
chmod 755 "$INSTALL_DIR/backups"

echo -e "${BLUE}⚙️  Configuring system services...${NC}"

# Configure MongoDB
systemctl enable mongod
systemctl start mongod

# Create MongoDB user for WhatsApp Manager
echo -e "${BLUE}🔐 Setting up MongoDB authentication...${NC}"
mongo admin --eval "
db.createUser({
  user: 'admin',
  pwd: '$(openssl rand -base64 32)',
  roles: [ { role: 'userAdminAnyDatabase', db: 'admin' } ]
});
"

mongo whatsapp_production --eval "
db.createUser({
  user: 'whatsapp-user',
  pwd: '$(openssl rand -base64 32)',
  roles: [ { role: 'readWrite', db: 'whatsapp_production' } ]
});
"

# Configure Redis
sed -i 's/# requirepass foobared/requirepass '$(openssl rand -base64 32)'/' /etc/redis/redis.conf
systemctl enable redis-server
systemctl restart redis-server

# Configure Nginx
echo -e "${BLUE}🌐 Configuring Nginx...${NC}"
if [ -f "./nginx-whatsapp-manager.conf" ]; then
    cp "./nginx-whatsapp-manager.conf" "/etc/nginx/sites-available/whatsapp-manager"
    sed -i "s/your-domain.com/$DOMAIN/g" "/etc/nginx/sites-available/whatsapp-manager"
    ln -sf "/etc/nginx/sites-available/whatsapp-manager" "/etc/nginx/sites-enabled/whatsapp-manager"
    rm -f "/etc/nginx/sites-enabled/default"
    nginx -t && systemctl reload nginx
fi

# Configure systemd service
echo -e "${BLUE}⚙️  Installing systemd service...${NC}"
if [ -f "./whatsapp-manager.service" ]; then
    cp "./whatsapp-manager.service" "/etc/systemd/system/"
    sed -i "s|/opt/whatsapp-manager|$INSTALL_DIR|g" "/etc/systemd/system/whatsapp-manager.service"
    sed -i "s/whatsapp-manager/$SERVICE_USER/g" "/etc/systemd/system/whatsapp-manager.service"
    systemctl daemon-reload
fi

# Configure firewall
echo -e "${BLUE}🔥 Configuring firewall...${NC}"
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp  # HTTP
ufw allow 443/tcp # HTTPS
ufw allow from 127.0.0.1 to any port 5000 # Application port (local only)
ufw allow from 127.0.0.1 to any port 27017 # MongoDB (local only)

# Configure fail2ban
echo -e "${BLUE}🛡️  Configuring fail2ban...${NC}"
cat > /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
logpath = /var/log/nginx/whatsapp-manager-error.log
EOF

systemctl enable fail2ban
systemctl restart fail2ban

# Configure log rotation
echo -e "${BLUE}📋 Configuring log rotation...${NC}"
cat > /etc/logrotate.d/whatsapp-manager << EOF
$INSTALL_DIR/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    copytruncate
    su $SERVICE_USER $SERVICE_GROUP
}

/var/log/whatsapp-manager/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    copytruncate
    su $SERVICE_USER $SERVICE_GROUP
}
EOF

# Install application
echo -e "${BLUE}📥 Installing application...${NC}"
if [ -d "../" ]; then
    echo "Copying application files..."
    cp -r ../* "$INSTALL_DIR/"
    cd "$INSTALL_DIR"

    # Set ownership
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"

    # Install npm dependencies as service user
    sudo -u "$SERVICE_USER" npm install --production

    # Copy production environment
    if [ -f ".env.production" ]; then
        sudo -u "$SERVICE_USER" cp ".env.production" ".env"
        chmod 600 "$INSTALL_DIR/.env"
    fi
fi

# Configure cron jobs
echo -e "${BLUE}⏰ Setting up cron jobs...${NC}"
cat > /tmp/whatsapp-manager-cron << EOF
# WhatsApp Manager maintenance tasks
0 2 * * * $INSTALL_DIR/scripts/cleanup-sessions.sh
0 3 * * * $INSTALL_DIR/scripts/backup-database.sh
*/5 * * * * $INSTALL_DIR/scripts/health-check.sh
EOF

crontab -u "$SERVICE_USER" /tmp/whatsapp-manager-cron
rm /tmp/whatsapp-manager-cron

# Create maintenance scripts
echo -e "${BLUE}📝 Creating maintenance scripts...${NC}"
mkdir -p "$INSTALL_DIR/scripts"

# Health check script
cat > "$INSTALL_DIR/scripts/health-check.sh" << 'EOF'
#!/bin/bash
# Simple health check script

HEALTH_URL="http://localhost:5000/api/health"
ALERT_EMAIL="admin@your-domain.com"

if ! curl -f -s "$HEALTH_URL" > /dev/null; then
    echo "WhatsApp Manager health check failed at $(date)" | mail -s "WhatsApp Manager Alert" "$ALERT_EMAIL"
    systemctl restart whatsapp-manager
fi
EOF

# Session cleanup script
cat > "$INSTALL_DIR/scripts/cleanup-sessions.sh" << 'EOF'
#!/bin/bash
# Clean up old sessions and browser profiles

INSTALL_DIR="/opt/whatsapp-manager"
DAYS_OLD=7

find "$INSTALL_DIR/sessions" -type d -mtime +$DAYS_OLD -exec rm -rf {} +
find "$INSTALL_DIR/browser-profiles" -type d -mtime +$DAYS_OLD -exec rm -rf {} +
find "$INSTALL_DIR/logs" -name "*.log" -mtime +30 -delete
EOF

# Database backup script
cat > "$INSTALL_DIR/scripts/backup-database.sh" << 'EOF'
#!/bin/bash
# Backup MongoDB database

BACKUP_DIR="/opt/whatsapp-manager/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/whatsapp_production_$DATE.gz"

mongodump --db whatsapp_production --gzip --archive="$BACKUP_FILE"

# Keep only last 30 backups
ls -t "$BACKUP_DIR"/whatsapp_production_*.gz | tail -n +31 | xargs -r rm
EOF

# Make scripts executable
chmod +x "$INSTALL_DIR/scripts"/*.sh
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/scripts"

# SSL Certificate setup
echo -e "${BLUE}🔐 Setting up SSL certificate...${NC}"
if [ "$DOMAIN" != "your-domain.com" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" --redirect
fi

# Final system optimizations
echo -e "${BLUE}⚡ Applying system optimizations...${NC}"

# Increase file limits
cat >> /etc/security/limits.conf << EOF
$SERVICE_USER soft nofile 65536
$SERVICE_USER hard nofile 65536
EOF

# Optimize kernel parameters
cat >> /etc/sysctl.conf << EOF
# WhatsApp Manager optimizations
fs.file-max = 100000
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_max_syn_backlog = 65535
vm.swappiness = 10
EOF

sysctl -p

# Enable and start services
echo -e "${BLUE}🚀 Starting services...${NC}"
systemctl enable whatsapp-manager
systemctl start whatsapp-manager

echo -e "${GREEN}✅ Installation completed successfully!${NC}"
echo ""
echo -e "${BLUE}📊 Service Status:${NC}"
systemctl --no-pager status whatsapp-manager

echo ""
echo -e "${BLUE}🔗 Important URLs:${NC}"
echo "Application: https://$DOMAIN"
echo "Health Check: https://$DOMAIN/api/health"
echo "Metrics: https://$DOMAIN/metrics"

echo ""
echo -e "${BLUE}📁 Important Paths:${NC}"
echo "Application: $INSTALL_DIR"
echo "Logs: $INSTALL_DIR/logs"
echo "Sessions: $INSTALL_DIR/sessions"
echo "Backups: $INSTALL_DIR/backups"

echo ""
echo -e "${BLUE}⚙️  Useful Commands:${NC}"
echo "Check status: sudo systemctl status whatsapp-manager"
echo "View logs: sudo journalctl -u whatsapp-manager -f"
echo "Restart service: sudo systemctl restart whatsapp-manager"

echo ""
echo -e "${GREEN}🎉 WhatsApp Multi-Instance Manager is ready for production!${NC}"