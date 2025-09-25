# WhatsApp Multi-Instance Manager - Production Deployment Guide

## 🚀 Ubuntu 22 VPS Deployment

### Voraussetzungen
- Ubuntu 22.04 LTS VPS mit mindestens:
  - **4GB RAM** (8GB empfohlen für 50+ Instanzen)
  - **2 CPU Kerne** (4 empfohlen)
  - **50GB SSD** (100GB+ für viele Sessions)
- Root-Zugang zum Server
- Domain mit DNS auf Server-IP zeigend

### Schnell-Installation

```bash
# Repository klonen
git clone https://github.com/yourrepo/whatsapp-multi-instance-manager.git
cd whatsapp-multi-instance-manager/deploy

# Installation starten (Ersetze your-domain.com)
sudo ./install-ubuntu22.sh your-domain.com
```

Das Skript installiert automatisch:
- ✅ Node.js 18
- ✅ MongoDB 6.0 mit Authentifizierung
- ✅ Redis Server
- ✅ Google Chrome für Puppeteer
- ✅ Nginx mit SSL (Let's Encrypt)
- ✅ Systemd-Service
- ✅ Firewall-Konfiguration
- ✅ Log-Rotation
- ✅ Maintenance-Skripte

---

## 🔧 Manuelle Installation (Schritt-für-Schritt)

### 1. System-Dependencies installieren

```bash
# System updaten
sudo apt update && sudo apt upgrade -y

# Dependencies installieren
sudo apt install -y curl wget git build-essential python3 python3-pip \
    software-properties-common apt-transport-https ca-certificates gnupg \
    lsb-release unzip htop nginx certbot python3-certbot-nginx \
    ufw fail2ban logrotate cron

# Node.js 18 installieren
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt install -y nodejs

# MongoDB 6.0 installieren
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update && sudo apt install -y mongodb-org

# Redis installieren
sudo apt install -y redis-server

# Google Chrome für Puppeteer
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable
```

### 2. Service-User erstellen

```bash
sudo useradd --system --create-home --shell /bin/bash whatsapp-manager
sudo mkdir -p /opt/whatsapp-manager/{sessions,browser-profiles,logs,backups}
sudo chown -R whatsapp-manager:whatsapp-manager /opt/whatsapp-manager
```

### 3. Application installieren

```bash
# Code kopieren
sudo cp -r ../* /opt/whatsapp-manager/
cd /opt/whatsapp-manager

# Dependencies installieren
sudo -u whatsapp-manager npm install --production

# Environment konfigurieren
sudo -u whatsapp-manager cp .env.production .env
# .env editieren mit korrekten Werten!
```

### 4. MongoDB konfigurieren

```bash
# MongoDB starten
sudo systemctl enable mongod
sudo systemctl start mongod

# Admin-User erstellen
mongo admin --eval "
db.createUser({
  user: 'admin',
  pwd: 'your-secure-admin-password',
  roles: [ { role: 'userAdminAnyDatabase', db: 'admin' } ]
});
"

# App-User erstellen
mongo whatsapp_production --eval "
db.createUser({
  user: 'whatsapp-user',
  pwd: 'your-secure-app-password',
  roles: [ { role: 'readWrite', db: 'whatsapp_production' } ]
});
"

# MongoDB-Konfiguration kopieren
sudo cp mongodb-production.conf /etc/mongod.conf
sudo systemctl restart mongod
```

### 5. Nginx konfigurieren

```bash
# Nginx-Konfiguration kopieren
sudo cp nginx-whatsapp-manager.conf /etc/nginx/sites-available/whatsapp-manager

# Domain anpassen
sudo sed -i 's/your-domain.com/actual-domain.com/g' /etc/nginx/sites-available/whatsapp-manager

# Site aktivieren
sudo ln -s /etc/nginx/sites-available/whatsapp-manager /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 6. SSL-Zertifikat erstellen

```bash
# Let's Encrypt SSL
sudo certbot --nginx -d your-domain.com --non-interactive --agree-tos --email admin@your-domain.com --redirect
```

### 7. Systemd-Service installieren

```bash
sudo cp whatsapp-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-manager
sudo systemctl start whatsapp-manager
```

### 8. Firewall konfigurieren

```bash
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

---

## 📊 Monitoring & Wartung

### Service-Status prüfen

```bash
# Service-Status
sudo systemctl status whatsapp-manager

# Logs anzeigen
sudo journalctl -u whatsapp-manager -f

# Health-Check
curl https://your-domain.com/api/health

# Prometheus-Metriken
curl https://your-domain.com/metrics
```

### Wichtige Pfade

```bash
/opt/whatsapp-manager/                 # Application
/opt/whatsapp-manager/sessions/        # WhatsApp Sessions
/opt/whatsapp-manager/browser-profiles/# Browser-Profile
/opt/whatsapp-manager/logs/           # Application-Logs
/opt/whatsapp-manager/backups/        # Database-Backups
/var/log/whatsapp-manager/            # System-Logs
```

### Maintenance-Befehle

```bash
# Service neustarten
sudo systemctl restart whatsapp-manager

# Alte Sessions bereinigen
sudo /opt/whatsapp-manager/scripts/cleanup-sessions.sh

# Database-Backup erstellen
sudo /opt/whatsapp-manager/scripts/backup-database.sh

# Health-Check ausführen
sudo /opt/whatsapp-manager/scripts/health-check.sh
```

---

## 🔧 Konfiguration

### Environment-Variablen (.env)

```env
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb://whatsapp-user:password@localhost:27017/whatsapp_production
JWT_SECRET=your-jwt-secret
MAX_INSTANCES_PER_SERVER=100
HEALTH_CHECK_INTERVAL=30000
```

### Resource-Limits

```bash
# In /etc/systemd/system/whatsapp-manager.service
MemoryMax=8G
MemoryHigh=7G
CPUQuota=800%
```

### Systemd-Service-Commands

```bash
sudo systemctl start whatsapp-manager     # Starten
sudo systemctl stop whatsapp-manager      # Stoppen
sudo systemctl restart whatsapp-manager   # Neustarten
sudo systemctl reload whatsapp-manager    # Config neu laden
sudo systemctl status whatsapp-manager    # Status prüfen
sudo systemctl enable whatsapp-manager    # Auto-Start aktivieren
sudo systemctl disable whatsapp-manager   # Auto-Start deaktivieren
```

---

## 🚨 Troubleshooting

### Service startet nicht

```bash
# Logs prüfen
sudo journalctl -u whatsapp-manager --no-pager -l

# MongoDB-Verbindung testen
mongo whatsapp_production -u whatsapp-user -p

# Port-Verfügbarkeit prüfen
sudo netstat -tlnp | grep :5000
```

### High Memory Usage

```bash
# Memory-Usage pro Instance prüfen
curl -s http://localhost:5000/api/health/detailed | jq '.metrics.instances'

# Browser-Prozesse finden
ps aux | grep chrome

# Alte Sessions bereinigen
sudo /opt/whatsapp-manager/scripts/cleanup-sessions.sh
```

### SSL-Probleme

```bash
# Zertifikat erneuern
sudo certbot renew

# Nginx-Konfiguration testen
sudo nginx -t

# SSL-Status prüfen
openssl s_client -connect your-domain.com:443
```

---

## 📈 Performance-Optimierung

### Für 50+ Instanzen

1. **RAM erhöhen**: 8GB+ empfohlen
2. **SSD verwenden**: Bessere I/O-Performance
3. **MongoDB-Tuning**: Connection-Pooling optimieren
4. **Nginx-Caching**: Statische Ressourcen cachen
5. **Log-Level reduzieren**: Nur Errors in Production

### Monitoring einrichten

```bash
# Prometheus + Grafana (optional)
# Health-Check-Alerts via E-Mail/Slack
# Resource-Monitoring mit htop/ctop
```

---

## 🔒 Sicherheit

### Checklist

- ✅ MongoDB-Authentifizierung aktiviert
- ✅ Firewall konfiguriert (nur 80, 443, 22 offen)
- ✅ SSL-Zertifikat installiert
- ✅ fail2ban aktiviert
- ✅ Service läuft als Non-Root-User
- ✅ File-Permissions restriktiv gesetzt
- ✅ Log-Rotation konfiguriert

### Security-Updates

```bash
# System-Updates
sudo apt update && sudo apt upgrade -y

# Node.js-Updates
sudo npm update -g npm

# Dependency-Updates
cd /opt/whatsapp-manager && sudo -u whatsapp-manager npm audit fix
```

---

## 🎉 Go-Live Checklist

- [ ] Domain zeigt auf Server-IP
- [ ] SSL-Zertifikat funktioniert
- [ ] Health-Check antwortet (https://domain.com/api/health)
- [ ] First WhatsApp-Instance erfolgreich erstellt
- [ ] Metrics-Endpoint erreichbar
- [ ] Log-Rotation funktioniert
- [ ] Backup-Skript getestet
- [ ] Firewall-Rules aktiv
- [ ] Monitoring eingerichtet

**Herzlichen Glückwunsch! 🚀 Ihr WhatsApp Multi-Instance Manager ist production-ready!**