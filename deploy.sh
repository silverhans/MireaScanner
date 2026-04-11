#!/bin/bash
# Initial server setup script for Ubuntu
# Usage: bash deploy.sh
# Prerequisites: set DOMAIN and SERVER_IP environment variables, or edit them below.

set -e

DOMAIN="${DOMAIN:-your-domain.com}"
APP_DIR="/opt/qrscaner"

echo "=== System update ==="
apt update && apt upgrade -y

echo "=== Install dependencies ==="
apt install -y python3.11 python3.11-venv python3-pip nginx certbot python3-certbot-nginx git curl redis-server

echo "=== Install Node.js ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "=== Create app directory ==="
mkdir -p $APP_DIR
cd $APP_DIR

echo "=== Copy files (run manually) ==="
echo "rsync -az --exclude '.env' --exclude 'data/' --exclude 'venv/' /path/to/local/qrscaner/ root@YOUR_SERVER_IP:$APP_DIR/"

echo "=== Set up Python environment ==="
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

echo "=== Build webapp ==="
cd webapp
npm install
npm run build
cd ..

echo "=== Configure Nginx ==="
cat > /etc/nginx/sites-available/qrscaner << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    # Mini App (static files)
    location / {
        root /opt/qrscaner/webapp/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/qrscaner /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== Obtain SSL certificate ==="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m your@email.com

echo "=== Create systemd service ==="
cat > /etc/systemd/system/qrscaner.service << 'EOF'
[Unit]
Description=MIREA QR Scanner Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/qrscaner
Environment=PATH=/opt/qrscaner/venv/bin
ExecStart=/opt/qrscaner/venv/bin/python -m bot.main
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable qrscaner
systemctl start qrscaner

echo "=== Done! ==="
echo "Bot is running. Check status: systemctl status qrscaner"
echo "Logs: journalctl -u qrscaner -f"
