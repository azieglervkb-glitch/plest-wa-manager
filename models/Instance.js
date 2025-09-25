const mongoose = require('mongoose');

const InstanceSchema = new mongoose.Schema({
  // Grunddaten
  instanceId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },

  // WhatsApp-Verbindung
  phoneNumber: {
    type: String,
    sparse: true // Erlaubt mehrere null-Werte
  },
  qrCode: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['created', 'connecting', 'qr_pending', 'authenticated', 'ready', 'disconnected', 'error', 'stopped'],
    default: 'created',
    index: true
  },

  // Browser-Konfiguration
  browserProfile: {
    userAgent: String,
    platform: String,
    language: String,
    timezone: Number,
    screenWidth: Number,
    screenHeight: Number,
    webglRenderer: String,
    canvasFingerprint: String
  },

  // Benutzer/Kunde
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Server-Info
  serverId: {
    type: String,
    required: true,
    index: true
  },
  serverHost: String,
  port: Number,

  // Process-Management (Production Features)
  processId: {
    type: Number,
    default: null,
    index: true
  },
  processPort: {
    type: Number,
    default: null
  },
  lastHeartbeat: {
    type: Date,
    default: Date.now,
    index: true
  },
  resourceUsage: {
    memory: { type: Number, default: 0 }, // RAM in MB
    cpu: { type: Number, default: 0 },    // CPU in %
    uptime: { type: Number, default: 0 }  // Laufzeit in Sekunden
  },
  errorCount: {
    type: Number,
    default: 0
  },
  lastError: {
    timestamp: Date,
    message: String,
    stack: String,
    code: String
  },
  restartCount: {
    type: Number,
    default: 0
  },
  sessionBackup: {
    enabled: { type: Boolean, default: true },
    lastBackup: Date,
    backupPath: String,
    backupSize: Number
  },

  // Statistiken
  stats: {
    totalMessages: { type: Number, default: 0 },
    messagesSent: { type: Number, default: 0 },
    messagesReceived: { type: Number, default: 0 },
    uptime: { type: Number, default: 0 },
    lastActivity: Date,
    connectionsCount: { type: Number, default: 0 }
  },

  // Konfiguration
  config: {
    webhookUrl: String,
    autoReconnect: { type: Boolean, default: true },
    messageDelay: { type: Number, default: 1000 },
    rateLimitPerMinute: { type: Number, default: 20 },
    enableLogging: { type: Boolean, default: true },
    enableMedia: { type: Boolean, default: true },
    enableGroups: { type: Boolean, default: true }
  },

  // API-Konfiguration
  apiKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  webhookSecret: String,

  // Zeitstempel
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastConnected: Date,
  lastDisconnected: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtuelle Felder
InstanceSchema.virtual('isActive').get(function() {
  return ['connecting', 'qr_pending', 'authenticated', 'ready'].includes(this.status);
});

InstanceSchema.virtual('uptime').get(function() {
  if (!this.lastConnected) return 0;
  const now = new Date();
  return Math.floor((now - this.lastConnected) / 1000);
});

// Indizes für Performance
InstanceSchema.index({ userId: 1, status: 1 });
InstanceSchema.index({ serverId: 1, status: 1 });
InstanceSchema.index({ createdAt: -1 });

// Middleware
InstanceSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Statische Methoden
InstanceSchema.statics.findByUser = function(userId, status = null) {
  const query = { userId };
  if (status) query.status = status;
  return this.find(query).sort({ createdAt: -1 });
};

InstanceSchema.statics.findByServer = function(serverId, status = null) {
  const query = { serverId };
  if (status) query.status = status;
  return this.find(query);
};

InstanceSchema.statics.getActiveInstances = function() {
  return this.find({
    status: { $in: ['connecting', 'qr_pending', 'authenticated', 'ready'] }
  });
};

// Instance-Methoden
InstanceSchema.methods.updateStats = function(stats) {
  Object.assign(this.stats, stats);
  return this.save();
};

InstanceSchema.methods.setStatus = function(status, additionalData = {}) {
  this.status = status;
  if (status === 'ready') {
    this.lastConnected = new Date();
    this.stats.connectionsCount += 1;
  }
  if (status === 'disconnected') {
    this.lastDisconnected = new Date();
  }
  Object.assign(this, additionalData);
  return this.save();
};

// Production Process-Management Methoden
InstanceSchema.methods.updateHeartbeat = function(resourceUsage = {}) {
  this.lastHeartbeat = new Date();
  if (resourceUsage.memory) this.resourceUsage.memory = resourceUsage.memory;
  if (resourceUsage.cpu) this.resourceUsage.cpu = resourceUsage.cpu;
  if (resourceUsage.uptime) this.resourceUsage.uptime = resourceUsage.uptime;
  return this.save({ validateBeforeSave: false });
};

InstanceSchema.methods.setProcessInfo = function(processId, processPort = null) {
  this.processId = processId;
  this.processPort = processPort;
  this.lastHeartbeat = new Date();
  return this.save();
};

InstanceSchema.methods.clearProcessInfo = function() {
  this.processId = null;
  this.processPort = null;
  return this.save();
};

InstanceSchema.methods.logError = function(error, increment = true) {
  this.lastError = {
    timestamp: new Date(),
    message: error.message || 'Unknown error',
    stack: error.stack || '',
    code: error.code || ''
  };
  if (increment) {
    this.errorCount += 1;
  }
  return this.save();
};

InstanceSchema.methods.resetErrorCount = function() {
  this.errorCount = 0;
  this.lastError = {};
  return this.save();
};

InstanceSchema.methods.incrementRestartCount = function() {
  this.restartCount += 1;
  return this.save();
};

InstanceSchema.methods.isHealthy = function() {
  const now = new Date();
  const heartbeatAge = now - this.lastHeartbeat;
  const maxAge = 2 * 60 * 1000; // 2 Minuten

  return heartbeatAge < maxAge &&
         this.errorCount < 3 &&
         this.processId !== null &&
         ['ready', 'authenticated', 'connecting'].includes(this.status);
};

InstanceSchema.methods.needsRestart = function() {
  return this.errorCount >= 3 ||
         !this.isHealthy() ||
         this.status === 'error';
};

InstanceSchema.methods.createSessionBackup = async function() {
  if (!this.sessionBackup.enabled) return false;

  const fs = require('fs').promises;
  const path = require('path');

  try {
    const sessionPath = path.join('./sessions', this.instanceId);
    const backupPath = path.join('./backups', `${this.instanceId}-${Date.now()}.tar.gz`);

    // Hier würde Session-Backup-Logic stehen (z.B. tar-gz erstellen)
    this.sessionBackup.lastBackup = new Date();
    this.sessionBackup.backupPath = backupPath;

    await this.save();
    return true;
  } catch (error) {
    await this.logError(error);
    return false;
  }
};

module.exports = mongoose.model('Instance', InstanceSchema);