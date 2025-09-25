const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { whatsappLogger } = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// JWT-Token generieren
const generateToken = (userId) => {
  return jwt.sign(
    { userId, type: 'access' },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'whatsapp-manager',
      audience: 'whatsapp-manager-users'
    }
  );
};

// Refresh-Token generieren (länger gültig)
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    JWT_SECRET,
    {
      expiresIn: '30d',
      issuer: 'whatsapp-manager',
      audience: 'whatsapp-manager-users'
    }
  );
};

// Token aus Request extrahieren
const extractToken = (req) => {
  let token = null;

  // 1. Authorization Header (Bearer Token)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  }
  // 2. X-Access-Token Header
  else if (req.headers['x-access-token']) {
    token = req.headers['x-access-token'];
  }
  // 3. Query Parameter (für WebSocket-Verbindungen)
  else if (req.query && req.query.token) {
    token = req.query.token;
  }
  // 4. Cookie (falls gesetzt)
  else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  return token;
};

// Haupt-Auth-Middleware
const auth = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      whatsappLogger.auth(null, 'missing_token', false, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        error: 'Access denied',
        message: 'No authentication token provided'
      });
    }

    // Token verifizieren
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET, {
        issuer: 'whatsapp-manager',
        audience: 'whatsapp-manager-users'
      });
    } catch (jwtError) {
      whatsappLogger.auth(null, 'invalid_token', false, req.ip, req.get('User-Agent'));

      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expired',
          message: 'Please refresh your token or login again'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Invalid token',
          message: 'Please provide a valid authentication token'
        });
      }

      throw jwtError;
    }

    // Nur Access-Token für normale Auth
    if (decoded.type !== 'access') {
      return res.status(401).json({
        error: 'Invalid token type',
        message: 'Please use an access token'
      });
    }

    // Benutzer aus DB laden
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      whatsappLogger.auth(decoded.userId, 'user_not_found', false, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        error: 'User not found',
        message: 'The user associated with this token no longer exists'
      });
    }

    // Benutzer-Status prüfen
    if (!user.isActive) {
      whatsappLogger.auth(user.id, 'user_inactive', false, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        error: 'Account deactivated',
        message: 'Your account has been deactivated'
      });
    }

    // Password-Change-Validation (Token vor Password-Änderung ungültig)
    if (user.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      whatsappLogger.auth(user.id, 'password_changed', false, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        error: 'Password changed',
        message: 'Please login again after password change'
      });
    }

    // Benutzer-Informationen zu Request hinzufügen
    req.user = user;
    req.token = token;

    // Last-Login aktualisieren (throttled - max einmal pro Stunde)
    const now = new Date();
    if (!user.lastLogin || now - user.lastLogin > 60 * 60 * 1000) {
      user.lastLogin = now;
      await user.save({ validateBeforeSave: false });
    }

    whatsappLogger.auth(user.id, 'authenticated', true, req.ip, req.get('User-Agent'));
    next();

  } catch (error) {
    whatsappLogger.auth(null, 'auth_error', false, req.ip, req.get('User-Agent'));
    res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during authentication'
    });
  }
};

// Optional-Auth-Middleware (für öffentliche Endpunkte mit optionaler Auth)
const optionalAuth = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return next(); // Kein Token = weiter ohne User
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (user && user.isActive) {
      req.user = user;
    }
  } catch (error) {
    // Fehler ignorieren, weiter ohne User
  }

  next();
};

// Admin-Middleware
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please login first'
    });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    whatsappLogger.auth(req.user.id, 'admin_required', false, req.ip, req.get('User-Agent'));
    return res.status(403).json({
      error: 'Admin access required',
      message: 'This endpoint requires admin privileges'
    });
  }

  next();
};

// SuperAdmin-Middleware
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  if (req.user.role !== 'superadmin') {
    whatsappLogger.auth(req.user.id, 'superadmin_required', false, req.ip, req.get('User-Agent'));
    return res.status(403).json({
      error: 'Super admin access required',
      message: 'This endpoint requires super admin privileges'
    });
  }

  next();
};

// Permission-Middleware
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    if (!req.user.hasPermission(permission)) {
      whatsappLogger.auth(req.user.id, `permission_${permission}`, false, req.ip, req.get('User-Agent'));
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `This endpoint requires '${permission}' permission`
      });
    }

    next();
  };
};

// Plan-Limit-Middleware
const requirePlan = (minPlan) => {
  const planHierarchy = {
    'free': 0,
    'basic': 1,
    'premium': 2,
    'enterprise': 3
  };

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const userPlanLevel = planHierarchy[req.user.plan] || 0;
    const requiredPlanLevel = planHierarchy[minPlan] || 0;

    if (userPlanLevel < requiredPlanLevel) {
      whatsappLogger.auth(req.user.id, `plan_${minPlan}_required`, false, req.ip, req.get('User-Agent'));
      return res.status(403).json({
        error: 'Plan upgrade required',
        message: `This feature requires '${minPlan}' plan or higher`,
        currentPlan: req.user.plan,
        requiredPlan: minPlan
      });
    }

    next();
  };
};

// API-Key-Middleware (für externe API-Zugriffe)
const apiKeyAuth = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.params.apiKey;

    if (!apiKey) {
      return res.status(401).json({
        error: 'API key required',
        message: 'Please provide API key in X-API-Key header or URL parameter'
      });
    }

    // Instance anhand API-Key finden
    const Instance = require('../models/Instance');
    const instance = await Instance.findOne({ apiKey }).populate('userId');

    if (!instance) {
      whatsappLogger.auth(null, 'invalid_api_key', false, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        error: 'Invalid API key',
        message: 'The provided API key is not valid'
      });
    }

    // Benutzer-Status prüfen
    if (!instance.userId.isActive) {
      return res.status(401).json({
        error: 'Account deactivated',
        message: 'The account associated with this API key is deactivated'
      });
    }

    // Instance-Status prüfen
    if (instance.status !== 'ready') {
      return res.status(400).json({
        error: 'Instance not ready',
        message: `Instance status: ${instance.status}`,
        instanceId: instance.instanceId
      });
    }

    req.user = instance.userId;
    req.instance = instance;
    req.apiKey = apiKey;

    whatsappLogger.auth(instance.userId.id, 'api_key_auth', true, req.ip, req.get('User-Agent'));
    next();

  } catch (error) {
    res.status(500).json({
      error: 'API key authentication error',
      message: 'Internal server error during API key authentication'
    });
  }
};

// WebSocket-Auth für Socket.IO
const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;

    if (!token) {
      return next(new Error('No token provided'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user || !user.isActive) {
      return next(new Error('Invalid user'));
    }

    socket.userId = user.id;
    socket.user = user;

    whatsappLogger.auth(user.id, 'websocket_auth', true, socket.handshake.address, socket.handshake.headers['user-agent']);
    next();

  } catch (error) {
    next(new Error('Authentication failed'));
  }
};

module.exports = {
  auth,
  optionalAuth,
  requireAdmin,
  requireSuperAdmin,
  requirePermission,
  requirePlan,
  apiKeyAuth,
  socketAuth,
  generateToken,
  generateRefreshToken,
  extractToken
};