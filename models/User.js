const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  user_id: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  surname: { type: String, required: true },
  membership_number: { type: String, unique: true, required: true },
  rating: { type: Number, default: 4.0, min: 3.0, max: 10.0 },
  gender: { type: String, enum: ['male', 'female'], required: true },
  playing_frequency: { type: String, enum: ['1_week', '2_weeks', '3_weeks'], required: true },
  
  // Profile fields
  phone: { type: String, default: null },
  bio: { type: String, default: null },
  hide_phone: { type: Boolean, default: false },
  hide_bio: { type: Boolean, default: false },
  opt_out_leaderboard: { type: Boolean, default: false },
  
  // Avatar
  avatar: {
    type: { type: String, enum: ['uploaded', 'initials'], default: 'initials' },
    initials: String,
    background_color: String,
    url: { type: String, default: null }
  },
  
  // Account status
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  paused: { type: Boolean, default: false },
  freeze_until: { type: Date, default: null },
  consecutive_cancels: { type: Number, default: 0 },
  eligible_for_podium: { type: Boolean, default: true },
  
  // Registration timestamp (for podium eligibility check)
  registered_at: { type: Date, default: Date.now },
  
  // Timestamps
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
