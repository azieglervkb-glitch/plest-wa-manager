const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },

  // Benutzer-Info
  firstName: {
    type: String,
    trim: true
  },
  lastName: {
    type: String,
    trim: true
  },
  company: {
    type: String,
    trim: true
  },

  // Rolle und Berechtigungen
  role: {
    type: String,
    enum: ['user', 'admin', 'superadmin'],
    default: 'user'
  },
  permissions: [{
    type: String,
    enum: [
      'instances.create',
      'instances.read',
      'instances.update',
      'instances.delete',
      'messages.send',
      'messages.read',
      'analytics.view',
      'users.manage',
      'system.admin'
    ]
  }],

  // Abonnement/Plan
  plan: {
    type: String,
    enum: ['free', 'basic', 'premium', 'enterprise'],
    default: 'free'
  },
  planLimits: {
    maxInstances: { type: Number, default: 1 },
    maxMessagesPerMonth: { type: Number, default: 1000 },
    maxWebhooks: { type: Number, default: 1 },
    enableApiAccess: { type: Boolean, default: false },
    enableAnalytics: { type: Boolean, default: false }
  },

  // Verbrauch und Statistiken
  usage: {
    currentInstances: { type: Number, default: 0 },
    totalMessages: { type: Number, default: 0 },
    monthlyMessages: { type: Number, default: 0 },
    lastReset: { type: Date, default: Date.now }
  },

  // Konto-Status
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },

  // API-Konfiguration
  apiQuota: {
    requestsPerMinute: { type: Number, default: 60 },
    requestsPerHour: { type: Number, default: 1000 },
    requestsPerDay: { type: Number, default: 10000 }
  },

  // Zeitstempel
  lastLogin: Date,
  passwordChangedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.password;
      return ret;
    }
  }
});

// Virtuelle Felder
UserSchema.virtual('fullName').get(function() {
  return `${this.firstName || ''} ${this.lastName || ''}`.trim();
});

UserSchema.virtual('canCreateInstance').get(function() {
  return this.usage.currentInstances < this.planLimits.maxInstances;
});

UserSchema.virtual('instancesLeft').get(function() {
  return Math.max(0, this.planLimits.maxInstances - this.usage.currentInstances);
});

// Indizes
UserSchema.index({ email: 1 });
UserSchema.index({ username: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ plan: 1 });

// Middleware
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, 12);
  this.passwordChangedAt = new Date();
  next();
});

// Statische Methoden
UserSchema.statics.findByEmailOrUsername = function(identifier) {
  return this.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { username: identifier }
    ]
  });
};

// Instance-Methoden
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.updateUsage = async function(updates) {
  Object.assign(this.usage, updates);
  return this.save();
};

UserSchema.methods.incrementInstanceCount = async function() {
  this.usage.currentInstances += 1;
  return this.save();
};

UserSchema.methods.decrementInstanceCount = async function() {
  this.usage.currentInstances = Math.max(0, this.usage.currentInstances - 1);
  return this.save();
};

UserSchema.methods.hasPermission = function(permission) {
  if (this.role === 'superadmin') return true;
  return this.permissions.includes(permission);
};

UserSchema.methods.resetMonthlyUsage = function() {
  this.usage.monthlyMessages = 0;
  this.usage.lastReset = new Date();
  return this.save();
};

module.exports = mongoose.model('User', UserSchema);