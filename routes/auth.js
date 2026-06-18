const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sendEmailNotification } = require('../services/EmailService');

// Middleware: Authenticate token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Register new user
router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      sportClubMembershipNumber,
      initialRating,
      agreeToTerms
    } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName || !sportClubMembershipNumber || initialRating === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (!agreeToTerms) {
      return res.status(400).json({
        error: 'Must agree to terms and policies',
        message: 'This is a non-profit system run by volunteers. Respect and fair play are essential.'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Check if membership number already used
    const existingMember = await User.findOne({ sportClubMembershipNumber });
    if (existingMember) {
      return res.status(400).json({ error: 'Membership number already registered' });
    }

    // Enforce hard floor of 4.0 and ceiling of 10.0
    let finalRating = parseFloat(initialRating);
    if (isNaN(finalRating)) {
      return res.status(400).json({ error: 'Invalid rating value' });
    }

    if (finalRating < 4.0) {
      finalRating = 4.0;
    }
    if (finalRating > 10.0) {
      finalRating = 10.0;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      sportClubMembershipNumber: sportClubMembershipNumber.trim(),
      rating: finalRating,
      registeredAt: new Date(),
      playingFrequency: null,
      paused: false,
      frozen: false,
      cancellationCount: 0,
      flagged: false,
      role: 'user'
    });

    await user.save();

    // Send welcome email
    await sendEmailNotification(email, 'user_registered', {
      userName: `${firstName} ${lastName}`,
      initialRating: finalRating,
      note: 'Welcome to Tennis Ladder! Please complete your profile to start playing. Users can register at any time and will be matched in the next game round.'
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        rating: user.rating,
        profileComplete: false
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if account is frozen
    if (user.frozen) {
      if (new Date() < user.freezeEndDate) {
        return res.status(403).json({
          error: 'Account is frozen',
          freezeEndDate: user.freezeEndDate,
          message: 'Your account has been frozen for 3 weeks due to repeated cancellations. During this period, you cannot receive new match assignments.'
        });
      } else {
        // Auto-unfreeze if period expired
        user.frozen = false;
        user.freezeReason = null;
        user.freezeStartDate = null;
        user.freezeEndDate = null;
        user.cancellationCount = 0;
        await user.save();
      }
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        rating: user.rating,
        profileComplete: user.playingFrequency ? true : false,
        paused: user.paused,
        frozen: user.frozen
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify token (check if logged in)
router.get('/verify', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'Token is valid',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal if email exists for security
      return res.json({
        message: 'If email exists, password reset link has been sent'
      });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = jwt.sign(
      { id: user.id, type: 'password-reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Save reset token to user (in production, store hashed version)
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Send reset email
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    await sendEmailNotification(email, 'password_reset_request', {
      userName: `${user.firstName} ${user.lastName}`,
      resetLink,
      expiresIn: '1 hour'
    });

    res.json({
      message: 'If email exists, password reset link has been sent'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(403).json({ error: 'Invalid or expired reset token' });
    }

    const user = await User.findById(decoded.id);
    if (!user || user.passwordResetToken !== token) {
      return res.status(403).json({ error: 'Invalid reset token' });
    }

    if (new Date() > user.passwordResetExpires) {
      return res.status(403).json({ error: 'Reset token has expired' });
    }

    // Update password
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    // Send confirmation email
    await sendEmailNotification(user.email, 'password_reset_success', {
      userName: `${user.firstName} ${user.lastName}`,
      note: 'Your password has been reset successfully. You can now log in with your new password.'
    });

    res.json({
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Logout (client-side primarily, but can be used to invalidate tokens server-side if needed)
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // In a production system, you might want to:
    // - Blacklist the token in Redis/cache
    // - Remove refresh tokens from database
    // For now, logout is handled client-side by removing the token

    res.json({ message: 'Logout successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Change password (authenticated user)
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Update password
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Send confirmation email
    await sendEmailNotification(user.email, 'password_changed', {
      userName: `${user.firstName} ${user.lastName}`,
      note: 'Your password has been changed successfully.'
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
