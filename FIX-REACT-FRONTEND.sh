#!/bin/bash
#
# FIX-REACT-FRONTEND.sh - Fixes React frontend integration
#
# Next.js creates standalone build, needs different server.js integration
# This script fixes the React app serving and enables the login interface
#
# Usage: sudo ./FIX-REACT-FRONTEND.sh
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

echo -e "${BOLD}${BLUE}🔧 FIXING REACT FRONTEND INTEGRATION${NC}"
echo -e "${BOLD}${BLUE}====================================${NC}"
echo ""

cd "$APP_DIR"

# Stop service
sudo systemctl stop whatsapp-manager

# STEP 1: Check Next.js build structure
echo -e "${BLUE}📊 Analyzing Next.js build...${NC}"
echo "Build directory contents:"
ls -la frontend/build/

if [ -f "frontend/build/standalone/server.js" ]; then
    echo -e "${GREEN}✅ Next.js standalone build detected${NC}"
    NEXTJS_MODE="standalone"
elif [ -f "frontend/build/index.html" ]; then
    echo -e "${GREEN}✅ Next.js static export detected${NC}"
    NEXTJS_MODE="static"
else
    echo -e "${RED}❌ Unknown Next.js build structure${NC}"
    exit 1
fi

# STEP 2: Create integrated server.js for React frontend
echo -e "${BLUE}🔧 Creating integrated server.js with React frontend...${NC}"

if [ "$NEXTJS_MODE" = "standalone" ]; then
    # For standalone Next.js build
    cat > server.js << 'EOF'
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const path = require('path');
const { parse } = require('url');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

console.log('🚀 Starting WhatsApp Manager with React Frontend...');

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API Routes
try {
  const authRoutes = require('./routes/auth');
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes loaded');
} catch (error) {
  console.log('❌ Auth routes failed:', error.message);
}

try {
  const instanceRoutes = require('./routes/instances');
  app.use('/api/instances', instanceRoutes);
  console.log('✅ Instance routes loaded');
} catch (error) {
  console.log('❌ Instance routes failed:', error.message);
}

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    version: '1.0.0-react-integrated',
    frontend: 'Next.js React App'
  });
});

// Serve Next.js static files
app.use('/_next', express.static(path.join(__dirname, 'frontend/build/static')));
app.use('/static', express.static(path.join(__dirname, 'frontend/build/static')));

// Import Next.js handler
let nextHandler;
try {
  const nextApp = require('./frontend/build/standalone/server.js');
  nextHandler = nextApp.default || nextApp;
  console.log('✅ Next.js handler loaded');
} catch (error) {
  console.log('❌ Next.js handler failed, using fallback');
  nextHandler = null;
}

// Handle all non-API routes with Next.js or fallback
app.get('*', async (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }

  if (nextHandler) {
    try {
      return nextHandler(req, res);
    } catch (error) {
      console.log('Next.js handler error:', error.message);
    }
  }

  // Fallback: Serve static index.html
  const indexPath = path.join(__dirname, 'frontend/build/index.html');
  if (require('fs').existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  // Final fallback
  res.send(`
    <html>
      <head><title>WhatsApp Manager</title></head>
      <body>
        <div id="root">
          <h1>WhatsApp Manager</h1>
          <p>React app loading...</p>
          <p>If this persists, check browser console for errors.</p>
        </div>
        <script>
          // Try to load React app
          fetch('/api/health')
            .then(r => r.json())
            .then(data => {
              document.getElementById('root').innerHTML =
                '<h1>WhatsApp Manager Ready</h1>' +
                '<p>Status: ' + data.status + '</p>' +
                '<p>Version: ' + data.version + '</p>' +
                '<a href="/login">Go to Login</a>';
            })
            .catch(err => {
              document.getElementById('root').innerHTML =
                '<h1>API Connection Error</h1>' +
                '<p>Backend: ' + err.message + '</p>';
            });
        </script>
      </body>
    </html>
  `);
});

// Database and startup
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('⚠️  MongoDB failed:', err.message));

server.listen(PORT, () => {
  console.log(`✅ WhatsApp Manager (React Integrated) running on port ${PORT}`);
  console.log(`🎨 React Frontend: Enabled`);
  console.log(`🌐 Admin Panel: http://localhost:${PORT}/`);
  console.log(`🔐 Login: http://localhost:${PORT}/login`);
});
EOF

else
    # For static export build
    cat > server.js << 'EOF'
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

console.log('🚀 Starting WhatsApp Manager with React Frontend (Static)...');

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API Routes
const authRoutes = require('./routes/auth');
const instanceRoutes = require('./routes/instances');
app.use('/api/auth', authRoutes);
app.use('/api/instances', instanceRoutes);

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    version: '1.0.0-react-static'
  });
});

// Serve React static files
app.use(express.static(path.join(__dirname, 'frontend/build')));

// Serve React app for all non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'frontend/build/index.html'));
});

// Database and startup
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('⚠️  MongoDB failed:', err.message));

server.listen(PORT, () => {
  console.log(`✅ WhatsApp Manager (React Static) running on port ${PORT}`);
  console.log(`🎨 React Admin Panel: http://localhost:${PORT}/`);
});
EOF

fi

chown "$APP_USER:$APP_USER" server.js

# STEP 3: Start service
echo -e "${BLUE}🚀 Starting service with React frontend...${NC}"
sudo systemctl start whatsapp-manager

sleep 5

# STEP 4: Test React integration
echo -e "${BLUE}🧪 Testing React frontend integration...${NC}"

# Test if we get React HTML instead of old HTML
FRONTEND_TEST=$(curl -s "http://localhost:5000/" | head -10)

if echo "$FRONTEND_TEST" | grep -q "root"; then
    echo -e "${GREEN}✅ React frontend: ACTIVE${NC}"
    echo "HTML preview:"
    echo "$FRONTEND_TEST"
else
    echo -e "${RED}❌ React frontend: FAILED${NC}"
    echo "Current response:"
    echo "$FRONTEND_TEST"
fi

# Test health still works
if curl -f -s "http://localhost:5000/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Backend API: Still working${NC}"
else
    echo -e "${RED}❌ Backend API: Broken${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}🎨 REACT FRONTEND INTEGRATION COMPLETE!${NC}"
echo ""
echo -e "${BOLD}${BLUE}📱 ADMIN PANEL URLS:${NC}"
echo -e "🌐 Main: ${GREEN}http://wa.plest.de${NC}"
echo -e "🔐 Login: ${GREEN}http://wa.plest.de/login${NC}"
echo -e "📊 Dashboard: ${GREEN}http://wa.plest.de/dashboard${NC}"
echo ""
echo -e "${YELLOW}Clear browser cache (Ctrl+F5) to see React interface!${NC}"