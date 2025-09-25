#!/bin/bash
#
# FIX-CLOUDFLARE-TIMEOUT.sh - Fixes Cloudflare 524 timeout errors
#
# Increases Nginx timeouts and optimizes for Cloudflare
# without changing Cloudflare settings
#
# Usage: sudo ./FIX-CLOUDFLARE-TIMEOUT.sh
#

set -e

echo "🔧 Fixing Cloudflare 524 timeout errors..."

# Update Nginx config with longer timeouts
sudo tee /etc/nginx/sites-available/whatsapp-manager << 'EOF'
server {
    listen 80;
    server_name wa.plest.de;

    # Extended timeouts for Cloudflare
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Optimize for Cloudflare
        proxy_buffering off;
        proxy_cache off;
        proxy_socket_keepalive on;

        # Extended timeouts
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    location /api/health {
        proxy_pass http://127.0.0.1:5000;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        access_log off;
    }
}
EOF

# Test and reload Nginx
sudo nginx -t && sudo systemctl reload nginx

echo "✅ Nginx timeouts increased for Cloudflare"
echo "🧪 Testing..."

# Test health endpoint
if curl -f -s "http://127.0.0.1:5000/api/health" > /dev/null; then
    echo "✅ Local backend: Working"
else
    echo "❌ Local backend: Failed"
fi

echo "🎯 Cloudflare 524 timeout fix applied!"
echo "Test: http://wa.plest.de/api/health"