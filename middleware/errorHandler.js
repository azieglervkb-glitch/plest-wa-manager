const { logger, logError } = require('../utils/logger');

// Custom Error-Klassen
class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT_ERROR');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_ERROR');
  }
}

class WhatsAppError extends AppError {
  constructor(message, instanceId = null) {
    super(message, 500, 'WHATSAPP_ERROR');
    this.instanceId = instanceId;
  }
}

// Fehler-Details für verschiedene Fehlertypen
const getErrorDetails = (error) => {
  // MongoDB-Fehler
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message,
      value: err.value
    }));
    return {
      type: 'validation_error',
      errors,
      statusCode: 400
    };
  }

  if (error.name === 'MongoError' || error.name === 'MongoServerError') {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return {
        type: 'duplicate_field',
        field,
        message: `${field} already exists`,
        statusCode: 409
      };
    }
    return {
      type: 'database_error',
      message: 'Database operation failed',
      statusCode: 500
    };
  }

  // JWT-Fehler
  if (error.name === 'JsonWebTokenError') {
    return {
      type: 'invalid_token',
      message: 'Invalid authentication token',
      statusCode: 401
    };
  }

  if (error.name === 'TokenExpiredError') {
    return {
      type: 'token_expired',
      message: 'Authentication token expired',
      statusCode: 401
    };
  }

  // Puppeteer/WhatsApp-Fehler
  if (error.name === 'TimeoutError') {
    return {
      type: 'timeout_error',
      message: 'Operation timed out',
      statusCode: 408
    };
  }

  // Multer-Fehler (File Upload)
  if (error.code === 'LIMIT_FILE_SIZE') {
    return {
      type: 'file_too_large',
      message: `File too large. Maximum size: ${error.field}`,
      statusCode: 400
    };
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return {
      type: 'too_many_files',
      message: `Too many files. Maximum: ${error.field}`,
      statusCode: 400
    };
  }

  // Custom App-Fehler
  if (error.isOperational) {
    return {
      type: error.code || 'app_error',
      message: error.message,
      statusCode: error.statusCode,
      field: error.field,
      instanceId: error.instanceId
    };
  }

  // Unbekannte Fehler
  return {
    type: 'internal_error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
    statusCode: 500
  };
};

// Development-Error-Handler (detaillierte Fehlerinfo)
const sendErrorDev = (error, req, res) => {
  const errorDetails = getErrorDetails(error);

  logError(error, {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    requestId: req.id
  });

  res.status(errorDetails.statusCode).json({
    status: 'error',
    error: {
      type: errorDetails.type,
      message: errorDetails.message,
      field: errorDetails.field,
      instanceId: errorDetails.instanceId,
      errors: errorDetails.errors,
      stack: error.stack,
      name: error.name
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      timestamp: new Date().toISOString()
    }
  });
};

// Production-Error-Handler (minimale Fehlerinfo)
const sendErrorProd = (error, req, res) => {
  const errorDetails = getErrorDetails(error);

  // Nur operational errors an Client senden
  if (error.isOperational || errorDetails.statusCode < 500) {
    logError(error, {
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userId: req.user?.id,
      severity: 'warning'
    });

    res.status(errorDetails.statusCode).json({
      status: 'error',
      error: {
        type: errorDetails.type,
        message: errorDetails.message,
        field: errorDetails.field,
        errors: errorDetails.errors
      }
    });
  } else {
    // Programming errors -> generic message
    logError(error, {
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userId: req.user?.id,
      severity: 'critical'
    });

    res.status(500).json({
      status: 'error',
      error: {
        type: 'internal_error',
        message: 'Something went wrong on our end'
      }
    });
  }
};

// Async-Error-Wrapper (für async Route-Handler)
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

// 404-Handler für unbekannte Routes
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl} not found`);
  next(error);
};

// Globaler Error-Handler
const globalErrorHandler = (error, req, res, next) => {
  // Fehler-ID für Tracking generieren
  error.id = require('crypto').randomUUID();
  req.errorId = error.id;

  // Fehler basierend auf Environment behandeln
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(error, req, res);
  } else {
    sendErrorProd(error, req, res);
  }
};

// Unhandled Promise Rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString(),
    category: 'system'
  });

  // Graceful shutdown in production
  if (process.env.NODE_ENV === 'production') {
    logger.info('Shutting down due to unhandled promise rejection');
    process.exit(1);
  }
});

// Uncaught Exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    message: error.message,
    stack: error.stack,
    category: 'system'
  });

  // Immer shutdown bei uncaught exceptions
  logger.info('Shutting down due to uncaught exception');
  process.exit(1);
});

// Warning-Handler für Node.js Warnungen
process.on('warning', (warning) => {
  logger.warn('Node.js Warning', {
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
    category: 'system'
  });
});

// Error-Reporting für externe Services (z.B. Sentry)
const reportError = (error, context = {}) => {
  if (process.env.SENTRY_DSN) {
    // Sentry-Integration hier implementieren
  }

  if (process.env.BUGSNAG_API_KEY) {
    // Bugsnag-Integration hier implementieren
  }

  // Slack/Discord-Webhook für kritische Fehler
  if (process.env.ERROR_WEBHOOK_URL && error.statusCode >= 500) {
    // Webhook-Benachrichtigung senden
  }
};

module.exports = {
  // Error-Klassen
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  WhatsAppError,

  // Middleware
  catchAsync,
  notFoundHandler,
  globalErrorHandler,

  // Utilities
  getErrorDetails,
  reportError
};