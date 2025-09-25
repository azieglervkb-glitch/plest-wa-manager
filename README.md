# WhatsApp Multi-Instance Manager

Ein professionelles System zur Verwaltung mehrerer WhatsApp-Instanzen mit Web-Dashboard, APIs und umfassenden Monitoring-Funktionen.

## 🚀 Features

### ✅ **Multi-Instance Management**
- Unbegrenzte WhatsApp-Instanzen pro Server (Hardware-limitiert)
- Individuelle Browser-Profile für jede Instanz
- Einzigartige User-Agents und Fingerprints
- Persistente Sessions mit Auto-Reconnect

### ✅ **Web Dashboard**
- Moderne React-basierte Benutzeroberfläche
- Real-time Status-Updates über WebSocket
- QR-Code Scanner für Authentifizierung
- Instanz-Management (Erstellen, Starten, Stoppen, Löschen)
- Live-Nachrichtenverfolgung

### ✅ **REST API**
- Vollständige API für alle WhatsApp-Funktionen
- Swagger-Dokumentation
- API-Key-basierte Authentifizierung
- Rate-Limiting und Sicherheit

### ✅ **Analytics & Monitoring**
- Detaillierte Statistiken pro Instanz
- Nachrichten-Verlaufsanalyse
- Response-Zeit-Tracking
- System-Performance-Monitoring
- Datenexport (JSON/CSV)

### ✅ **Enterprise-Ready**
- Multi-Tenant-Architektur
- Benutzerrollen und Berechtigungen
- Horizontal skalierbar
- Docker-Container-Support
- Database-Clustering

## 🏗️ Architektur

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Dashboard │    │   Mobile App    │    │   API Clients   │
│    (React)      │    │   (Optional)    │    │    (External)   │
└─────┬───────────┘    └─────┬───────────┘    └─────┬───────────┘
      │                      │                      │
      └──────────────────────┼──────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │   API Gateway    │
                    │   (Express.js)   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼──────┐ ┌─────▼──────┐ ┌───▼───────┐
    │ Instance Mgr   │ │  Message   │ │  Auth     │
    │   Service      │ │  Service   │ │ Service   │
    └─────────┬──────┘ └─────┬──────┘ └───┬───────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼─────────┐
                    │    Database      │
                    │ (MongoDB/MySQL)  │
                    └──────────────────┘
```

## 🛠️ Installation

### Voraussetzungen
- Node.js 18+
- MongoDB 5.0+
- Redis 6.0+ (optional, für Caching)
- Docker & Docker Compose (empfohlen)

### Option 1: Docker (Empfohlen)

1. **Repository klonen**
```bash
git clone https://github.com/azieglervkb-glitch/plest-wa-manager.git
cd whatsapp-multi-instance-manager
```

2. **Environment-Konfiguration**
```bash
cp .env.example .env
# .env-Datei anpassen
```

3. **Docker-Container starten**
```bash
docker-compose up -d
```

4. **Services**
- Web Dashboard: http://localhost:3000
- API: http://localhost:5000
- Grafana Monitoring: http://localhost:3001
- Prometheus: http://localhost:9090

### Option 2: Manuelle Installation

1. **Dependencies installieren**
```bash
# Backend
npm install

# Frontend
cd frontend && npm install
```

2. **Database setup**
```bash
# MongoDB starten
mongod --dbpath ./data

# Redis starten (optional)
redis-server
```

3. **Environment konfigurieren**
```bash
cp .env.example .env
# Anpassen der Datenbank-URLs und Secrets
```

4. **Anwendung starten**
```bash
# Entwicklung
npm run dev

# Produktion
npm run build
npm start
```

## 🔧 Konfiguration

### Environment-Variablen

```env
# Database
MONGODB_URI=mongodb://localhost:27017/whatsapp_manager
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=your-super-secret-jwt-key
SESSION_SECRET=your-session-secret

# Application
NODE_ENV=production
PORT=5000
FRONTEND_URL=http://localhost:3000
SERVER_ID=main-server

# WhatsApp
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
MAX_INSTANCES_PER_SERVER=50

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

## 📚 API-Dokumentation

### Authentifizierung
```bash
# Benutzer registrieren
POST /api/auth/register
{
  "username": "user",
  "email": "user@example.com",
  "password": "password"
}

# Einloggen
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password"
}
```

### Instanz-Management
```bash
# Instanz erstellen
POST /api/instances
{
  "name": "Meine WhatsApp",
  "description": "Beschreibung",
  "config": {
    "webhookUrl": "https://myapp.com/webhook",
    "autoReconnect": true
  }
}

# Instanz starten
POST /api/instances/{instanceId}/start

# QR-Code abrufen
GET /api/instances/{instanceId}/qr

# Nachricht senden
POST /api/instances/{instanceId}/send
{
  "chatId": "1234567890@c.us",
  "message": "Hallo Welt!",
  "options": {
    "media": {
      "mimetype": "image/jpeg",
      "data": "base64-data",
      "filename": "image.jpg"
    }
  }
}
```

