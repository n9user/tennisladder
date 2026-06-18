const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema({
  dispute_id: { type: String, unique: true, required: true },
  match_id: { type: String, required: true },
  raised_by_id: { type: String, required: true },
  
  explanation: String,
  
  status: {
    type: String,
    enum: ['open', 'under_review', 'resolved'],
    default: 'open'
  },
  
  // Submissions involved
  submission_ids: [String],
  
  // Admin resolution
  resolved_by_id: String,
  resolution_action: { type: String, enum: ['set_score', 'cancel', 'ask_more', 'apply_sanction'] },
  final_games_A: Number,
  final_games_B: Number,
  resolution_notes: String,
  
  created_at: { type: Date, default: Date.now },
  resolved_at: { type: Date, default: null },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Dispute', disputeSchema);
