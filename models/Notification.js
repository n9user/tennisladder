const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // User receiving notification
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Notification type
  type: {
    type: String,
    required: true,
    enum: [
      // Match-related
      'match_assigned',
      'match_proposal',
      'proposal_accepted',
      'proposal_counter',
      'proposal_expired',
      'match_cancelled',
      'match_expired',

      // Score-related
      'score_submitted',
      'score_agreed',
      'dispute_escalated',
      'dispute_resolved',

      // Account-related
      'account_frozen',
      'account_unfrozen',
      'account_flagged',
      'account_unflagged',
      'participation_paused',
      'participation_resumed',
      'password_changed',
      'password_reset_request',

      // Season-related
      'season_started',
      'season_end_reminder',
      'season_ended',
      'season_end_report',

      // Admin-related
      'admin_message',
      'weekly_job_completed',
      'weekly_job_failed',

      // System
      'system_maintenance',
      'terms_updated'
    ],
    index: true
  },

  // Notification title and message
  title: {
    type: String,
    required: true
  },

  message: {
    type: String,
    required: true
  },

  // Optional: rich data for notification
  data: {
    matchId: mongoose.Schema.Types.ObjectId,
    opponentName: String,
    proposedDate: Date,
    proposedTime: String,
    courtNumber: Number,
    score: String,
    seasonName: String,
    freezeEndDate: Date,
    reason: String
  },

  // Related resource (match, season, dispute, etc)
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    sparse: true,
    index: true
  },

  // Notification status
  read: {
    type: Boolean,
    default: false,
    index: true
  },

  readAt: {
    type: Date,
    sparse: true
  },

  // Action URL (for frontend routing)
  actionUrl: {
    type: String,
    sparse: true
  },

  // Urgency level
  urgency: {
    type: String,
    enum: ['low', 'normal', 'high', 'critical'],
    default: 'normal'
  },

  // Email sent flag
  emailSent: {
    type: Boolean,
    default: false
  },

  emailSentAt: {
    type: Date,
    sparse: true
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  expiresAt: {
    type: Date,
    sparse: true, // Auto-delete old notifications
    index: { expireAfterSeconds: 2592000 } // 30 days
  }
});

// Compound index for efficient querying
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

// Update timestamp on save
notificationSchema.pre('save', function(next) {
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  }
  next();
});

/**
 * Instance method: Mark as read
 */
notificationSchema.methods.markAsRead = async function() {
  this.read = true;
  this.readAt = new Date();
  return await this.save();
};

/**
 * Instance method: Mark as unread
 */
notificationSchema.methods.markAsUnread = async function() {
  this.read = false;
  this.readAt = null;
  return await this.save();
};

/**
 * Static method: Create notification for user
 */
notificationSchema.statics.createNotification = async function(
  userId,
  type,
  title,
  message,
  options = {}
) {
  try {
    const notification = new this({
      userId,
      type,
      title,
      message,
      data: options.data || {},
      relatedId: options.relatedId,
      actionUrl: options.actionUrl,
      urgency: options.urgency || 'normal',
      emailSent: options.emailSent || false
    });

    await notification.save();
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

/**
 * Static method: Get user's unread notifications
 */
notificationSchema.statics.getUnreadNotifications = async function(userId, limit = 20) {
  return await this.find({ userId, read: false })
    .sort({ createdAt: -1 })
    .limit(limit);
};

/**
 * Static method: Get user's all notifications
 */
notificationSchema.statics.getUserNotifications = async function(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const notifications = await this.find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await this.countDocuments({ userId });

  return {
    notifications,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * Static method: Mark all notifications as read
 */
notificationSchema.statics.markAllAsRead = async function(userId) {
  return await this.updateMany(
    { userId, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
};

/**
 * Static method: Delete old notifications (30+ days)
 */
notificationSchema.statics.deleteOldNotifications = async function(daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const result = await this.deleteMany({ createdAt: { $lt: cutoffDate } });
  return result.deletedCount;
};

/**
 * Static method: Get notification statistics for user
 */
notificationSchema.statics.getNotificationStats = async function(userId) {
  const unreadCount = await this.countDocuments({ userId, read: false });
  const totalCount = await this.countDocuments({ userId });

  const typeBreakdown = await this.aggregate([
    { $match: { userId } },
    { $group: { _id: '$type', count: { $sum: 1 } } }
  ]);

  return {
    unreadCount,
    totalCount,
    readCount: totalCount - unreadCount,
    typeBreakdown
  };
};

/**
 * Static method: Get notifications by type
 */
notificationSchema.statics.getNotificationsByType = async function(userId, type, limit = 20) {
  return await this.find({ userId, type })
    .sort({ createdAt: -1 })
    .limit(limit);
};

/**
 * Static method: Bulk create notifications
 * For sending same notification to multiple users
 */
notificationSchema.statics.createBulkNotifications = async function(
  userIds,
  type,
  title,
  message,
  options = {}
) {
  try {
    const notifications = userIds.map(userId => ({
      userId,
      type,
      title,
      message,
      data: options.data || {},
      relatedId: options.relatedId,
      actionUrl: options.actionUrl,
      urgency: options.urgency || 'normal',
      emailSent: options.emailSent || false,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }));

    return await this.insertMany(notifications);
  } catch (error) {
    console.error('Error creating bulk notifications:', error);
    throw error;
  }
};

/**
 * Instance method: Get formatted notification for display
 */
notificationSchema.methods.getFormattedNotification = function() {
  const icons = {
    match_assigned: '🎾',
    match_proposal: '📋',
    proposal_accepted: '✅',
    proposal_counter: '↩️',
    proposal_expired: '⏰',
    match_cancelled: '❌',
    score_submitted: '📊',
    score_agreed: '🤝',
    dispute_escalated: '⚠️',
    dispute_resolved: '✔️',
    account_frozen: '❄️',
    account_unfrozen: '🔓',
    account_flagged: '🚩',
    participation_paused: '⏸️',
    participation_resumed: '▶️',
    season_end_report: '🏆',
    admin_message: '📧'
  };

  return {
    id: this._id,
    type: this.type,
    title: this.title,
    message: this.message,
    icon: icons[this.type] || '📢',
    read: this.read,
    urgency: this.urgency,
    actionUrl: this.actionUrl,
    relatedData: this.data,
    createdAt: this.createdAt,
    readAt: this.readAt,
    timeAgo: getTimeAgo(this.createdAt)
  };
};

/**
 * Helper: Calculate time ago string
 */
function getTimeAgo(date) {
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

module.exports = mongoose.model('Notification', notificationSchema);
