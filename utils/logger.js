const winston = require('winston');
const path = require('path');

// Log-Levels definieren
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

// Log-Farben
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'grey'
};

winston.addColors(logColors);

// Console-Format
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = ` ${JSON.stringify(meta)}`;
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// File-Format (JSON für bessere Verarbeitung)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Log-Ordner erstellen falls nicht vorhanden
const logDir = path.join(process.cwd(), 'logs');
require('fs').mkdirSync(logDir, { recursive: true });

// Winston Logger konfigurieren
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels: logLevels,
  defaultMeta: {
    service: 'whatsapp-manager',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Console-Output
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
    }),

    // Error-Log (nur Fehler)
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5,
      tailable: true
    }),

    // Combined-Log (alle Levels)
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: fileFormat,
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 10,
      tailable: true
    }),

    // HTTP-Access-Log
    new winston.transports.File({
      filename: path.join(logDir, 'access.log'),
      level: 'http',
      format: fileFormat,
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5,
      tailable: true
    })
  ],

  // Exception-Handling
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      format: fileFormat
    })
  ],

  // Rejection-Handling (für unhandled Promise rejections)
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'rejections.log'),
      format: fileFormat
    })
  ]
});

// Development-spezifische Konfiguration
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.File({
    filename: path.join(logDir, 'debug.log'),
    level: 'debug',
    format: fileFormat,
    maxsize: 20 * 1024 * 1024, // 20MB
    maxFiles: 3
  }));
}

// HTTP-Request-Logger für Express
const httpLogger = winston.createLogger({
  level: 'http',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'access.log'),
      maxsize: 50 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});

// Express-Middleware für Request-Logging
const requestLogger = (req, res, next) => {
  const start = Date.now();

  // Response beenden abfangen
  const originalSend = res.send;
  res.send = function(...args) {
    const duration = Date.now() - start;

    httpLogger.http('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      contentLength: res.get('Content-Length'),
      timestamp: new Date().toISOString()
    });

    originalSend.apply(this, args);
  };

  next();
};

// WhatsApp-spezifische Logger
const whatsappLogger = {
  // Instance-Events
  instance: (instanceId, event, data = {}) => {
    logger.info(`Instance ${event}`, {
      instanceId,
      event,
      ...data,
      category: 'instance'
    });
  },

  // Message-Events
  message: (instanceId, direction, chatId, messageType, data = {}) => {
    logger.info(`Message ${direction}`, {
      instanceId,
      direction,
      chatId,
      messageType,
      ...data,
      category: 'message'
    });
  },

  // API-Calls
  api: (apiKey, method, params, success, duration, error = null) => {
    const level = success ? 'info' : 'error';
    logger.log(level, `API Call: ${method}`, {
      apiKey: apiKey.substring(0, 8) + '...',
      method,
      paramCount: Array.isArray(params) ? params.length : 0,
      success,
      duration: `${duration}ms`,
      error: error?.message,
      category: 'api'
    });
  },

  // Webhook-Events
  webhook: (instanceId, webhookUrl, event, success, response = null, error = null) => {
    const level = success ? 'info' : 'warn';
    logger.log(level, `Webhook ${event}`, {
      instanceId,
      webhookUrl: webhookUrl.substring(0, 50) + '...',
      event,
      success,
      response: response?.status,
      error: error?.message,
      category: 'webhook'
    });
  },

  // Authentication-Events
  auth: (userId, action, success, ip, userAgent) => {
    const level = success ? 'info' : 'warn';
    logger.log(level, `Auth: ${action}`, {
      userId,
      action,
      success,
      ip,
      userAgent,
      category: 'auth'
    });
  }
};

// Performance-Monitor
const performanceLogger = {
  start: (operation) => {
    return {
      operation,
      startTime: process.hrtime.bigint()
    };
  },

  end: (timer, success = true, metadata = {}) => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - timer.startTime) / 1_000_000; // in milliseconds

    logger.info(`Performance: ${timer.operation}`, {
      operation: timer.operation,
      duration: `${duration.toFixed(2)}ms`,
      success,
      ...metadata,
      category: 'performance'
    });

    return duration;
  }
};

// System-Health-Logger
const systemLogger = {
  health: () => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    logger.info('System Health Check', {
      memory: {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: `${Math.round(process.uptime())}s`,
      category: 'system'
    });
  },

  startup: (config) => {
    logger.info('Application Starting', {
      nodeVersion: process.version,
      platform: process.platform,
      environment: process.env.NODE_ENV,
      port: config.port,
      database: config.database ? 'connected' : 'not configured',
      category: 'system'
    });
  },

  shutdown: (reason) => {
    logger.info('Application Shutting Down', {
      reason,
      uptime: `${Math.round(process.uptime())}s`,
      category: 'system'
    });
  }
};

// Error-Helper
const logError = (error, context = {}) => {
  logger.error(error.message, {
    stack: error.stack,
    name: error.name,
    ...context,
    category: 'error'
  });
};

// Stream für Morgan HTTP-Logger (falls verwendet)
const stream = {
  write: (message) => {
    httpLogger.http(message.trim());
  }
};

module.exports = {
  logger,
  httpLogger,
  requestLogger,
  whatsappLogger,
  performanceLogger,
  systemLogger,
  logError,
  stream
};