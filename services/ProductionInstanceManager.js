const { Client, LocalAuth, NoAuth } = require('whatsapp-web.js');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const qrcode = require('qrcode');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const { exec } = require('child_process');
const util = require('util');

const Instance = require('../models/Instance');
const Message = require('../models/Message');
const { logger } = require('../utils/logger');

puppeteerExtra.use(StealthPlugin());

/**
 * Production-Ready Instance Manager mit Process-Recovery und Health-Monitoring
 */
class ProductionInstanceManager extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map(); // instanceId -> { client, metadata, processInfo }
    this.serverId = process.env.SERVER_ID || require('os').hostname();
    this.healthCheckInterval = null;
    this.recoveryInProgress = false;

    // Production-Konfiguration
    this.config = {
      maxInstances: parseInt(process.env.MAX_INSTANCES_PER_SERVER) || 100,
      healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000, // 30 Sekunden
      maxMemoryPerInstance: parseInt(process.env.MAX_MEMORY_PER_INSTANCE) || 512, // MB
      maxErrorCount: parseInt(process.env.MAX_ERROR_COUNT) || 3,
      restartDelay: parseInt(process.env.RESTART_DELAY) || 5000, // 5 Sekunden
      sessionCleanupDays: parseInt(process.env.SESSION_CLEANUP_DAYS) || 7
    };

    logger.info('ProductionInstanceManager initialized', {
      serverId: this.serverId,
      config: this.config
    });
  }

  /**
   * Manager starten - Recovery und Health-Monitoring initialisieren
   */
  async start() {
    try {
      logger.info('Starting ProductionInstanceManager...');

      // 1. Bestehende Browser-Processes recovern
      await this.recoverExistingInstances();

      // 2. Health-Monitoring starten
      this.startHealthMonitoring();

      // 3. Cleanup-Tasks starten
      this.startCleanupTasks();

      logger.info('ProductionInstanceManager started successfully');
    } catch (error) {
      logger.error('Failed to start ProductionInstanceManager:', error);
      throw error;
    }
  }

  /**
   * Manager sauber beenden
   */
  async stop() {
    logger.info('Stopping ProductionInstanceManager...');

    // Health-Monitoring stoppen
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Alle Instanzen sauber beenden
    const instances = Array.from(this.instances.keys());
    for (const instanceId of instances) {
      try {
        await this.stopInstance(instanceId, true); // graceful = true
      } catch (error) {
        logger.error(`Error stopping instance ${instanceId}:`, error);
      }
    }

    logger.info('ProductionInstanceManager stopped');
  }

  /**
   * Bestehende Browser-Processes nach Server-Restart recovern
   */
  async recoverExistingInstances() {
    if (this.recoveryInProgress) return;
    this.recoveryInProgress = true;

    try {
      logger.info('Starting instance recovery process...');

      // Alle Instanzen aus DB laden, die auf diesem Server laufen sollten
      // FIX: Load ALL instances, not just ones with processId (new instances have processId: null)
      const instances = await Instance.find({
        serverId: this.serverId,
        status: { $in: ['created', 'connecting', 'qr_pending', 'authenticated', 'ready'] }
      });

      logger.info(`Found ${instances.length} instances to recover`);

      for (const instance of instances) {
        try {
          await this.recoverSingleInstance(instance);
        } catch (error) {
          logger.error(`Failed to recover instance ${instance.instanceId}:`, error);
          await instance.logError(error);
          await instance.setStatus('error');
        }
      }

      logger.info('Instance recovery completed');
    } catch (error) {
      logger.error('Instance recovery failed:', error);
    } finally {
      this.recoveryInProgress = false;
    }
  }

  /**
   * Einzelne Instanz recovern
   */
  async recoverSingleInstance(instance) {
    const { instanceId, processId } = instance;

    // Handle new instances without processId
    if (!processId) {
      logger.info(`Loading new instance ${instanceId} (no processId)`);
      try {
        const client = await this.createWhatsAppClient(instanceId, instance);
        this.instances.set(instanceId, {
          client,
          instance,
          startTime: Date.now(),
          messageCount: 0,
          lastActivity: Date.now(),
          recovered: false
        });
        logger.info(`New instance ${instanceId} loaded into memory`);
        return true;
      } catch (error) {
        logger.error(`Failed to load new instance ${instanceId}:`, error);
        await instance.setStatus('error');
        return false;
      }
    }

    // Prüfen ob Browser-Process noch läuft
    const isProcessAlive = await this.isProcessAlive(processId);

    if (isProcessAlive) {
      logger.info(`Recovering live instance ${instanceId} with PID ${processId}`);

      try {
        // Versuche Reconnect zu existierendem Browser
        const client = await this.reconnectToExistingBrowser(instance);

        if (client) {
          // Erfolgreich reconnected
          this.instances.set(instanceId, {
            client,
            instance,
            startTime: Date.now(),
            messageCount: 0,
            lastActivity: Date.now(),
            processId,
            recovered: true
          });

          await instance.updateHeartbeat();
          await instance.resetErrorCount();

          logger.info(`Successfully recovered instance ${instanceId}`);
          this.emit('instanceRecovered', { instanceId, instance });

          return true;
        }
      } catch (error) {
        logger.warn(`Failed to reconnect to instance ${instanceId}:`, error.message);
      }
    }

    // Process ist tot oder Reconnect fehlgeschlagen
    logger.info(`Instance ${instanceId} process ${processId} is dead or unreachable`);

    // Process-Info löschen und Status auf disconnected setzen
    await instance.clearProcessInfo();
    await instance.setStatus('disconnected');

    // Cleanup Browser-Files
    await this.cleanupBrowserFiles(instanceId);

    return false;
  }

  /**
   * Reconnect zu existierendem Browser-Process
   */
  async reconnectToExistingBrowser(instance) {
    const { instanceId, processPort } = instance;

    try {
      // Wenn processPort verfügbar, versuche Reconnect über DevTools
      if (processPort) {
        // TODO: Implementierung für DevTools-Reconnect
        // const browser = await puppeteer.connect({ browserURL: `http://localhost:${processPort}` });
        // const client = await this.attachToExistingWhatsAppClient(browser, instance);
        // return client;
      }

      // Fallback: Neuen Client erstellen mit existierender Session
      return await this.createWhatsAppClient(instanceId, instance);

    } catch (error) {
      logger.warn(`Reconnect to ${instanceId} failed:`, error.message);
      return null;
    }
  }

  /**
   * Prüfen ob Process noch läuft
   */
  async isProcessAlive(processId) {
    if (!processId) return false;

    try {
      const execAsync = util.promisify(exec);

      if (process.platform === 'win32') {
        await execAsync(`tasklist /FI "PID eq ${processId}" | find "${processId}"`);
      } else {
        await execAsync(`kill -0 ${processId}`);
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Health-Monitoring starten
   */
  startHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);

    logger.info(`Health monitoring started (interval: ${this.config.healthCheckIntervalMs}ms)`);
  }

  /**
   * Health-Check für alle Instanzen
   */
  async performHealthCheck() {
    try {
      const instances = Array.from(this.instances.entries());

      for (const [instanceId, instanceData] of instances) {
        await this.checkInstanceHealth(instanceId, instanceData);
      }

      // Database Health-Check
      await this.performDatabaseHealthCheck();

    } catch (error) {
      logger.error('Health check failed:', error);
    }
  }

  /**
   * Health-Check für einzelne Instanz
   */
  async checkInstanceHealth(instanceId, instanceData) {
    try {
      const { client, instance, processId } = instanceData;

      // 1. Process-Check
      if (processId && !await this.isProcessAlive(processId)) {
        logger.warn(`Instance ${instanceId} process ${processId} died`);
        await this.handleInstanceCrash(instanceId, instanceData, 'process_died');
        return;
      }

      // 2. Memory-Check
      const memoryUsage = await this.getProcessMemoryUsage(processId);
      if (memoryUsage && memoryUsage > this.config.maxMemoryPerInstance) {
        logger.warn(`Instance ${instanceId} memory usage too high: ${memoryUsage}MB`);
        await this.handleInstanceCrash(instanceId, instanceData, 'memory_limit');
        return;
      }

      // 3. Client-Check
      if (client && client.pupPage) {
        try {
          // Einfacher Ping zum Browser
          const isResponsive = await Promise.race([
            client.pupPage.evaluate(() => true),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
          ]);

          if (!isResponsive) {
            throw new Error('Browser not responsive');
          }
        } catch (error) {
          logger.warn(`Instance ${instanceId} browser not responsive:`, error.message);
          await this.handleInstanceCrash(instanceId, instanceData, 'browser_unresponsive');
          return;
        }
      }

      // 4. Heartbeat aktualisieren
      await instance.updateHeartbeat({
        memory: memoryUsage || 0,
        cpu: 0, // TODO: CPU-Usage implementieren
        uptime: Math.floor((Date.now() - instanceData.startTime) / 1000)
      });

      // 5. Activity-Update
      instanceData.lastActivity = Date.now();

    } catch (error) {
      logger.error(`Health check failed for instance ${instanceId}:`, error);
      await instance.logError(error);
    }
  }

  /**
   * Instance-Crash behandeln mit Auto-Restart
   */
  async handleInstanceCrash(instanceId, instanceData, reason) {
    try {
      const { instance } = instanceData;

      logger.warn(`Handling instance crash: ${instanceId}, reason: ${reason}`);

      await instance.logError(new Error(`Instance crashed: ${reason}`));
      await instance.setStatus('error');

      // Aus Memory entfernen
      this.instances.delete(instanceId);

      // Cleanup
      await this.cleanupBrowserFiles(instanceId);

      // Auto-Restart prüfen
      if (instance.config.autoReconnect && !instance.needsRestart()) {
        logger.info(`Auto-restarting instance ${instanceId}...`);

        setTimeout(async () => {
          try {
            await this.restartInstance(instanceId);
          } catch (error) {
            logger.error(`Auto-restart failed for ${instanceId}:`, error);
          }
        }, this.config.restartDelay);
      }

      this.emit('instanceCrashed', { instanceId, reason, instance });

    } catch (error) {
      logger.error(`Failed to handle instance crash ${instanceId}:`, error);
    }
  }

  /**
   * Memory-Usage für Process ermitteln
   */
  async getProcessMemoryUsage(processId) {
    if (!processId) return null;

    try {
      const execAsync = util.promisify(exec);

      if (process.platform === 'win32') {
        const { stdout } = await execAsync(`tasklist /FI "PID eq ${processId}" /FO CSV`);
        const lines = stdout.split('\n');
        if (lines.length > 1) {
          const memoryStr = lines[1].split(',')[4].replace(/"/g, '').replace(/[^\d]/g, '');
          return parseInt(memoryStr) / 1024; // KB to MB
        }
      } else {
        const { stdout } = await execAsync(`ps -p ${processId} -o rss=`);
        return parseInt(stdout.trim()) / 1024; // KB to MB
      }
    } catch (error) {
      // Process nicht mehr da oder Fehler
      return null;
    }
  }

  /**
   * Database Health-Check
   */
  async performDatabaseHealthCheck() {
    try {
      // Verwaiste Instanzen bereinigen (processId gesetzt aber Process tot)
      const instances = await Instance.find({
        serverId: this.serverId,
        processId: { $ne: null }
      });

      for (const instance of instances) {
        if (!await this.isProcessAlive(instance.processId)) {
          logger.info(`Cleaning up dead instance ${instance.instanceId}`);
          await instance.clearProcessInfo();
          await instance.setStatus('disconnected');
        }
      }

    } catch (error) {
      logger.error('Database health check failed:', error);
    }
  }

  /**
   * Cleanup-Tasks starten
   */
  startCleanupTasks() {
    // Session-Cleanup täglich um 02:00
    const cron = require('node-cron');

    cron.schedule('0 2 * * *', async () => {
      await this.performSessionCleanup();
    });

    logger.info('Cleanup tasks scheduled');
  }

  /**
   * Alte Sessions bereinigen
   */
  async performSessionCleanup() {
    try {
      logger.info('Starting session cleanup...');

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.sessionCleanupDays);

      // Nicht-aktive Instanzen älter als N Tage
      const oldInstances = await Instance.find({
        lastHeartbeat: { $lt: cutoffDate },
        status: { $in: ['stopped', 'error', 'disconnected'] }
      });

      for (const instance of oldInstances) {
        try {
          await this.cleanupBrowserFiles(instance.instanceId);
          logger.info(`Cleaned up old session for instance ${instance.instanceId}`);
        } catch (error) {
          logger.error(`Failed to cleanup instance ${instance.instanceId}:`, error);
        }
      }

      logger.info(`Session cleanup completed. Cleaned ${oldInstances.length} old sessions.`);

    } catch (error) {
      logger.error('Session cleanup failed:', error);
    }
  }

  /**
   * Browser-Files für Instanz bereinigen
   */
  async cleanupBrowserFiles(instanceId) {
    try {
      const sessionPath = path.join('./sessions', instanceId);
      const profilePath = path.join('./browser-profiles', instanceId);

      try {
        await fs.rm(sessionPath, { recursive: true, force: true });
        await fs.rm(profilePath, { recursive: true, force: true });
        logger.debug(`Cleaned up browser files for ${instanceId}`);
      } catch (error) {
        // Files might not exist - that's OK
        logger.debug(`Browser files cleanup warning for ${instanceId}:`, error.message);
      }

    } catch (error) {
      logger.error(`Failed to cleanup browser files for ${instanceId}:`, error);
    }
  }

  // Delegate zu originalen InstanceManager Methoden
  async createInstance(instanceData) {
    // Implementierung bleibt gleich wie im ursprünglichen InstanceManager
    // Nur mit zusätzlichem Process-Tracking
    try {
      const { instanceId, userId, config, browserProfile } = instanceData;

      if (this.instances.has(instanceId)) {
        throw new Error('Instance already active');
      }

      // Instanz-Limit prüfen
      if (this.instances.size >= this.config.maxInstances) {
        throw new Error(`Server instance limit reached (${this.config.maxInstances})`);
      }

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

      const client = await this.createWhatsAppClient(instanceId, instance);

      this.instances.set(instanceId, {
        client,
        instance,
        startTime: Date.now(),
        messageCount: 0,
        lastActivity: Date.now()
      });

      logger.info(`Instance ${instanceId} created`);
      this.emit('instanceCreated', { instanceId, instance });

      return instance;

    } catch (error) {
      logger.error(`Failed to create instance ${instanceData.instanceId}:`, error);
      throw error;
    }
  }

  /**
   * WhatsApp Client erstellen (Production-optimiert)
   */
  async createWhatsAppClient(instanceId, instance) {
    const sessionPath = path.join('./sessions', instanceId);
    const profilePath = path.join('./browser-profiles', instanceId);

    // Ordner erstellen
    await fs.mkdir(sessionPath, { recursive: true });
    await fs.mkdir(profilePath, { recursive: true });

    // Production-optimierte Puppeteer-Args
    const productionArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--memory-pressure-off',
      `--max-old-space-size=${this.config.maxMemoryPerInstance}`,
      `--user-agent=${instance.browserProfile.userAgent}`,
      `--window-size=${instance.browserProfile.screenWidth},${instance.browserProfile.screenHeight}`,
      `--lang=${instance.browserProfile.language}`
    ];

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: instanceId,
        dataPath: sessionPath
      }),
      puppeteer: {
        executablePath: puppeteerExtra.executablePath(),
        headless: process.env.NODE_ENV === 'production' ? 'new' : true,
        userDataDir: profilePath,
        args: productionArgs,
        ignoreDefaultArgs: ['--enable-automation'],
        // DevTools-Port für Production-Monitoring
        devtools: false,
        defaultViewport: {
          width: instance.browserProfile.screenWidth,
          height: instance.browserProfile.screenHeight
        }
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

  /**
   * Client Event-Handler (Production-erweitert)
   */
  setupClientEventHandlers(client, instanceId) {
    client.on('qr', async (qr) => {
      try {
        const qrCodeDataURL = await qrcode.toDataURL(qr);
        await this.updateInstanceStatus(instanceId, 'qr_pending', { qrCode: qrCodeDataURL });

        this.emit('qrReceived', { instanceId, qr: qrCodeDataURL });
        logger.info(`QR-Code for instance ${instanceId} generated`);
      } catch (error) {
        logger.error(`QR-Code error for ${instanceId}:`, error);
        const instance = await Instance.findOne({ instanceId });
        if (instance) await instance.logError(error);
      }
    });

    client.on('authenticated', async () => {
      await this.updateInstanceStatus(instanceId, 'authenticated');
      this.emit('authenticated', { instanceId });
      logger.info(`Instance ${instanceId} authenticated`);

      // Error-Count zurücksetzen bei erfolgreicher Auth
      const instance = await Instance.findOne({ instanceId });
      if (instance) await instance.resetErrorCount();
    });

    client.on('ready', async () => {
      try {
        const info = client.info;

        // Process-ID speichern für Recovery
        const browserProcess = client.pupBrowser?.process();
        const processId = browserProcess?.pid;

        await this.updateInstanceStatus(instanceId, 'ready', {
          phoneNumber: info.wid.user,
          qrCode: null
        });

        // Process-Info in Instance speichern
        const instance = await Instance.findOne({ instanceId });
        if (instance && processId) {
          await instance.setProcessInfo(processId);

          // Update in-memory reference
          const instanceData = this.instances.get(instanceId);
          if (instanceData) {
            instanceData.processId = processId;
          }
        }

        this.emit('ready', { instanceId, info });
        logger.info(`Instance ${instanceId} ready - Number: ${info.wid.user}, PID: ${processId}`);
      } catch (error) {
        logger.error(`Ready event error for ${instanceId}:`, error);
      }
    });

    client.on('auth_failure', async (msg) => {
      await this.updateInstanceStatus(instanceId, 'error');

      const instance = await Instance.findOne({ instanceId });
      if (instance) {
        await instance.logError(new Error(`Authentication failed: ${msg}`));
      }

      this.emit('authFailure', { instanceId, error: msg });
      logger.error(`Auth error for ${instanceId}:`, msg);
    });

    client.on('disconnected', async (reason) => {
      await this.updateInstanceStatus(instanceId, 'disconnected');
      this.emit('disconnected', { instanceId, reason });
      logger.warn(`Instance ${instanceId} disconnected: ${reason}`);

      // Auto-Reconnect mit Production-Logic
      const instanceData = this.instances.get(instanceId);
      if (instanceData?.instance?.config?.autoReconnect) {
        const instance = await Instance.findOne({ instanceId });
        if (instance && !instance.needsRestart()) {
          logger.info(`Scheduling auto-restart for ${instanceId}`);
          setTimeout(() => this.restartInstance(instanceId), this.config.restartDelay);
        }
      }
    });

    client.on('message', async (message) => {
      await this.handleIncomingMessage(instanceId, message);
    });

    client.on('message_ack', async (message, ack) => {
      await this.updateMessageAck(instanceId, message.id.id, ack);
    });

    // Production: Browser-Process-Events
    if (client.pupBrowser) {
      client.pupBrowser.on('disconnected', () => {
        logger.warn(`Browser process disconnected for instance ${instanceId}`);
        this.handleInstanceCrash(instanceId, this.instances.get(instanceId), 'browser_disconnected');
      });
    }
  }

  /**
   * Instanz starten (Production-erweitert)
   */
  async startInstance(instanceId) {
    try {
      const instanceData = this.instances.get(instanceId);
      if (!instanceData) {
        throw new Error('Instance not found in memory');
      }

      await this.updateInstanceStatus(instanceId, 'connecting');

      // Session-Backup erstellen vor Start
      if (instanceData.instance.sessionBackup.enabled) {
        await instanceData.instance.createSessionBackup();
      }

      await instanceData.client.initialize();

      logger.info(`Instance ${instanceId} starting...`);
      return true;

    } catch (error) {
      logger.error(`Failed to start instance ${instanceId}:`, error);
      await this.updateInstanceStatus(instanceId, 'error');

      const instance = await Instance.findOne({ instanceId });
      if (instance) await instance.logError(error);

      throw error;
    }
  }

  /**
   * Instanz stoppen (Production-erweitert)
   */
  async stopInstance(instanceId, graceful = true) {
    try {
      const instanceData = this.instances.get(instanceId);
      if (!instanceData) {
        logger.warn(`Instance ${instanceId} not found in memory`);
        return;
      }

      if (graceful) {
        logger.info(`Gracefully stopping instance ${instanceId}...`);

        // WhatsApp-Client sauber beenden
        if (instanceData.client) {
          await instanceData.client.destroy();
        }
      }

      // Aus Memory entfernen
      this.instances.delete(instanceId);

      // Process-Info löschen
      const instance = await Instance.findOne({ instanceId });
      if (instance) {
        await instance.clearProcessInfo();
        await instance.setStatus('stopped');
      }

      this.emit('instanceStopped', { instanceId });
      logger.info(`Instance ${instanceId} stopped`);

    } catch (error) {
      logger.error(`Failed to stop instance ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Instanz neustarten (Production-erweitert)
   */
  async restartInstance(instanceId) {
    try {
      logger.info(`Restarting instance ${instanceId}...`);

      const instance = await Instance.findOne({ instanceId });
      if (!instance) {
        throw new Error('Instance not found in database');
      }

      // Restart-Counter erhöhen
      await instance.incrementRestartCount();

      // Stoppen falls aktiv
      if (this.instances.has(instanceId)) {
        await this.stopInstance(instanceId, true);
      }

      // Kurz warten
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Neu erstellen
      const client = await this.createWhatsAppClient(instanceId, instance);

      this.instances.set(instanceId, {
        client,
        instance,
        startTime: Date.now(),
        messageCount: 0,
        lastActivity: Date.now(),
        restarted: true
      });

      // Starten
      await this.startInstance(instanceId);

      logger.info(`Instance ${instanceId} restarted successfully`);
      this.emit('instanceRestarted', { instanceId, instance });

    } catch (error) {
      logger.error(`Failed to restart instance ${instanceId}:`, error);

      const instance = await Instance.findOne({ instanceId });
      if (instance) await instance.logError(error);

      throw error;
    }
  }

  /**
   * Status aktualisieren (mit Process-Info)
   */
  async updateInstanceStatus(instanceId, status, additionalData = {}) {
    await Instance.updateOne(
      { instanceId },
      {
        status,
        ...additionalData,
        lastHeartbeat: new Date(),
        updatedAt: new Date()
      }
    );
  }

  // Weitere originale Methoden...
  async handleIncomingMessage(instanceId, message) {
    try {
      // Nachricht in DB speichern
      await this.saveIncomingMessage(instanceId, message);

      // Webhook senden falls konfiguriert
      const instanceData = this.instances.get(instanceId);
      if (instanceData?.instance?.config?.webhookUrl) {
        const { sendWebhook } = require('../routes/webhooks');
        await sendWebhook(instanceId, 'message', message);
      }

      // Event emittieren
      this.emit('messageReceived', { instanceId, message });

      // Aktivität aktualisieren
      if (instanceData) {
        instanceData.lastActivity = Date.now();
        instanceData.messageCount++;
      }

    } catch (error) {
      logger.error(`Failed to handle incoming message for ${instanceId}:`, error);
    }
  }

  async saveIncomingMessage(instanceId, waMessage) {
    const instanceData = this.instances.get(instanceId);
    if (!instanceData) return;

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

  async updateMessageAck(instanceId, messageId, ack) {
    await Message.updateOne(
      { instanceId, messageId },
      { ack }
    );
  }

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

  generateApiKey() {
    return require('crypto').randomBytes(32).toString('hex');
  }

  getInstances() {
    return Array.from(this.instances.keys());
  }

  /**
   * Nachricht senden (Production-erweitert)
   */
  async sendMessage(instanceId, chatId, content, options = {}) {
    try {
      const instanceData = this.instances.get(instanceId);
      if (!instanceData || instanceData.instance.status !== 'ready') {
        throw new Error('Instance not ready');
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
      logger.error(`Failed to send message for ${instanceId}:`, error);

      // Error-Count erhöhen
      const instance = await Instance.findOne({ instanceId });
      if (instance) await instance.logError(error);

      throw error;
    }
  }

  /**
   * Ausgehende Nachricht speichern
   */
  async saveOutgoingMessage(instanceId, waMessage, content, options) {
    const instanceData = this.instances.get(instanceId);
    if (!instanceData) return;

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

  /**
   * Rate-Limiting prüfen (Production-erweitert)
   */
  async checkRateLimit(instanceId) {
    const instanceData = this.instances.get(instanceId);
    if (!instanceData) throw new Error('Instance not found');

    const limit = instanceData.instance.config.rateLimitPerMinute || 20;

    const now = Date.now();
    if (!instanceData.rateLimitWindow) {
      instanceData.rateLimitWindow = now;
      instanceData.rateLimitCount = 0;
    }

    // Reset nach einer Minute
    if (now - instanceData.rateLimitWindow > 60000) {
      instanceData.rateLimitWindow = now;
      instanceData.rateLimitCount = 0;
    }

    if (instanceData.rateLimitCount >= limit) {
      throw new Error(`Rate limit exceeded: ${limit} requests per minute`);
    }

    instanceData.rateLimitCount++;
  }

  /**
   * Instanz löschen (Production-erweitert)
   */
  async deleteInstance(instanceId) {
    try {
      // Stoppen falls aktiv
      if (this.instances.has(instanceId)) {
        await this.stopInstance(instanceId, true);
      }

      // Session- und Profil-Ordner löschen
      await this.cleanupBrowserFiles(instanceId);

      // Aus DB entfernen
      await Instance.deleteOne({ instanceId });
      await Message.deleteMany({ instanceId });

      this.emit('instanceDeleted', { instanceId });
      logger.info(`Instance ${instanceId} deleted successfully`);

    } catch (error) {
      logger.error(`Failed to delete instance ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Webhook senden
   */
  async sendWebhook(instanceId, event, data) {
    try {
      const { sendWebhook } = require('../routes/webhooks');
      return await sendWebhook(instanceId, event, data);
    } catch (error) {
      logger.error('Webhook send error:', error);
      return { success: false, error: error.message };
    }
  }

  getInstanceStatus(instanceId) {
    const instanceData = this.instances.get(instanceId);
    if (!instanceData) return null;

    return {
      instanceId,
      status: instanceData.instance.status,
      uptime: Date.now() - instanceData.startTime,
      messageCount: instanceData.messageCount,
      lastActivity: instanceData.lastActivity,
      processId: instanceData.processId,
      recovered: instanceData.recovered || false
    };
  }
}

module.exports = ProductionInstanceManager;