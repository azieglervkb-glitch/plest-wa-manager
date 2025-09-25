const { createServer } = require('http');
const { parse } = require('url');
const path = require('path');

// For standalone build, we need to use the built server
const dev = false;
const hostname = 'localhost';
const port = 3000;

console.log('🎨 Starting WhatsApp Manager Frontend (Standalone)...');

// Check if standalone build exists
const standalonePath = path.join(__dirname, '.next/standalone/server.js');
const fs = require('fs');

if (fs.existsSync(standalonePath)) {
  console.log('✅ Using Next.js standalone server');

  // Set required environment variables for standalone
  process.env.HOSTNAME = hostname;
  process.env.PORT = port.toString();

  // Require the standalone server
  require(standalonePath);

} else {
  console.log('❌ Standalone build not found, using fallback');

  // Fallback: Try to use next directly
  const next = require('next');
  const app = next({ dev: false, dir: __dirname });
  const handle = app.getRequestHandler();

  app.prepare().then(() => {
    createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error('Frontend error:', err);
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    }).listen(port, hostname, (err) => {
      if (err) throw err;
      console.log(`✅ Frontend ready on http://${hostname}:${port}`);
    });
  }).catch((ex) => {
    console.error('Frontend startup failed:', ex);
    process.exit(1);
  });
}