const { Client, LocalAuth, NoAuth } = require('whatsapp-web.js');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const qrcode = require('qrcode');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

const Instance = require('../models/Instance');
const Message = require('../models/Message');
const { logger } = require('../utils/logger');

puppeteerExtra.use(StealthPlugin());

class InstanceManager extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map(); // instanceId -> { client, metadata }
    this.serverId = process.env.SERVER_ID || require('os').hostname();
  }

  // Instanz erstellen
  async createInstance(instanceData) {
    try {
      const { instanceId, userId, config, browserProfile } = instanceData;

      // Prüfen ob Instanz bereits existiert
      if (this.instances.has(instanceId)) {
        throw new Error('Instance bereits aktiv');
      }

      // Database-Eintrag erstellen
      const instance = new Instance({
        instanceId,
        name: instanceData.name,
        description: instanceData.description || '',
        userId,
        serverId: this.serverId,
        config: config || {},
        browserProfile: browserProfile || this.generateBrowserProfile(),
        apiKey: this.generateApiKey()
      });

      await instance.save();

      // WhatsApp Client erstellen
      const client = await this.createWhatsAppClient(instanceId, instance);

      // Instanz in Memory speichern
      this.instances.set(instanceId, {
        client,
        instance,
        startTime: Date.now(),
        messageCount: 0,
        lastActivity: Date.now()
      });

      logger.info(`Instanz ${instanceId} erstellt`);
      this.emit('instanceCreated', { instanceId, instance });

      return instance;

    } catch (error) {
      logger.error(`Fehler beim Erstellen der Instanz ${instanceData.instanceId}:`, error);
      throw error;
    }
  }

  // WhatsApp Client erstellen
  async createWhatsAppClient(instanceId, instance) {
    const sessionPath = path.join('./sessions', instanceId);
    const profilePath = path.join('./browser-profiles', instanceId);

    // Ordner erstellen
    await fs.mkdir(sessionPath, { recursive: true });
    await fs.mkdir(profilePath, { recursive: true });

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: instanceId,
        dataPath: sessionPath
      }),
      puppeteer: {
        executablePath: puppeteerExtra.executablePath(),
        headless: true,
        userDataDir: profilePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-blink-features=AutomationControlled',
          `--user-agent=${instance.browserProfile.userAgent}`,
          `--window-size=${instance.browserProfile.screenWidth},${instance.browserProfile.screenHeight}`,
          `--lang=${instance.browserProfile.language}`
        ],
        ignoreDefaultArgs: ['--enable-automation']
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      }
    });

    // Event-Handler registrieren
    this.setupClientEventHandlers(client, instanceId);

    return client;
  }

  // Client Event-Handler
  setupClientEventHandlers(client, instanceId) {
    client.on('qr', async (qr) => {
      try {
        const qrCodeDataURL = await qrcode.toDataURL(qr);
        await this.updateInstanceStatus(instanceId, 'qr_pending', { qrCode: qrCodeDataURL });

        this.emit('qrReceived', { instanceId, qr: qrCodeDataURL });
        logger.info(`QR-Code für Instanz ${instanceId} generiert`);
      } catch (error) {
        logger.error(`QR-Code Fehler für ${instanceId}:`, error);
      }
    });

    client.on('authenticated', async () => {
      await this.updateInstanceStatus(instanceId, 'authenticated');
      this.emit('authenticated', { instanceId });
      logger.info(`Instanz ${instanceId} authentifiziert`);
    });

    client.on('ready', async () => {
      const info = client.info;
      await this.updateInstanceStatus(instanceId, 'ready', {
        phoneNumber: info.wid.user,
        qrCode: null
      });

      this.emit('ready', { instanceId, info });
      logger.info(`Instanz ${instanceId} bereit - Nummer: ${info.wid.user}`);
    });

    client.on('auth_failure', async (msg) => {
      await this.updateInstanceStatus(instanceId, 'error');
      this.emit('authFailure', { instanceId, error: msg });
      logger.error(`Auth-Fehler für ${instanceId}:`, msg);
    });

    client.on('disconnected', async (reason) => {
      await this.updateInstanceStatus(instanceId, 'disconnected');
      this.emit('disconnected', { instanceId, reason });
      logger.warn(`Instanz ${instanceId} getrennt: ${reason}`);

      // Auto-Reconnect wenn konfiguriert
      const instanceData = this.instances.get(instanceId);
      if (instanceData && instanceData.instance.config.autoReconnect) {
        setTimeout(() => this.restartInstance(instanceId), 5000);
      }
    });

    client.on('message', async (message) => {
      await this.handleIncomingMessage(instanceId, message);
    });

    client.on('message_ack', async (message, ack) => {
      await this.updateMessageAck(instanceId, message.id.id, ack);
    });
  }

  // Instanz starten
  async startInstance(instanceId) {
    try {
      const instanceData = this.instances.get(instanceId);
      if (!instanceData) {
        throw new Error('Instanz nicht gefunden');
      }

      await this.updateInstanceStatus(instanceId, 'connecting');
      await instanceData.client.initialize();

      logger.info(`Instanz ${instanceId} wird gestartet`);

    } catch (error) {
      logger.error(`Fehler beim Starten der Instanz ${instanceId}:`, error);
      await this.updateInstanceStatus(instanceId, 'error');
      throw error;
    }
  }

  // Instanz stoppen
  async stopInstance(instanceId) {
    try {
      const instanceData = this.instances.get(instanceId);
      if (!instanceData) {
        throw new Error('Instanz nicht gefunden');
      }

      await instanceData.client.destroy();
      this.instances.delete(instanceId);
      await this.updateInstanceStatus(instanceId, 'stopped');

      this.emit('instanceStopped', { instanceId });
      logger.info(`Instanz ${instanceId} gestoppt`);

    } catch (error) {
      logger.error(`Fehler beim Stoppen der Instanz ${instanceId}:`, error);
      throw error;
    }
  }

  // Instanz neustarten
  async restartInstance(instanceId) {
    try {
      await this.stopInstance(instanceId);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Instanz-Daten aus DB laden
      const instance = await Instance.findOne({ instanceId });
      if (!instance) {
        throw new Error('Instanz in DB nicht gefunden');
      }

      const client = await this.createWhatsAppClient(instanceId, instance);
      this.instances.set(instanceId, {
        client,
        instance,
        startTime: Date.now(),
        messageCount: 0,
        lastActivity: Date.now()
      });

      await this.startInstance(instanceId);

    } catch (error) {
      logger.error(`Fehler beim Neustarten der Instanz ${instanceId}:`, error);
      throw error;
    }
  }

  // Instanz löschen
  async deleteInstance(instanceId) {
    try {
      // Stoppen falls aktiv
      if (this.instances.has(instanceId)) {
        await this.stopInstance(instanceId);
      }

      // Session- und Profil-Ordner löschen
      const sessionPath = path.join('./sessions', instanceId);
      const profilePath = path.join('./browser-profiles', instanceId);

      try {
        await fs.rm(sessionPath, { recursive: true, force: true });
        await fs.rm(profilePath, { recursive: true, force: true });
      } catch (err) {
        logger.warn(`Fehler beim Löschen der Ordner für ${instanceId}:`, err);
      }

      // Aus DB entfernen
      await Instance.deleteOne({ instanceId });
      await Message.deleteMany({ instanceId });

      this.emit('instanceDeleted', { instanceId });
      logger.info(`Instanz ${instanceId} gelöscht`);

    } catch (error) {
      logger.error(`Fehler beim Löschen der Instanz ${instanceId}:`, error);
      throw error;
    }
  }

  // Nachricht senden
  async sendMessage(instanceId, chatId, content, options = {}) {
    try {
      const instanceData = this.instances.get(instanceId);
      if (!instanceData || instanceData.instance.status !== 'ready') {
        throw new Error('Instanz nicht bereit');
      }

      // Rate-Limiting prüfen
      await this.checkRateLimit(instanceId);

      // Nachricht senden
      const message = await instanceData.client.sendMessage(chatId, content, options);

      // In DB speichern
      await this.saveOutgoingMessage(instanceId, message, content, options);

      // Statistiken aktualisieren
      instanceData.messageCount++;
      instanceData.lastActivity = Date.now();

      return message;

    } catch (error) {
      logger.error(`Fehler beim Senden der Nachricht für ${instanceId}:`, error);
      throw error;
    }
  }

  // Eingehende Nachricht verarbeiten
  async handleIncomingMessage(instanceId, message) {
    try {
      // In DB speichern
      await this.saveIncomingMessage(instanceId, message);

      // Webhook senden falls konfiguriert
      const instanceData = this.instances.get(instanceId);
      if (instanceData.instance.config.webhookUrl) {
        await this.sendWebhook(instanceId, 'message', message);
      }

      // Event emittieren
      this.emit('messageReceived', { instanceId, message });

      // Aktivität aktualisieren
      instanceData.lastActivity = Date.now();

    } catch (error) {
      logger.error(`Fehler beim Verarbeiten der Nachricht für ${instanceId}:`, error);
    }
  }

  // Ausgehende Nachricht speichern
  async saveOutgoingMessage(instanceId, waMessage, content, options) {
    const instanceData = this.instances.get(instanceId);
    const message = new Message({
      messageId: waMessage.id.id,
      instanceId,
      userId: instanceData.instance.userId,
      waMessageId: waMessage.id.id,
      chatId: waMessage.to,
      from: waMessage.from,
      to: waMessage.to,
      type: waMessage.type || 'chat',
      body: typeof content === 'string' ? content : (content.caption || ''),
      direction: 'outbound',
      isFromMe: true,
      timestamp: new Date(waMessage.timestamp * 1000),
      metadata: {
        deviceType: waMessage.deviceType,
        timestamp: new Date(waMessage.timestamp * 1000)
      }
    });

    await message.save();
  }

  // Eingehende Nachricht speichern
  async saveIncomingMessage(instanceId, waMessage) {
    const instanceData = this.instances.get(instanceId);
    const message = new Message({
      messageId: waMessage.id.id,
      instanceId,
      userId: instanceData.instance.userId,
      waMessageId: waMessage.id.id,
      chatId: waMessage.from,
      from: waMessage.from,
      to: waMessage.to,
      type: waMessage.type,
      body: waMessage.body,
      direction: 'inbound',
      isFromMe: waMessage.fromMe,
      hasQuotedMsg: waMessage.hasQuotedMsg,
      isForwarded: waMessage.isForwarded,
      timestamp: new Date(waMessage.timestamp * 1000),
      metadata: {
        deviceType: waMessage.deviceType,
        timestamp: new Date(waMessage.timestamp * 1000)
      }
    });

    // Medien-Info falls vorhanden
    if (waMessage.hasMedia) {
      message.media = {
        hasMedia: true,
        mimetype: waMessage._data.mimetype,
        filename: waMessage._data.filename,
        filesize: waMessage._data.filesize
      };
    }

    await message.save();
  }

  // Status aktualisieren
  async updateInstanceStatus(instanceId, status, additionalData = {}) {
    await Instance.updateOne(
      { instanceId },
      {
        status,
        ...additionalData,
        updatedAt: new Date()
      }
    );
  }

  // Message ACK aktualisieren
  async updateMessageAck(instanceId, messageId, ack) {
    await Message.updateOne(
      { instanceId, messageId },
      { ack }
    );
  }

  // Rate-Limiting prüfen
  async checkRateLimit(instanceId) {
    const instanceData = this.instances.get(instanceId);
    const limit = instanceData.instance.config.rateLimitPerMinute || 20;

    // Einfache In-Memory Rate-Limiting-Implementierung
    const now = Date.now();
    if (!instanceData.rateLimitWindow) {
      instanceData.rateLimitWindow = now;
      instanceData.rateLimitCount = 0;
    }

    if (now - instanceData.rateLimitWindow > 60000) {
      instanceData.rateLimitWindow = now;
      instanceData.rateLimitCount = 0;
    }

    if (instanceData.rateLimitCount >= limit) {
      throw new Error('Rate-Limit erreicht');
    }

    instanceData.rateLimitCount++;
  }

  // Browser-Profil generieren
  generateBrowserProfile() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    ];

    return {
      userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
      platform: ['Windows', 'MacOS', 'Linux'][Math.floor(Math.random() * 3)],
      language: 'de-DE',
      timezone: -120,
      screenWidth: 1920,
      screenHeight: 1080,
      webglRenderer: 'Intel Iris OpenGL Engine',
      canvasFingerprint: Math.random().toString(36)
    };
  }

  // API-Key generieren
  generateApiKey() {
    return require('crypto').randomBytes(32).toString('hex');
  }

  // Webhook senden
  async sendWebhook(instanceId, event, data) {
    try {
      const { sendWebhook } = require('../routes/webhooks');
      return await sendWebhook(instanceId, event, data);
    } catch (error) {
      logger.error('Webhook send error:', error);
      return { success: false, error: error.message };
    }
  }

  // Alle Instanzen abrufen
  getInstances() {
    return Array.from(this.instances.keys());
  }

  // Instanz-Status abrufen
  getInstanceStatus(instanceId) {
    const instanceData = this.instances.get(instanceId);
    if (!instanceData) return null;

    return {
      instanceId,
      status: instanceData.instance.status,
      uptime: Date.now() - instanceData.startTime,
      messageCount: instanceData.messageCount,
      lastActivity: instanceData.lastActivity
    };
  }
}

module.exports = InstanceManager;