### Webhook-Integration
```javascript
// Webhook-Endpoint implementieren
app.post('/webhook', (req, res) => {
  const { instanceId, event, data } = req.body;

  switch(event) {
    case 'message':
      console.log(`Neue Nachricht von ${data.from}: ${data.body}`);
      break;
    case 'qr':
      console.log(`QR-Code für ${instanceId}: ${data.qr}`);
      break;
  }

  res.status(200).send('OK');
});
```

## 🎛️ Dashboard-Features

### 1. **Instance Overview**
- Status-Übersicht aller Instanzen
- Real-time Verbindungsstatus
- Nachrichten-Statistiken
- Uptime-Monitoring

### 2. **Message Management**
- Live-Chat-Interface
- Massenversendung
- Media-Upload
- Nachrichtenverlauf

### 3. **Analytics Dashboard**
- Nachrichten-Statistiken
- Response-Zeit-Analyse
- Top-Kontakte
- Erfolgsraten

### 4. **User Management**
- Multi-Tenant-Support
- Rollenbasierte Berechtigungen
- API-Key-Management
- Nutzungslimits

## 🔒 Sicherheit

### Browser-Fingerprinting
```javascript
// Jede Instanz erhält eigenen Browser-Fingerprint
const fingerprint = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
  platform: 'Windows',
  language: 'de-DE',
  timezone: -120,
  screenWidth: 1920,
  screenHeight: 1080,
  webglRenderer: 'Intel Iris OpenGL Engine',
  canvasFingerprint: 'unique-canvas-hash'
};
```

### Rate-Limiting
- API-Rate-Limits pro Benutzer
- WhatsApp-konforme Nachrichtenlimits
- Automatische Backoff-Strategien

### Authentifizierung
- JWT-basierte API-Authentifizierung
- BCrypt-Passwort-Hashing
- Session-Management mit Redis

## 📊 Monitoring

### Metriken
- Aktive Instanzen
- Nachrichtendurchsatz
- Fehlerrate
- Response-Zeiten
- Systemressourcen

### Logging
- Strukturierte JSON-Logs
- ELK-Stack-Integration
- Error-Tracking
- Audit-Logs

### Alerting
- E-Mail-Benachrichtigungen
- Webhook-Alerts
- Slack-Integration
- SMS-Notifications

## 🚀 Deployment

### Production Setup
```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  app:
    image: whatsapp-manager:latest
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 2G
          cpus: '1.0'
    environment:
      NODE_ENV: production
      CLUSTER_MODE: true
```

### Load Balancing
```nginx
# nginx.conf
upstream app {
    server app1:5000;
    server app2:5000;
    server app3:5000;
}

server {
    listen 80;
    location / {
        proxy_pass http://app;
    }
}
```

### Auto-Scaling
```bash
# Kubernetes deployment
kubectl apply -f k8s/
kubectl autoscale deployment whatsapp-manager --min=2 --max=10 --cpu-percent=70
```

## 🧪 Testing

```bash
# Unit Tests
npm test

# Integration Tests
npm run test:integration

# Load Tests
npm run test:load

# E2E Tests
npm run test:e2e
```

## 📈 Performance

### Benchmarks
- **Instanzen pro Server**: 50-100 (je nach Hardware)
- **Nachrichten pro Sekunde**: 10-20 pro Instanz
- **RAM-Verbrauch**: ~200MB pro Instanz
- **Startup-Zeit**: 10-30 Sekunden pro Instanz

### Optimierungen
- Browser-Profile-Wiederverwendung
- Message-Queue-System
- Database-Connection-Pooling
- Redis-Caching

## 🤝 Contributing

1. Fork das Repository
2. Feature-Branch erstellen (`git checkout -b feature/awesome-feature`)
3. Changes committen (`git commit -m 'Add awesome feature'`)
4. Branch pushen (`git push origin feature/awesome-feature`)
5. Pull Request öffnen

## 📝 License

MIT License - siehe [LICENSE](LICENSE) Datei.

## ⚠️ Disclaimer

Dieses Projekt ist nicht offiziell mit WhatsApp verbunden. Die Verwendung erfolgt auf eigene Gefahr. WhatsApp kann Konten sperren, die automatisierte Clients verwenden.

## 🆘 Support

- 📧 E-Mail: support@example.com
- 💬 Discord: https://discord.gg/whatsapp-manager
- 📖 Dokumentation: https://docs.whatsapp-manager.com
- 🐛 Issues: https://github.com/yourrepo/issues

## 🗺️ Roadmap

### v2.0 (Q1 2024)
- [ ] WhatsApp Business API-Integration
- [ ] Multi-Server-Clustering
- [ ] Advanced Analytics
- [ ] Mobile App

### v2.1 (Q2 2024)
- [ ] AI-Chatbot-Integration
- [ ] Template-System
- [ ] Workflow-Automation
- [ ] CRM-Integration

---

**Made with ❤️ for the WhatsApp automation community**