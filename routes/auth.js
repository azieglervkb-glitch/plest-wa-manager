const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const User = require('../models/User');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const logger = require('../utils/logger');

// Validierungsregeln
const registerValidation = [
  body('username').trim().isLength({ min: 3, max: 30 }).withMessage('Username muss 3-30 Zeichen lang sein'),
  body('email').isEmail().normalizeEmail().withMessage('Gültige E-Mail-Adresse erforderlich'),
  body('password').isLength({ min: 8 }).withMessage('Passwort muss mindestens 8 Zeichen lang sein'),
  body('password').matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Passwort muss Klein-, Großbuchstaben und Zahlen enthalten')
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Gültige E-Mail-Adresse erforderlich'),
  body('password').notEmpty().withMessage('Passwort ist erforderlich')
];

// POST /api/auth/register - Benutzerregistrierung
router.post('/register', rateLimit({ max: 5, windowMs: 15 * 60 * 1000 }), registerValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    // Prüfen ob Benutzer bereits existiert
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({
        error: 'User already exists',
        message: existingUser.email === email ? 'Email already registered' : 'Username already taken'
      });
    }

    // Passwort hashen
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Neuen Benutzer erstellen
    const user = new User({
      username,
      email,
      password: hashedPassword,
      role: 'user',
      plan: 'free',
      isActive: true
    });

    await user.save();

    // Tokens generieren
    const accessToken = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Refresh-Token in DB speichern
    user.refreshTokens = [{ token: refreshToken, createdAt: new Date() }];
    await user.save();

    logger.whatsappLogger.auth(user._id, 'register', true, req.ip, req.get('User-Agent'));

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        plan: user.plan,
        createdAt: user.createdAt
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: '7d'
      }
    });

  } catch (error) {
    logger.logError(error, { context: 'register', ip: req.ip });
    res.status(500).json({
      error: 'Registration failed',
      message: 'Internal server error during registration'
    });
  }
});

// POST /api/auth/login - Benutzeranmeldung
router.post('/login', rateLimit({ max: 10, windowMs: 15 * 60 * 1000 }), loginValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Benutzer finden
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      logger.whatsappLogger.auth(null, 'login_failed_user_not_found', false, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Passwort prüfen
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logger.whatsappLogger.auth(user._id, 'login_failed_wrong_password', false, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Account-Status prüfen
    if (!user.isActive) {
      logger.whatsappLogger.auth(user._id, 'login_failed_inactive', false, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        error: 'Account deactivated',
        message: 'Your account has been deactivated. Contact support.'
      });
    }

    // Tokens generieren
    const accessToken = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Alte Refresh-Tokens bereinigen (älter als 30 Tage)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    user.refreshTokens = user.refreshTokens.filter(
      tokenObj => tokenObj.createdAt > thirtyDaysAgo
    );

    // Neuen Refresh-Token hinzufügen
    user.refreshTokens.push({ token: refreshToken, createdAt: new Date() });

    // Last-Login aktualisieren
    user.lastLogin = new Date();
    await user.save();

    logger.whatsappLogger.auth(user._id, 'login_success', true, req.ip, req.get('User-Agent'));

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        plan: user.plan,
        lastLogin: user.lastLogin
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: '7d'
      }
    });

  } catch (error) {
    logger.logError(error, { context: 'login', ip: req.ip });
    res.status(500).json({
      error: 'Login failed',
      message: 'Internal server error during login'
    });
  }
});

