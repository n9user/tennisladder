const mongoose = require('mongoose');

const seasonSchema = new mongoose.Schema({
  // Basic info
  name: {
    type: String,
    required: true,
    enum: ['Winter', 'Spring', 'Summer', 'Autumn'],
    index: true
  },

  year: {
    type: Number,
    required: true,
    index: true
  },

  // Season dates
  startDate: {
    type: Date,
    required: true,
    index: true
  },

  endDate: {
    type: Date,
    required: true,
    index: true
  },

  // Competition weeks (12 weeks per season)
  competitionWeeks: {
    type: Number,
    default: 12,
    immutable: true
  },

  // Break week(s) - stored separately
  breakWeek: {
    type: Date,
    required: true
  },

  breakWeekNumber: {
    type: Number,
    required: true // ISO week number (1-53)
  },

  // ISO week mapping for the season
  isoWeekStart: {
    type: Number,
    required: true // ISO week number when season starts
  },

  isoWeekEnd: {
    type: Number,
    required: true // ISO week number when season ends
  },

  // Participation and standings
  totalMatches: {
    type: Number,
    default: 0
  },

  activeParticipants: {
    type: Number,
    default: 0
  },

  // Season status
  status: {
    type: String,
    enum: ['not_started', 'active', 'ended'],
    default: 'not_started',
    index: true
  },

  // End-of-season report
  reportGenerated: {
    type: Boolean,
    default: false
  },

  reportGeneratedAt: {
    type: Date,
    sparse: true
  },

  // Podium data (stored for historical reference)
  podium: {
    general: [
      {
        position: Number,
        userId: mongoose.Schema.Types.ObjectId,
        firstName: String,
        lastName: String,
        rating: Number,
        membershipNumber: String
      }
    ],
    female: [
      {
        position: Number,
        userId: mongoose.Schema.Types.ObjectId,
        firstName: String,
        lastName: String,
        rating: Number,
        membershipNumber: String
      }
    ]
  },

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for querying active seasons
seasonSchema.index({ status: 1, startDate: 1, endDate: 1 });

// Index for historical queries
seasonSchema.index({ year: 1, name: 1 });

// Update timestamp before saving
seasonSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

/**
 * Static method: Create seasons for a given year
 * Handles complex calendar logic:
 * - 4 seasons x 12 weeks = 48 weeks
 * - 4 breaks x 1 week = 4 weeks
 * - Total = 52 weeks
 * - One break must cover Christmas (end of year)
 */
seasonSchema.statics.createSeasonsForYear = async function(year) {
  try {
    // Determine ISO week dates for the year
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);

    // ISO week 1 is the first week with Thursday in the year
    const firstThursday = new Date(jan1);
    firstThursday.setDate(firstThursday.getDate() + (4 - (firstThursday.getDay() || 7)));
    const isoWeekStart = getISOWeekNumber(firstThursday);*](#)

