const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('redis');
const { logger, whatsappLogger } = require('../utils/logger');

// Redis-Client für Rate-Limiting (falls verfügbar)
let redisClient = null;
if (process.env.REDIS_URL) {
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          logger.error('Redis server refused connection');
          return new Error('Redis server refused connection');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          return new Error('Redis retry time exhausted');
        }
        if (options.attempt > 10) {
          return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
      }
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected for rate limiting');
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error:', err);
    });
  } catch (error) {
    logger.warn('Redis not available, using in-memory rate limiting');
    redisClient = null;
  }
}

// Standard Rate-Limit-Konfiguration
const createRateLimit = (options = {}) => {
  const defaultOptions = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 Minute
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 Requests pro Fenster
    standardHeaders: true, // Rate-Limit-Info in Headers
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    keyGenerator: (req) => {
      // User-basiertes Rate-Limiting falls authentifiziert
      if (req.user) {
        return `user:${req.user.id}:${req.ip}`;
      }
      // Sonst IP-basiert
      return req.ip;
    },
    handler: (req, res) => {
      const userId = req.user?.id || 'anonymous';
      whatsappLogger.auth(userId, 'rate_limit_exceeded', false, req.ip, req.get('User-Agent'));

      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.round(options.windowMs / 1000) || 60
      });
    },
    onLimitReached: (req, res, options) => {
      logger.warn('Rate limit reached', {
        ip: req.ip,
        userId: req.user?.id,
        endpoint: req.originalUrl,
        userAgent: req.get('User-Agent')
      });
    },
    // Redis-Store falls verfügbar
    store: redisClient ? new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
      prefix: 'rl:',
    }) : undefined
  };

  return rateLimit({
    ...defaultOptions,
    ...options
  });
};

// Spezifische Rate-Limits für verschiedene Endpunkte

// Authentifizierungs-Endpunkte (strenger)
const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 5, // 5 Login-Versuche pro 15 Minuten
  skipSuccessfulRequests: true, // Erfolgreiche Logins nicht zählen
  keyGenerator: (req) => `auth:${req.ip}`,
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      endpoint: req.originalUrl,
      userAgent: req.get('User-Agent')
    });

    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Please wait 15 minutes before trying again',
      retryAfter: 900
    });
  }
});

// API-Endpunkte (moderate Limits)
const apiRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 60, // 60 Requests pro Minute
  keyGenerator: (req) => {
    if (req.user) {
      return `api:${req.user.id}`;
    }
    return `api:${req.ip}`;
  }
});

// WhatsApp-Nachrichten (sehr streng)
const messageRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 20, // 20 Nachrichten pro Minute (WhatsApp-konform)
  keyGenerator: (req) => {
    if (req.instance) {
      return `msg:${req.instance.instanceId}`;
    }
    if (req.user) {
      return `msg:${req.user.id}`;
    }
    return `msg:${req.ip}`;
  },
  handler: (req, res) => {
    const instanceId = req.instance?.instanceId || 'unknown';
    whatsappLogger.instance(instanceId, 'message_rate_limit', {
      userId: req.user?.id,
      ip: req.ip
    });

    res.status(429).json({
      error: 'Message rate limit exceeded',
      message: 'Maximum 20 messages per minute allowed',
      retryAfter: 60,
      instanceId
    });
  }
});

// Admin-Endpunkte
const adminRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 100, // 100 Requests pro Minute für Admins
  keyGenerator: (req) => `admin:${req.user?.id || req.ip}`
});

// Upload-Endpunkte
const uploadRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 10, // 10 Uploads pro 15 Minuten
  keyGenerator: (req) => `upload:${req.user?.id || req.ip}`,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Upload rate limit exceeded',
      message: 'Maximum 10 uploads per 15 minutes allowed',
      retryAfter: 900
    });
  }
});

// Webhook-Endpunkte (für eingehende Webhooks)
const webhookRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 200, // 200 Webhooks pro Minute
  keyGenerator: (req) => `webhook:${req.ip}`,
  skipFailedRequests: true // Nur erfolgreiche Webhooks zählen
});