// POST /api/auth/refresh - Token erneuern
router.post('/refresh', rateLimit({ max: 20, windowMs: 15 * 60 * 1000 }), async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Refresh token required',
        message: 'Please provide a refresh token'
      });
    }

    // Refresh-Token verifizieren
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_SECRET);
    } catch (jwtError) {
      return res.status(401).json({
        error: 'Invalid refresh token',
        message: 'Please login again'
      });
    }

    // Benutzer finden und Refresh-Token prüfen
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        error: 'User not found or inactive',
        message: 'Please login again'
      });
    }

    const tokenExists = user.refreshTokens.some(tokenObj => tokenObj.token === refreshToken);
    if (!tokenExists) {
      return res.status(401).json({
        error: 'Refresh token not found',
        message: 'Please login again'
      });
    }

    // Neue Tokens generieren
    const newAccessToken = generateToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    // Alte Refresh-Tokens ersetzen
    user.refreshTokens = user.refreshTokens.filter(tokenObj => tokenObj.token !== refreshToken);
    user.refreshTokens.push({ token: newRefreshToken, createdAt: new Date() });
    await user.save();

    logger.whatsappLogger.auth(user._id, 'token_refresh', true, req.ip, req.get('User-Agent'));

    res.json({
      tokens: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: '7d'
      }
    });

  } catch (error) {
    logger.logError(error, { context: 'refresh_token', ip: req.ip });
    res.status(500).json({
      error: 'Token refresh failed',
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/logout - Abmelden
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const userId = req.user?.id; // Falls auth-Middleware verwendet wird

    if (refreshToken && userId) {
      // Refresh-Token aus DB entfernen
      await User.updateOne(
        { _id: userId },
        { $pull: { refreshTokens: { token: refreshToken } } }
      );
    }

    logger.whatsappLogger.auth(userId, 'logout', true, req.ip, req.get('User-Agent'));

    res.json({ message: 'Logged out successfully' });

  } catch (error) {
    logger.logError(error, { context: 'logout', ip: req.ip });
    res.status(500).json({
      error: 'Logout failed',
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/logout-all - Alle Sessions abmelden
router.post('/logout-all', require('../middleware/auth').auth, async (req, res) => {
  try {
    // Alle Refresh-Tokens entfernen
    req.user.refreshTokens = [];
    await req.user.save();

    logger.whatsappLogger.auth(req.user.id, 'logout_all', true, req.ip, req.get('User-Agent'));

    res.json({ message: 'Logged out from all devices' });

  } catch (error) {
    logger.logError(error, { context: 'logout_all', userId: req.user?.id });
    res.status(500).json({
      error: 'Logout all failed',
      message: 'Internal server error'
    });
  }
});

// GET /api/auth/me - Aktuelle Benutzerinformationen
router.get('/me', require('../middleware/auth').auth, async (req, res) => {
  try {
    const user = req.user;

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        plan: user.plan,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        usage: user.usage,
        planLimits: user.planLimits
      }
    });

  } catch (error) {
    logger.logError(error, { context: 'get_me', userId: req.user?.id });
    res.status(500).json({
      error: 'Failed to get user info',
      message: 'Internal server error'
    });
  }
});

// PUT /api/auth/change-password - Passwort ändern
router.put('/change-password',
  require('../middleware/auth').auth,
  rateLimit({ max: 5, windowMs: 15 * 60 * 1000 }),
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
    body('newPassword').matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('New password must contain lowercase, uppercase and numbers')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { currentPassword, newPassword } = req.body;
      const user = await User.findById(req.user.id).select('+password');

      // Aktuelles Passwort prüfen
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          error: 'Current password incorrect',
          message: 'Please provide the correct current password'
        });
      }

      // Neues Passwort hashen
      const hashedNewPassword = await bcrypt.hash(newPassword, 12);

      // Passwort und Timestamp aktualisieren
      user.password = hashedNewPassword;
      user.passwordChangedAt = new Date();

      // Alle Refresh-Tokens löschen (User muss sich neu einloggen)
      user.refreshTokens = [];

      await user.save();

      logger.whatsappLogger.auth(user._id, 'password_change', true, req.ip, req.get('User-Agent'));

      res.json({
        message: 'Password changed successfully',
        notice: 'Please login again with your new password'
      });

    } catch (error) {
      logger.logError(error, { context: 'change_password', userId: req.user?.id });
      res.status(500).json({
        error: 'Password change failed',
        message: 'Internal server error'
      });
    }
  }
);

module.exports = router;