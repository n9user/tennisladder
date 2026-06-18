const Match = require('../models/Match');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');

class MatchAssignment {
  /**
   * Get all active players (not paused, not frozen)
   */
  static async getActivePlayers() {
    try {
      const now = new Date();
      const players = await User.find({
        paused: false,
        $or: [
          { freeze_until: null },
          { freeze_until: { $lt: now } }
        ]
      });
      return players;
    } catch (error) {
      throw new Error(`Failed to get active players: ${error.message}`);
    }
  }

  /**
   * Calculate match compatibility score
   * Considers rating difference and playing frequency alignment
   */
  static calculateCompatibilityScore(player1, player2) {
    // Rating difference penalty (ideally close)
    const ratingDiff = Math.abs(player1.rating - player2.rating);
    const ratingScore = Math.max(0, 10 - ratingDiff); // Closer = higher score
    
    // Playing frequency alignment bonus
    const freqMatch = player1.playing_frequency === player2.playing_frequency ? 5 : 0;
    
    // Gender diversity bonus (optional, small bonus)
    const genderBonus = player1.gender !== player2.gender ? 1 : 0;
    
    const totalScore = ratingScore + freqMatch + genderBonus;
    
    return {
      score: totalScore,
      ratingDiff,
      freqMatch: freqMatch > 0,
      genderDiverse: genderBonus > 0
    };
  }

  /**
   * Check if two players already have an open match this week
   */
  static async hasExistingMatch(playerAId, playerBId, weekNumber) {
    try {
      const existing = await Match.findOne({
        week_of_season: weekNumber,
        status: { $in: ['open', 'negotiation', 'scheduled'] },
        $or: [
          { playerA_id: playerAId, playerB_id: playerBId },
          { playerA_id: playerBId, playerB_id: playerAId }
        ]
      });
      return !!existing;
    } catch (error) {
      throw new Error(`Failed to check existing match: ${error.message}`);
    }
  }

  /**
   * Assign matches for a specific week
   * Uses greedy algorithm with rating-based pairing
   */
  static async assignMatchesForWeek(weekNumber, currentWeekOfSeason) {
    try {
      // Get all active players
      const players = await this.getActivePlayers();
      
      if (players.length < 2) {
        return { success: false, error: 'Not enough active players for match assignment' };
      }

      const assignedMatches = [];
      const unpairedPlayers = [...players];
      const usedPlayerIds = new Set();

      // Sort players by rating (descending) for better pairing
      unpairedPlayers.sort((a, b) => b.rating - a.rating);

      // Greedy pairing algorithm
      for (let i = 0; i < unpairedPlayers.length; i++) {
        const player1 = unpairedPlayers[i];
        
        if (usedPlayerIds.has(player1.user_id)) continue;

        let bestMatch = null;
        let bestScore = -1;

        // Find best match for player1
        for (let j = i + 1; j < unpairedPlayers.length; j++) {
          const player2 = unpairedPlayers[j];
          
          if (usedPlayerIds.has(player2.user_id)) continue;

          // Check if they already have a match this week
          const hasExisting = await this.hasExistingMatch(player1.user_id, player2.user_id, weekNumber);
          if (hasExisting) continue;

          const compatibility = this.calculateCompatibilityScore(player1, player2);
          
          if (compatibility.score > bestScore) {
            bestScore = compatibility.score;
            bestMatch = { player: player2, compatibility };
          }
        }

        // If a good match found, create match
        if (bestMatch) {
          const matchId = uuidv4();
          const match = new Match({
            match_id: matchId,
            playerA_id: player1.user_id,
            playerB_id: bestMatch.player.user_id,
            status: 'open',
            week_of_season: weekNumber,
            playerA_rating_before: player1.rating,
            playerB_rating_before: bestMatch.player.rating,
            assigned_week: new Date(),
            expiration_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
          });

          await match.save();
          
          assignedMatches.push({
            match_id: matchId,
            playerA: { id: player1.user_id, name: player1.name, rating: player1.rating },
            playerB: { id: bestMatch.player.user_id, name: bestMatch.player.name, rating: bestMatch.player.rating },
            compatibility: bestMatch.compatibility
          });

          usedPlayerIds.add(player1.user_id);
          usedPlayerIds.add(bestMatch.player.user_id);
        }
      }

      return {
        success: true,
        week: weekNumber,
        matchesAssigned: assignedMatches.length,
        matches: assignedMatches,
        unpairedCount: players.length - (usedPlayerIds.size)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get matches for a specific player in a week
   */
  static async getPlayerMatchesForWeek(playerId, weekNumber) {
    try {
      const matches = await Match.find({
        week_of_season: weekNumber,
        $or: [
          { playerA_id: playerId },
          { playerB_id: playerId }
        ]
      }).populate('playerA_id').populate('playerB_id');

      return matches;
    } catch (error) {
      throw new Error(`Failed to get player matches: ${error.message}`);
    }
  }

  /**
   * Get open matches (awaiting scheduling)
   */
  static async getOpenMatches(limit = 50) {
    try {
      const matches = await Match.find({
        status: 'open'
      }).limit(limit).sort({ created_at: -1 });

      return matches;
    } catch (error) {
      throw new Error(`Failed to get open matches: ${error.message}`);
    }
  }

  /**
   * Check for expired matches and mark them
   */
  static async handleExpiredMatches() {
    try {
      const now = new Date();
      const expired = await Match.updateMany(
        {
          status: { $in: ['open', 'negotiation'] },
          expiration_date: { $lt: now }
        },
        { status: 'expired' }
      );

      return {
        success: true,
        expiredCount: expired.modifiedCount
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = MatchAssignment;
