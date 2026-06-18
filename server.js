const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();

// ===== MIDDLEWARE =====

// CORS Configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ===== DATABASE CONNECTION =====

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

connectDB();

// ===== AUTHENTICATION MIDDLEWARE =====

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

const authenticateAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

// Export middleware for use in routes
app.use((req, res, next) => {
  req.authenticateToken = authenticateToken;
  req.authenticateAdmin = authenticateAdmin;
  next();
});

// ===== ROUTES =====

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'API is running', timestamp: new Date() });
});

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const matchRoutes = require('./routes/matches');
const adminRoutes = require('./routes/admin');
const leaderboardRoutes = require('./routes/leaderboard');

// Register routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

// ===== SCHEDULED JOBS (CRON) =====

// Weekly update: Every Sunday at 22:00 (10 PM)
cron.schedule('0 22 * * 0', async () => {
  console.log('🔄 Starting weekly update job...');
  try {
    const { runWeeklyUpdates } = require('./services/BatchJobService');
    await runWeeklyUpdates();
    console.log('✅ Weekly update job completed');
  } catch (error) {
    console.error('❌ Weekly update job failed:', error.message);
  }
});

// Daily check: Handle frozen account auto-unfreeze
cron.schedule('0 0 * * *', async () => {
  console.log('🔄 Starting daily freeze check...');
  try {
    const User = require('./models/User');
    const { sendEmailNotification } = require('./services/EmailService');

    const frozenUsers = await User.find({
      frozen: true,
      freezeEndDate: { $lte: new Date() }
    });

    for (const user of frozenUsers) {
      user.frozen = false;
      user.freezeReason = null;
      user.freezeStartDate = null;
      user.freezeEndDate = null;
      user.cancellationCount = 0;
      await user.save();

      await sendEmailNotification(user.email, 'account_unfrozen', {
        userName: `${user.firstName} ${user.lastName}`,
        note: 'Your 3-week freeze period has ended. You are now eligible for match assignments again.'
      });
    }

    console.log(`✅ Processed ${frozenUsers.length} unfrozen accounts`);
  } catch (error) {
    console.error('❌ Daily freeze check failed:', error.message);
  }
});

// Weekly check: Update paused player rankings (drop by 1 position)
cron.schedule('0 1 * * 1', async () => {
  console.log('🔄 Starting weekly pause ranking update...');
  try {
    const User = require('./models/User');
    const pausedUsers = await User.find({ paused: true });

    for (const user of pausedUsers) {
      // Drop rating slightly (0.05 points per week)
      user.rating = Math.max(user.rating - 0.05, 4.0);
      await user.save();
    }

    console.log(`✅ Updated rankings for ${pausedUsers.length} paused players`);
  } catch (error) {
    console.error('❌ Weekly pause ranking update failed:', error.message);
  }
});

// Check for expired proposals (48-hour timeout)
cron.schedule('*/30 * * * *', async () => {
  try {
    const Match = require('./models/Match');
    const User = require('./models/User');
    const { sendEmailNotification } = require('./services/EmailService');

    const expiredProposals = await Match.find({
      status: 'proposal_pending',
      proposalTimeout: { $lte: new Date() }
    }).populate('player1Id').populate('player2Id');

    for (const match of expiredProposals) {
      // Auto-cancel and apply penalty to non-respondent
      const nonRespondent = match.proposedBy.equals(match.player1Id._id) ? match.player2Id : match.player1Id;
      
      match.status = 'cancelled';
      match.cancelledBy = nonRespondent.id;
      match.cancelledAt = new Date();
      match.autoExpired = true;
      await match.save();

      // Apply cancellation penalty
      const user = await User.findById(nonRespondent.id);
      user.cancellationCount = (user.cancellationCount || 0) + 1;
      user.rating = Math.min(user.rating + 0.1, 10.0);

      if (user.cancellationCount >= 3) {
        user.frozen = true;
        user.freezeStartDate = new Date();
        user.freezeEndDate = new Date(new Date().getTime() + 3 * 7 * 24 * 60 * 60 * 1000);
        user.cancellationCount = 0;

        await sendEmailNotification(user.email, 'account_frozen', {
          userName: `${user.firstName} ${user.lastName}`,
          freezeEndDate: user.freezeEndDate,
          reason: 'Three consecutive match cancellations (including non-response to proposals)'
        });
      }

      await user.save();

      // Notify both players
      await sendEmailNotification(match.player1Id.email, 'proposal_expired', {
        opponentName: `${match.player2Id.firstName} ${match.player2Id.lastName}`,
        note: 'Proposal expired after 48 hours without response. Match has been cancelled.'
      });

      await sendEmailNotification(match.player2Id.email, 'proposal_expired', {
        opponentName: `${match.player1Id.firstName} ${match.player1Id.lastName}`,
        note: 'Proposal expired after 48 hours without response. Match has been cancelled.'
      });
    }

    if (expiredProposals.length > 0) {
      console.log(`✅ Processed ${expiredProposals.length} expired proposals`);
    }
  } catch (error) {
    console.error('❌ Proposal expiry check failed:', error.message);
  }
});

// ===== ERROR HANDLING =====

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Global error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ===== START SERVER =====

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🎾 TENNIS LADDER SYSTEM API 🎾       ║
╠════════════════════════════════════════╣
║ Server running on port: ${PORT}              
║ Environment: ${process.env.NODE_ENV || 'development'}*
║ Database: Connected to MongoDB
║ Status: Ready to accept connections ✅
╚════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️  Shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

module.exports = app;
