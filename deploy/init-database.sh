#!/bin/bash
#
# WhatsApp Manager - Database Initialization Script
#
# Creates MongoDB users, databases, and initial admin account
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
DB_NAME="whatsapp_production"
DB_USER="whatsapp-user"
ADMIN_USER="admin"

echo -e "${BLUE}🔧 WhatsApp Manager - Database Setup${NC}"
echo -e "${BLUE}=====================================${NC}"

# Generate secure passwords
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)

echo -e "${YELLOW}🔐 Generated secure passwords${NC}"

# Check if MongoDB is running
if ! systemctl is-active --quiet mongod; then
    echo -e "${YELLOW}🔄 Starting MongoDB...${NC}"
    systemctl start mongod
    sleep 3
fi

# Create MongoDB admin user
echo -e "${YELLOW}👤 Creating MongoDB admin user...${NC}"
mongo admin --eval "
try {
  db.createUser({
    user: 'root',
    pwd: '$ROOT_PASSWORD',
    roles: [ { role: 'root', db: 'admin' } ]
  });
  print('✅ Root user created');
} catch(e) {
  if (e.code === 11000) {
    print('⚠️  Root user already exists');
  } else {
    throw e;
  }
}
"

# Create application database and user
echo -e "${YELLOW}🗄️  Creating application database...${NC}"
mongo "$DB_NAME" --eval "
try {
  db.createUser({
    user: '$DB_USER',
    pwd: '$DB_PASSWORD',
    roles: [
      { role: 'readWrite', db: '$DB_NAME' },
      { role: 'dbAdmin', db: '$DB_NAME' }
    ]
  });
  print('✅ Application user created');
} catch(e) {
  if (e.code === 11000) {
    print('⚠️  Application user already exists');
  } else {
    throw e;
  }
}
"

# Create initial collections and indexes
echo -e "${YELLOW}📊 Creating collections and indexes...${NC}"
mongo "$DB_NAME" -u "$DB_USER" -p "$DB_PASSWORD" --eval "
// Create collections
db.createCollection('users');
db.createCollection('instances');
db.createCollection('messages');

// Create indexes for performance
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ createdAt: -1 });

db.instances.createIndex({ instanceId: 1 }, { unique: true });
db.instances.createIndex({ apiKey: 1 }, { unique: true });
db.instances.createIndex({ userId: 1, status: 1 });
db.instances.createIndex({ serverId: 1, status: 1 });
db.instances.createIndex({ processId: 1 });
db.instances.createIndex({ lastHeartbeat: 1 });
db.instances.createIndex({ createdAt: -1 });

db.messages.createIndex({ instanceId: 1, timestamp: -1 });
db.messages.createIndex({ userId: 1, createdAt: -1 });
db.messages.createIndex({ chatId: 1, timestamp: -1 });
db.messages.createIndex({ messageId: 1 }, { unique: true });

print('✅ Collections and indexes created');
"

# Enable MongoDB authentication
echo -e "${YELLOW}🔒 Enabling MongoDB authentication...${NC}"
if ! grep -q "security:" /etc/mongod.conf; then
    echo "security:" >> /etc/mongod.conf
    echo "  authorization: enabled" >> /etc/mongod.conf
    systemctl restart mongod
    sleep 5
    echo "✅ Authentication enabled"
else
    echo "⚠️  Authentication already configured"
fi

# Create environment file with DB credentials
echo -e "${YELLOW}📝 Creating production environment...${NC}"
cat > "/opt/whatsapp-manager/.env.db" << EOF
# Database Configuration (Auto-generated $(date))
MONGODB_URI=mongodb://${DB_USER}:${DB_PASSWORD}@localhost:27017/${DB_NAME}?authSource=${DB_NAME}
MONGODB_ROOT_URI=mongodb://root:${ROOT_PASSWORD}@localhost:27017/admin?authSource=admin

# Generated Passwords (Keep secure!)
DB_PASSWORD=${DB_PASSWORD}
ROOT_PASSWORD=${ROOT_PASSWORD}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF

chmod 600 "/opt/whatsapp-manager/.env.db"
chown "$APP_USER:$APP_USER" "/opt/whatsapp-manager/.env.db"

# Create first admin user in application
echo -e "${YELLOW}👤 Creating application admin user...${NC}"
if [ -f "/opt/whatsapp-manager/scripts/create-admin.js" ]; then
    cd "/opt/whatsapp-manager"
    sudo -u "$APP_USER" ADMIN_EMAIL="admin@localhost" ADMIN_PASSWORD="$ADMIN_PASSWORD" node scripts/create-admin.js
fi

# Summary
echo -e "${GREEN}🎉 Database setup completed!${NC}"
echo ""
echo -e "${BLUE}📋 Important Information:${NC}"
echo "Database Name: $DB_NAME"
echo "Database User: $DB_USER"
echo "MongoDB Root User: root"
echo ""
echo -e "${BLUE}🔐 Credentials saved to:${NC}"
echo "/opt/whatsapp-manager/.env.db"
echo ""
echo -e "${BLUE}🔗 Connection String:${NC}"
echo "mongodb://${DB_USER}:${DB_PASSWORD}@localhost:27017/${DB_NAME}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Backup these credentials securely!${NC}"
echo ""
echo -e "${BLUE}🧪 Test database connection:${NC}"
echo "mongo \"$DB_NAME\" -u \"$DB_USER\" -p \"$DB_PASSWORD\""