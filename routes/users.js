const express = require('express');
const router = express.Router();
const User = require('../models/User');
const RatingHistory = require('../models/RatingHistory');
const Match = require('../models/Match');
const { sendEmailNotification } = require('../services/EmailService');
const { authenticateToken } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, sportClubMembershipNumber, initialRating, agreeToTerms } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName || !sportClubMembershipNumber || initialRating === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!agreeToTerms) {
      return res.status(400).json({ error: 'Must agree to terms and policies' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already registered with this email' });
    }

    // Enforce hard floor of 4.0
    let finalRating = initialRating;
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
      email,
      password: hashedPassword,
      firstName,
      lastName,
      sportClubMembershipNumber,
      rating: finalRating,
      registeredAt: new Date(),
      playingFrequency: null, // To be set in profile update
      paused: false,
      frozen: false,
      cancellationCount: 0,
      flagged: false
    });

    await user.save();

    // Send welcome email
    await sendEmailNotification(email, 'user_registered', {
      userName: `${firstName} ${lastName}`,
      initialRating: finalRating,
      note: 'Welcome! Please complete your profile to start playing.'
    });

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        rating: user.rating
      }
    });
  } catch (error) {
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

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if frozen
    if (user.frozen && new Date() < user.freezeEndDate) {
      return res.status(403).json({
        error: 'Your account is frozen',
        freezeEndDate: user.freezeEndDate
      });
    }

    // Auto-unfreeze if freeze period expired
    if (user.frozen && new Date() >= user.freezeEndDate) {
      user.frozen = false;
      user.freezeReason = null;
      user.freezeStartDate = null;
      user.freezeEndDate = null;
      user.cancellationCount = 0;
      await user.save();
    }

    // Generate JWT token
    const jwt = require('jsonwebtoken');
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
        profileComplete: user.playingFrequency ? true : false
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select('-password');

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user profile (post-registration fields)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      gender,
      playingFrequency,
      bio,
      mobileNumber,
      profilePictureUrl,
      paused
    } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Update fields if provided
    if (gender) user.gender = gender;
    if (playingFrequency) {
      user.playingFrequency = playingFrequency; // 'weekly', 'two_weeks', 'three_weeks'
      user.frequencyExpirationDays = {
        'weekly': 7,
        'two_weeks': 14,
        'three_weeks': 21
      }[playingFrequency];
    }
    if (bio !== undefined) user.bio = bio;
    if (mobileNumber) user.mobileNumber = mobileNumber;
    if (profilePictureUrl) {
      user.profilePicture = profilePictureUrl;
    } else if (gender && !user.profilePicture) {
      // Generate initials avatar
      user.profilePicture = generateInitialsAvatar(user.firstName, user.lastName, gender);
    }
    if (paused !== undefined) {
      user.paused = paused;
      if (paused) {
        user.pausedAt = new Date();
      } else {
        user.pausedAt = null;
      }
    }

    user.profileUpdatedAt = new Date();
    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        rating: user.rating,
        gender: user.gender,
        playingFrequency: user.playingFrequency,
        bio: user.bio,
        profilePicture: user.profilePicture,
        paused: user.paused
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user ratings history
router.get('/rating-history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const history = await RatingHistory.find({ userId })
      .populate('matchId', 'scheduledDate finalScore')
      .populate('opponent', 'firstName lastName rating')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pause participation
router.post('/pause', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    user.paused = true;
    user.pausedAt = new Date();

    await user.save();

    // Notify user
    await sendEmailNotification(user.email, 'participation_paused', {
      userName: `${user.firstName} ${user.lastName}`,
      note: 'Your participation is paused. You will not receive new match assignments. Your ranking will drop by at least 1 position weekly.'
    });

    res.json({ message: 'Participation paused', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resume participation
router.post('/resume', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    user.paused = false;
    user.pausedAt = null;

    await user.save();

    // Notify user
    await sendEmailNotification(user.email, 'participation_resumed', {
      userName: `${user.firstName} ${user.lastName}`,
      note: 'Your participation is resumed. You will receive match assignments starting from the next round.'
    });

    res.json({ message: 'Participation resumed', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's ladder position
router.get('/ladder-position', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Count how many users have higher rating
    const position = await User.countDocuments({
      rating: { $gt: user.rating },
      paused: false,
      frozen: false
    }) + 1;

    const totalActive = await User.countDocuments({
      paused: false,
      frozen: false
    });

    res.json({
      user: {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        rating: user.rating
      },
      position,
      totalActive,
      change: user.ratingChangeLastWeek || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's recent matches
router.get('/recent-matches', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const matches = await Match.find({
      $or: [{ player1Id: userId }, { player2Id: userId }],
      status: 'completed'
    })
      .populate('player1Id', 'firstName lastName rating')
      .populate('player2Id', 'firstName lastName rating')
      .sort({ completedAt: -1 })
      .limit(10);

    res.json({ matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Notify user
    await sendEmailNotification(user.email, 'password_changed', {
      userName: `${user.firstName} ${user.lastName}`,
      note: 'Your password has been changed successfully.'
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: Generate initials-based avatar
function generateInitialsAvatar(firstName, lastName, gender) {
  const initials = (firstName[0] + lastName[0]).toUpperCase();
  const bgColor = gender === 'female' ? 'FFB6D9' : 'D3D3D3'; // Pink for female, gray for male
  
  // Return SVG data URL for initials avatar
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect width="200" height="200" fill="#${bgColor}"/>
      <text x="100" y="120" font-size="80" font-weight="bold" text-anchor="middle" fill="white">
        ${initials}
      </text>
    </svg>
  `;
  
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

module.exports = router;
