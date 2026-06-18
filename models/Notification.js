const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  notification_id: { type: String, unique: true, required: true },
  recipient_id: { type: String, required: true },
  
  type: {
    type: String,
    enum: [
      'proposal',
      'proposal_accepted',
      'proposal_countered',
      'score_submitted',
      'dispute_escalated',
      'dispute_resolved',
      'match_cancelled',
      'account_frozen',
      'account_unfrozen',
      'season_report',
      'admin_action',
      'match_expired'
    ],
    required: true
  },
  
  title: String,
  message: String,
  match_id: String,
  dispute_id: String,
  
  seen: { type: Boolean, default: false },
  seen_at: { type: Date, default: null },
  
  email_sent: { type: Boolean, default: false },
  email_sent_at: { type: Date, default: null },
  email_error: String,
  
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);