// Dynamisches Rate-Limiting basierend auf User-Plan
const createPlanBasedRateLimit = (windowMs = 60000) => {
  return (req, res, next) => {
    if (!req.user) {
      return next();
    }

    // Rate-Limits basierend auf Benutzerplan
    const planLimits = {
      free: 30,
      basic: 100,
      premium: 300,
      enterprise: 1000
    };

    const userLimit = planLimits[req.user.plan] || planLimits.free;

    const dynamicRateLimit = createRateLimit({
      windowMs,
      max: userLimit,
      keyGenerator: (req) => `plan:${req.user.id}`,
      handler: (req, res) => {
        res.status(429).json({
          error: 'Plan rate limit exceeded',
          message: `Your ${req.user.plan} plan allows ${userLimit} requests per minute`,
          currentPlan: req.user.plan,
          limit: userLimit,
          retryAfter: Math.round(windowMs / 1000)
        });
      }
    });

    dynamicRateLimit(req, res, next);
  };
};

// Bulk-Operation Rate-Limiting
const bulkRateLimit = createRateLimit({
  windowMs: 5 * 60 * 1000, // 5 Minuten
  max: 5, // 5 Bulk-Operations pro 5 Minuten
  keyGenerator: (req) => `bulk:${req.user?.id || req.ip}`,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Bulk operation rate limit exceeded',
      message: 'Maximum 5 bulk operations per 5 minutes allowed',
      retryAfter: 300
    });
  }
});

// IP-Whitelist für Rate-Limiting
const createWhitelistRateLimit = (whitelist = [], rateLimitOptions = {}) => {
  return (req, res, next) => {
    // IP in Whitelist? -> Skip Rate-Limiting
    if (whitelist.includes(req.ip) || whitelist.includes(req.get('X-Forwarded-For'))) {
      return next();
    }

    // Normale Rate-Limiting anwenden
    const rateLimit = createRateLimit(rateLimitOptions);
    rateLimit(req, res, next);
  };
};

// Rate-Limit-Status abrufen
const getRateLimitStatus = async (key) => {
  if (!redisClient) {
    return null;
  }

  try {
    const count = await redisClient.get(`rl:${key}`);
    return {
      requests: parseInt(count) || 0,
      resetTime: new Date(Date.now() + 60000), // Approximation
      limit: 100 // Default-Limit
    };
  } catch (error) {
    logger.error('Error getting rate limit status:', error);
    return null;
  }
};

// Rate-Limit zurücksetzen (Admin-Funktion)
const resetRateLimit = async (key) => {
  if (!redisClient) {
    return false;
  }

  try {
    await redisClient.del(`rl:${key}`);
    logger.info(`Rate limit reset for key: ${key}`);
    return true;
  } catch (error) {
    logger.error('Error resetting rate limit:', error);
    return false;
  }
};

// Globale Rate-Limit-Statistiken
const getRateLimitStats = async () => {
  if (!redisClient) {
    return { error: 'Redis not available' };
  }

  try {
    const keys = await redisClient.keys('rl:*');
    const stats = {
      totalKeys: keys.length,
      keyTypes: {},
      topHitters: []
    };

    // Analyse der Keys
    for (const key of keys.slice(0, 100)) { // Nur erste 100 für Performance
      const keyType = key.split(':')[1];
      stats.keyTypes[keyType] = (stats.keyTypes[keyType] || 0) + 1;

      const count = await redisClient.get(key);
      if (count > 10) { // Nur interessante Hits
        stats.topHitters.push({
          key: key.replace('rl:', ''),
          requests: parseInt(count)
        });
      }
    }

    // Top-Hitters sortieren
    stats.topHitters.sort((a, b) => b.requests - a.requests);
    stats.topHitters = stats.topHitters.slice(0, 10);

    return stats;
  } catch (error) {
    logger.error('Error getting rate limit stats:', error);
    return { error: error.message };
  }
};

module.exports = {
  createRateLimit,
  authRateLimit,
  apiRateLimit,
  messageRateLimit,
  adminRateLimit,
  uploadRateLimit,
  webhookRateLimit,
  bulkRateLimit,
  createPlanBasedRateLimit,
  createWhitelistRateLimit,
  getRateLimitStatus,
  resetRateLimit,
  getRateLimitStats
};