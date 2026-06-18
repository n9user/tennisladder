const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  submission_id: { type: String, unique: true, required: true },
  match_id: { type: String, required: true },
  submitter_id: { type: String, required: true },
  
  games_playerA: { type: Number, required: true },
  games_playerB: { type: Number, required: true },
  
  resubmission_count: { type: Number, default: 0 },
  resubmission_count_remaining: { type: Number, default: 2 },
  
  expected_rating_delta_preview: Number,
  
  status: {
    type: String,
    enum: ['pending', 'accepted', 'disputed'],
    default: 'pending'
  },
  
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Submission', submissionSchema);
