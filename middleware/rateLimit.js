const rateLimit = require('express-rate-limit');

/**
 * Clean Rate-Limit Middleware
 * Compatible with express-rate-limit v6+ without deprecated options
 */
function createRateLimit(options = {}) {
  const defaults = {
    windowMs: 60000, // 1 minute
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.'
    }
  };

  return rateLimit({
    ...defaults,
    ...options
  });
}

module.exports = createRateLimit;