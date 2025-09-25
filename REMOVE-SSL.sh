#!/bin/bash
#
# REMOVE-SSL.sh - Removes SSL and restores HTTP-only setup
#
# Usage: sudo ./REMOVE-SSL.sh
#

set -e

echo "🔧 Removing SSL and restoring HTTP-only..."

# Remove Let's Encrypt SSL
sudo certbot delete --cert-name wa.plest.de --non-interactive || echo "SSL cert not found"

# Restore HTTP-only Nginx config
sudo tee /etc/nginx/sites-available/whatsapp-manager << 'EOF'
server {
    listen 80;
    server_name wa.plest.de;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/health {
        proxy_pass http://127.0.0.1:5000;
        access_log off;
    }
}
EOF

# Reload Nginx
sudo nginx -t && sudo systemctl reload nginx

echo "✅ SSL removed, HTTP-only restored"
echo "🧪 Testing: curl http://wa.plest.de/api/health"

curl http://wa.plest.de/api/health