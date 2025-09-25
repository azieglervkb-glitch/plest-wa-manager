#!/bin/bash
#
# FIX-RATE-LIMIT.sh - Fixes deprecated rate-limit middleware
#
# Fixes the "rateLimit is not a function" error by replacing
# deprecated express-rate-limit syntax with modern version
#
# Usage: sudo ./FIX-RATE-LIMIT.sh
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

echo -e "${BOLD}${BLUE}🔧 RATE-LIMIT MIDDLEWARE FIX${NC}"
echo -e "${BOLD}${BLUE}============================${NC}"
echo ""

cd "$APP_DIR"

# Backup original file
echo -e "${BLUE}💾 Creating backup...${NC}"
sudo cp middleware/rateLimit.js middleware/rateLimit.js.backup
echo -e "${GREEN}✅ Backup created: middleware/rateLimit.js.backup${NC}"

# Create modern rate-limit middleware
echo -e "${BLUE}🔧 Creating modern rate-limit middleware...${NC}"
sudo tee middleware/rateLimit.js << 'EOF'
const rateLimit = require('express-rate-limit');

/**
 * Modern Rate-Limit Middleware (express-rate-limit v6+ compatible)
 * Removes all deprecated options that cause warnings/errors
 */

// Simple rate-limit function without deprecated options
const createRateLimit = (options = {}) => {
  const defaults = {
    windowMs: 60000, // 1 minute
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests',
      message: 'Please try again later'
    },
    // Modern handler instead of deprecated onLimitReached
    handler: (req, res) => {
      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.round(options.windowMs / 1000) || 60
      });
    }
  };

  return rateLimit({
    ...defaults,
    ...options
  });
};

// Export the function directly
module.exports = createRateLimit;

// Also export as default for backward compatibility
module.exports.default = createRateLimit;
module.exports.createRateLimit = createRateLimit;
EOF

# Set correct ownership
sudo chown "$APP_USER:$APP_USER" middleware/rateLimit.js

echo -e "${GREEN}✅ Rate-limit middleware updated${NC}"

# Test the fix
echo -e "${BLUE}🧪 Testing rate-limit fix...${NC}"
if sudo -u "$APP_USER" node -c middleware/rateLimit.js; then
    echo -e "${GREEN}✅ Rate-limit syntax: OK${NC}"
else
    echo -e "${RED}❌ Rate-limit syntax: FAILED${NC}"
    exit 1
fi

# Test main server file
echo -e "${BLUE}🧪 Testing server.js syntax...${NC}"
if sudo -u "$APP_USER" node -c server.js; then
    echo -e "${GREEN}✅ Server.js syntax: OK${NC}"
else
    echo -e "${RED}❌ Server.js syntax: FAILED${NC}"
    echo "Check imports or other syntax errors"
    exit 1
fi

# Try starting the application
echo -e "${BOLD}${BLUE}🚀 TESTING APPLICATION START...${NC}"
echo -e "${YELLOW}Starting app in background to test...${NC}"

# Start in background and capture output
sudo -u "$APP_USER" timeout 10s node server.js > /tmp/whatsapp-test.log 2>&1 &
APP_PID=$!

sleep 5

# Check if app started successfully
if curl -f -s "http://localhost:5000/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Application started successfully!${NC}"
    kill $APP_PID 2>/dev/null || true

    echo -e "${BLUE}🏥 Health check response:${NC}"
    curl -s "http://localhost:5000/api/health" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:5000/api/health"

    echo ""
    echo -e "${BOLD}${GREEN}🎉 RATE-LIMIT FIX SUCCESSFUL!${NC}"
    echo ""
    echo -e "${BLUE}Ready to start systemd service:${NC}"
    echo -e "${YELLOW}sudo systemctl start whatsapp-manager${NC}"
    echo -e "${YELLOW}sudo systemctl status whatsapp-manager${NC}"

else
    echo -e "${RED}❌ Application still has issues${NC}"
    echo ""
    echo -e "${BLUE}Application output:${NC}"
    cat /tmp/whatsapp-test.log
    kill $APP_PID 2>/dev/null || true
fi

# Cleanup
rm -f /tmp/whatsapp-test.log

echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. sudo systemctl start whatsapp-manager"
echo "2. curl http://localhost:5000/api/health"
echo "3. curl http://wa.plest.de/api/health"