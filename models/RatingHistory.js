const mongoose = require('mongoose');

const ratingHistorySchema = new mongoose.Schema({
  history_id: { type: String, unique: true, required: true },
  user_id: { type: String, required: true },
  match_id: String,
  
  rating_before: Number,
  rating_after: Number,
  rating_delta: Number,
  
  opponent_id: String,
  opponent_rating: Number,
  
  games_player: Number,
  games_opponent: Number,
  
  k_factor: Number,
  expected_result: Number,
  actual_result: Number,
  
  // Special rules applied
  equal_games_rule_applied: { type: Boolean, default: false },
  cancellation_penalty_applied: { type: Boolean, default: false },
  
  calculation_details: mongoose.Schema.Types.Mixed,
  
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RatingHistory', ratingHistorySchema);
