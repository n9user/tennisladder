const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token
 * Attaches decoded user info to req.user
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      message: 'Please provide a valid JWT token in the Authorization header'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        error: 'Invalid or expired token',
        message: 'Token is no longer valid. Please log in again.'
      });
    }
    req.user = user;
    next();
  });
};

/**
 * Middleware to verify admin role
 * Must be called after authenticateToken
 */
const authenticateAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Authentication required',
      message: 'You must be logged in to access admin features'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      error: 'Admin access required',
      message: 'You do not have permission to access this resource. Admin privileges required.'
    });
  }

  next();
};

/**
 * Middleware to verify optional token (doesn't fail if no token)
 * Useful for public endpoints that show different content if authenticated
 */
const optionalAuthentication = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (!err) {
        req.user = user;
      }
      next();
    });
  } else {
    next();
  }
};

/**
 * Middleware to check if user account is frozen
 */
const checkFrozenStatus = async (req, res, next) => {
  try {
    const User = require('../models/User');
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await User.findById(req.user.id);
    
    if (user.frozen) {
      if (new Date() < user.freezeEndDate) {
        return res.status(403).json({
          error: 'Account is frozen',
          freezeEndDate: user.freezeEndDate,
          message: 'Your account is frozen for repeated cancellations. You cannot perform match operations during this period.'
        });
      } else {
        // Auto-unfreeze if period has expired
        user.frozen = false;
        user.freezeReason = null;
        user.freezeStartDate = null;
        user.freezeEndDate = null;
        user.cancellationCount = 0;
        await user.save();
      }
    }

    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Middleware to check if user is flagged for inappropriate behaviour
 */
const checkFlaggedStatus = async (req, res, next) => {
  try {
    const User = require('../models/User');
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await User.findById(req.user.id);
    
    if (user.flagged) {
      return res.status(403).json({
        error: 'Account is flagged',
        flaggedDate: user.flaggedDate,
        message: 'Your account has been flagged for inappropriate behaviour. Please contact support.'
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  authenticateToken,
  authenticateAdmin,
  optionalAuthentication,
  checkFrozenStatus,
  checkFlaggedStatus
};
