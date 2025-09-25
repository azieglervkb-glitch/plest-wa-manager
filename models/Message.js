const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  // Nachrichten-Identifikation
  messageId: {
    type: String,
    required: true,
    index: true
  },
  instanceId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // WhatsApp-spezifische Daten
  waMessageId: {
    type: String,
    required: true
  },
  chatId: {
    type: String,
    required: true,
    index: true
  },
  from: {
    type: String,
    required: true,
    index: true
  },
  to: {
    type: String,
    required: true
  },

  // Nachrichteninhalt
  type: {
    type: String,
    enum: [
      'chat', 'image', 'video', 'audio', 'voice',
      'document', 'sticker', 'location', 'vcard',
      'group_invite', 'buttons', 'list', 'poll',
      'product', 'order', 'payment', 'call_log'
    ],
    required: true,
    index: true
  },
  body: {
    type: String,
    default: ''
  },
  caption: String,

  // Medien-Informationen
  media: {
    hasMedia: { type: Boolean, default: false },
    mimetype: String,
    filename: String,
    filesize: Number,
    mediaUrl: String,
    thumbnailUrl: String
  },

  // Nachrichtenstatus
  direction: {
    type: String,
    enum: ['inbound', 'outbound'],
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'deleted'],
    default: 'pending',
    index: true
  },
  ack: {
    type: Number,
    enum: [-1, 0, 1, 2, 3, 4], // WhatsApp ACK codes
    default: 0
  },

  // Erweiterte Eigenschaften
  isForwarded: { type: Boolean, default: false },
  forwardingScore: { type: Number, default: 0 },
  isStarred: { type: Boolean, default: false },
  isFromMe: { type: Boolean, default: false },
  isStatus: { type: Boolean, default: false },

  // Antworten und Erwähnungen
  hasQuotedMsg: { type: Boolean, default: false },
  quotedMsgId: String,
  mentionedIds: [String],

  // Reaktionen
  reactions: [{
    emoji: String,
    senderId: String,
    timestamp: Date
  }],

  // Standort (falls Standort-Nachricht)
  location: {
    latitude: Number,
    longitude: Number,
    description: String,
    name: String,
    address: String,
    url: String
  },

  // Kontakt-Cards (falls vCard)
  vCards: [String],

  // Gruppen-spezifisch
  groupInfo: {
    isGroup: { type: Boolean, default: false },
    groupName: String,
    groupParticipants: [String],
    adminOnly: { type: Boolean, default: false }
  },

  // Business-spezifisch
  businessInfo: {
    businessOwnerId: String,
    productId: String,
    orderId: String,
    paymentMethod: String
  },

  // Webhook und Verarbeitung
  webhook: {
    sent: { type: Boolean, default: false },
    sentAt: Date,
    attempts: { type: Number, default: 0 },
    lastAttempt: Date,
    response: String
  },

  // Metadaten
  metadata: {
    deviceType: String,
    clientVersion: String,
    timestamp: Date,
    editedAt: Date,
    deletedAt: Date
  },

  // Zeitstempel
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Compound-Indizes für bessere Performance
MessageSchema.index({ instanceId: 1, timestamp: -1 });
MessageSchema.index({ userId: 1, createdAt: -1 });
MessageSchema.index({ chatId: 1, timestamp: -1 });
MessageSchema.index({ from: 1, timestamp: -1 });
MessageSchema.index({ type: 1, direction: 1 });
MessageSchema.index({ status: 1, createdAt: -1 });

// TTL Index für automatisches Löschen alter Nachrichten (optional)
MessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 }); // 1 Jahr

// Virtuelle Felder
MessageSchema.virtual('isRead').get(function() {
  return this.ack >= 3;
});

MessageSchema.virtual('isDelivered').get(function() {
  return this.ack >= 2;
});

MessageSchema.virtual('age').get(function() {
  return Date.now() - this.timestamp;
});

// Middleware
MessageSchema.pre('save', function(next) {
  // Status basierend auf ACK setzen
  if (this.ack === -1) this.status = 'failed';
  else if (this.ack === 0) this.status = 'pending';
  else if (this.ack === 1) this.status = 'sent';
  else if (this.ack >= 2) this.status = 'delivered';
  else if (this.ack >= 3) this.status = 'read';

  next();
});

// Statische Methoden
MessageSchema.statics.findByInstance = function(instanceId, limit = 100) {
  return this.find({ instanceId })
    .sort({ timestamp: -1 })
    .limit(limit);
};

MessageSchema.statics.findByChat = function(instanceId, chatId, limit = 50) {
  return this.find({ instanceId, chatId })
    .sort({ timestamp: -1 })
    .limit(limit);
};

MessageSchema.statics.getMessageStats = function(instanceId, dateFrom, dateTo) {
  const match = { instanceId };
  if (dateFrom || dateTo) {
    match.timestamp = {};
    if (dateFrom) match.timestamp.$gte = new Date(dateFrom);
    if (dateTo) match.timestamp.$lte = new Date(dateTo);
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        sent: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
        received: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        media: { $sum: { $cond: ['$media.hasMedia', 1, 0] } }
      }
    }
  ]);
};

MessageSchema.statics.getHourlyStats = function(instanceId, days = 7) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - days);

  return this.aggregate([
    {
      $match: {
        instanceId,
        timestamp: { $gte: dateFrom }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' },
          hour: { $hour: '$timestamp' }
        },
        count: { $sum: 1 },
        sent: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
        received: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
  ]);
};

// Instance-Methoden
MessageSchema.methods.markAsRead = function() {
  this.ack = 3;
  this.status = 'read';
  return this.save();
};

MessageSchema.methods.markAsFailed = function(error) {
  this.ack = -1;
  this.status = 'failed';
  this.metadata.error = error;
  return this.save();
};

MessageSchema.methods.updateWebhookStatus = function(sent, response) {
  this.webhook.sent = sent;
  this.webhook.sentAt = new Date();
  this.webhook.attempts += 1;
  this.webhook.lastAttempt = new Date();
  this.webhook.response = response;
  return this.save();
};

module.exports = mongoose.model('Message', MessageSchema);