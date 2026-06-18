const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Match = require('../models/Match');
const Season = require('../models/Season');
const { authenticateToken } = require('../middleware/auth');

// Get global leaderboard (all-time rankings)
router.get('/global', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const skip = (page - 1) * limit;

    const players = await User.find({
      paused: false,
      frozen: false
    })
      .select('firstName lastName rating sportClubMembershipNumber profilePicture gender')
      .sort({ rating: -1 })
      .skip(skip)
      .limit(limit);

    const totalPlayers = await User.countDocuments({
      paused: false,
      frozen: false
    });

    // Add position to each player
    const leaderboard = players.map((player, index) => ({
      position: skip + index + 1,
      id: player.id,
      firstName: player.firstName,
      lastName: player.lastName,
      rating: player.rating,
      profilePicture: player.profilePicture,
      gender: player.gender
    }));

    res.json({
      leaderboard,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalPlayers / limit),
        totalPlayers,
        limit
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get seasonal leaderboard (participation-based)
router.get('/seasonal/:seasonId', async (req, res) => {
  try {
    const { seasonId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const skip = (page - 1) * limit;

    const season = await Season.findById(seasonId);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    // Get all matches in this season
    const startDate = season.startDate;
    const endDate = season.endDate;

    const seasonMatches = await Match.find({
      createdAt: { $gte: startDate, $lte: endDate },
      status: 'completed'
    });

    // Calculate participation metrics for each player
    const participationMap = {};

    for (const match of seasonMatches) {
      [match.player1Id, match.player2Id].forEach(playerId => {
        if (!participationMap[playerId]) {
          participationMap[playerId] = {
            matchesPlayed: 0,
            matchesWon: 0,
            cancellations: 0,
            streaks: 0,
            completionRate: 0
          };
        }

        const stats = participationMap[playerId];
        stats.matchesPlayed += 1;

        // Check if player won
        const isPlayer1 = match.player1Id.equals(playerId);
        const playerGames = isPlayer1 ? match.finalScore.player1Games : match.finalScore.player2Games;
        const opponentGames = isPlayer1 ? match.finalScore.player2Games : match.finalScore.player1Games;

        if (playerGames > opponentGames) {
          stats.matchesWon += 1;
        }
      });
    }

    // Get users and add participation stats
    const userIds = Object.keys(participationMap);
    const users = await User.find({ _id: { $in: userIds } })
      .select('firstName lastName rating profilePicture sportClubMembershipNumber gender pa_*

