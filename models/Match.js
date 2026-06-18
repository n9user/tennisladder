const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  match_id: { type: String, unique: true, required: true },
  playerA_id: { type: String, required: true },
  playerB_id: { type: String, required: true },
  
  status: {
    type: String,
    enum: ['open', 'negotiation', 'scheduled', 'expired', 'played', 'cancelled'],
    default: 'open'
  },
  
  // Proposal/Scheduling
  proposals: [{
    proposal_id: String,
    proposer_id: String,
    proposed_date: Date,
    proposed_start_time: String,
    court_number: Number,
    proposal_deadline: Date,
    created_at: { type: Date, default: Date.now }
  }],
  
  scheduled_datetime: { type: Date, default: null },
  court_number: { type: Number, min: 1, max: 3 },
  
  // Rating info
  playerA_rating_before: Number,
  playerB_rating_before: Number,
  
  // Match info
  week_of_season: Number,
  assigned_week: { type: Date, default: Date.now },
  expiration_date: Date,
  
  // Timestamps
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Match', matchSchema);
