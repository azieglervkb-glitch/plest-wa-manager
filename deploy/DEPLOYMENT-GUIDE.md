# 🚀 WhatsApp Manager - Production Deployment Guide

## 📋 **KOMPLETTER VPS-DEPLOYMENT-PLAN**

### **Voraussetzungen:**
- Ubuntu 22.04 LTS VPS (4GB RAM, 2 CPU, 50GB SSD)
- Root-Zugang
- Domain zeigt auf VPS-IP
- Git-Repository mit diesem Code

---

## **🎯 1-KOMMANDO-DEPLOYMENT**

```bash
# Repository klonen
git clone https://github.com/yourrepo/whatsapp-multi-instance-manager.git
cd whatsapp-multi-instance-manager/deploy

# Schritt 1: System-Dependencies installieren
sudo ./install-ubuntu22.sh your-domain.com

# Schritt 2: Database einrichten
sudo ./init-database.sh

# Schritt 3: App deployen
sudo ./deploy-app.sh init

# Fertig! 🎉
```

**Das war's!** System läuft auf `https://your-domain.com`

---

## **📊 WAS AUTOMATISCH PASSIERT**

### **install-ubuntu22.sh installiert:**
- ✅ Node.js 18 + npm
- ✅ MongoDB 6.0 + Redis
- ✅ Google Chrome für Puppeteer
- ✅ Nginx + SSL (Let's Encrypt)
- ✅ Firewall + Fail2ban
- ✅ System-User `whatsapp-manager`
- ✅ Log-Rotation + Cron-Jobs

### **init-database.sh erstellt:**
- ✅ MongoDB Admin + App-User mit sicheren Passwörtern
- ✅ Database `whatsapp_production`
- ✅ Alle Indizes für Performance
- ✅ Ersten Admin-User für App
- ✅ Credentials in `/opt/whatsapp-manager/.env.db`

### **deploy-app.sh init macht:**
- ✅ Git-Repository klonen nach `/opt/whatsapp-manager/`
- ✅ `npm ci --production` (Dependencies installieren)
- ✅ Frontend bauen (`npm run build`)
- ✅ Database-Migration ausführen
- ✅ Systemd-Service installieren und starten
- ✅ Deployment-Tag erstellen

---

## **🔄 UPDATE-SYSTEM**

### **Für Weiterentwicklung:**

```bash
# Lokale Änderungen committen
git add .
git commit -m "New features"
git push origin main

# Auf VPS updaten
ssh root@your-vps-ip
cd /opt/whatsapp-manager/deploy
sudo ./deploy-app.sh update
```

### **Was beim Update passiert:**
1. **Backup erstellen** (kompletter App-Code außer Sessions)
2. **Service stoppen** (graceful shutdown aller Instanzen)
3. **Git pull** der neuesten Änderungen
4. **Dependencies updaten** (`npm ci`)
5. **Database-Migrationen** ausführen
6. **Frontend neu bauen**
7. **Service starten**
8. **Health-Check** - bei Fehler automatischer Rollback

### **Rollback-System:**
```bash
# Falls Update fehlschlägt
sudo ./deploy-app.sh rollback

# Stellt automatisch letztes Backup wieder her
```

---

## **🏗️ DEPLOYMENT-ARCHITEKTUR**

### **Verzeichnis-Struktur auf VPS:**
```
/opt/whatsapp-manager/                 # Hauptverzeichnis
├── server.js                         # Hauptanwendung
├── package.json                      # Dependencies
├── .env                             # Konfiguration
├── .env.db                          # DB-Credentials (auto-generiert)
├── services/                        # Core-Services
│   ├── ProductionInstanceManager.js # Instance-Management
│   ├── WhatsAppProxy.js             # Reverse Proxy
│   └── MetricsService.js            # Monitoring
├── routes/                          # API-Endpunkte
├── models/                          # Database-Models
├── middleware/                      # Auth, Rate-Limiting
├── sessions/                        # WhatsApp-Sessions (persistent)
├── browser-profiles/                # Browser-Profile (persistent)
├── logs/                           # Application-Logs
├── backups/                        # Session-Backups
└── frontend/build/                 # Minimal-Frontend

/opt/whatsapp-manager-backups/       # Deployment-Backups
├── backup_20250925_140000.tar.gz
├── backup_20250926_120000.tar.gz
└── ...

/etc/systemd/system/
└── whatsapp-manager.service         # Systemd-Service

/etc/nginx/sites-available/
└── whatsapp-manager                 # Nginx-Config
```

### **Services auf VPS:**
```bash
systemctl status whatsapp-manager    # Hauptanwendung
systemctl status mongod              # Database
systemctl status nginx               # Reverse Proxy
systemctl status redis-server        # Cache
```

---

## **💻 DEVELOPMENT → PRODUCTION WORKFLOW**

### **Lokale Entwicklung:**
```bash
# 1. Änderungen machen
git checkout -b feature/new-feature
# ... Code ändern ...

# 2. Testen
npm run dev
curl http://localhost:5000/api/health

# 3. Committen
git add .
git commit -m "Add new feature"
git push origin feature/new-feature

# 4. Merge in main
git checkout main
git merge feature/new-feature
git push origin main
```

### **Production-Deployment:**
```bash
# SSH zum VPS
ssh root@your-vps-ip

# Update ausführen
cd /opt/whatsapp-manager/deploy
sudo ./deploy-app.sh update

# Status prüfen
sudo ./deploy-app.sh status
curl https://your-domain.com/api/health
```

### **Monitoring:**
```bash
# Live-Logs
sudo ./deploy-app.sh logs

# Service-Status
sudo ./deploy-app.sh status

# Health-Check
curl https://your-domain.com/api/health

# Metrics (Prometheus)
curl https://your-domain.com/metrics

# Detaillierte Diagnostics
curl https://your-domain.com/api/health/detailed \
  -H "Authorization: Bearer your-jwt-token"
```

---

## **🔒 SICHERHEIT & BACKUP**

### **Automatische Backups:**
- **Code-Backups**: Bei jedem Update in `/opt/whatsapp-manager-backups/`
- **Database-Backups**: Täglich um 03:00 via Cron
- **Session-Backups**: Vor kritischen Instance-Operationen
- **Log-Retention**: 30 Tage mit automatischer Rotation

### **Security-Features:**
- **Non-Root Service**: App läuft als `whatsapp-manager` User
- **Firewall**: Nur Ports 22,80,443 offen
- **SSL-Terminierung**: Let's Encrypt Auto-Renewal
- **Rate-Limiting**: API + Nginx-Level
- **MongoDB-Auth**: Separate App-User mit minimalen Rechten
- **Fail2ban**: Auto-Ban bei Brute-Force

---

## **🎯 ENDERGEBNIS**

### **Ein-Kommando-Deployment:**
```bash
curl -sSL https://raw.githubusercontent.com/yourrepo/whatsapp-multi-instance-manager/main/deploy/quick-install.sh | sudo bash -s your-domain.com
```

### **Ein-Kommando-Updates:**
```bash
sudo /opt/whatsapp-manager/deploy/deploy-app.sh update
```

### **Produktions-URLs:**
- **Frontend**: `https://your-domain.com` (API-Dokumentation)
- **Health-Check**: `https://your-domain.com/api/health`
- **Metrics**: `https://your-domain.com/metrics`
- **API**: `https://your-domain.com/api/proxy/{apiKey}/{method}`

**Das System ist:**
- ✅ **Git-basiert** → Einfache Updates
- ✅ **Backup-gesichert** → Rollback bei Problemen
- ✅ **Monitoring-ready** → Health + Metrics
- ✅ **SSL-verschlüsselt** → Production Security
- ✅ **Auto-Recovery** → Überlebt Crashes
- ✅ **Ubuntu-optimiert** → VPS-ready

**Perfect für kontinuierliche Weiterentwicklung!** 🚀