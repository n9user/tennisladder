const RatingHistory = require('../models/RatingHistory');
const { v4: uuidv4 } = require('uuid');

class RatingCalculator {
  /**
   * Calculate ELO rating change based on match result
   * K-factor varies by rating level
   */
  static getKFactor(rating) {
    if (rating < 5.0) return 32;
    if (rating < 6.0) return 28;
    if (rating < 7.0) return 24;
    if (rating < 8.0) return 20;
    return 16;
  }

  /**
   * Calculate expected result (probability that player A wins)
   * Formula: E_A = 1 / (1 + 10^((R_B - R_A) / 400))
   */
  static calculateExpectedResult(ratingA, ratingB) {
    const diff = ratingB - ratingA;
    return 1 / (1 + Math.pow(10, diff / 400));
  }

  /**
   * Determine actual result based on games won
   * 1 = win, 0 = loss
   */
  static getActualResult(gamesPlayerA, gamesPlayerB) {
    return gamesPlayerA > gamesPlayerB ? 1 : 0;
  }

  /**
   * Apply equal games rule
   * If one player won by exactly 1 game in 2-game match, reduce rating change by 50%
   */
  static applyEqualGamesRule(gamesA, gamesB, ratingDelta) {
    const isEqualGamesScenario = (gamesA === 1 && gamesB === 2) || (gamesA === 2 && gamesB === 1);
    
    if (isEqualGamesScenario) {
      return {
        applied: true,
        delta: ratingDelta * 0.5
      };
    }
    
    return {
      applied: false,
      delta: ratingDelta
    };
  }

  /**
   * Main calculation: compute rating change for a player
   */
  static async calculateRatingChange(matchId, playerId, opponentId, gamesPlayer, gamesOpponent, playerRatingBefore, opponentRatingBefore) {
    try {
      // Get K-factor
      const kFactor = this.getKFactor(playerRatingBefore);
      
      // Calculate expected result
      const expectedResult = this.calculateExpectedResult(playerRatingBefore, opponentRatingBefore);
      
      // Get actual result
      const actualResult = this.getActualResult(gamesPlayer, gamesOpponent);
      
      // Base rating delta
      let ratingDelta = kFactor * (actualResult - expectedResult);
      
      // Apply equal games rule
      const equalGamesCheck = this.applyEqualGamesRule(gamesPlayer, gamesOpponent, ratingDelta);
      ratingDelta = equalGamesCheck.delta;
      
      // Round to nearest 0.1
      ratingDelta = Math.round(ratingDelta * 10) / 10;
      
      // Create rating history record
      const historyRecord = {
        history_id: uuidv4(),
        user_id: playerId,
        match_id: matchId,
        rating_before: playerRatingBefore,
        rating_after: playerRatingBefore + ratingDelta,
        rating_delta: ratingDelta,
        opponent_id: opponentId,
        opponent_rating: opponentRatingBefore,
        games_player: gamesPlayer,
        games_opponent: gamesOpponent,
        k_factor: kFactor,
        expected_result: parseFloat(expectedResult.toFixed(3)),
        actual_result: actualResult,
        equal_games_rule_applied: equalGamesCheck.applied,
        calculation_details: {
          formula: 'ELO with K-factor adjustment',
          expected: expectedResult,
          actual: actualResult,
          k: kFactor
        }
      };
      
      return {
        success: true,
        ratingDelta,
        newRating: playerRatingBefore + ratingDelta,
        historyRecord,
        equalGamesRuleApplied: equalGamesCheck.applied
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Apply rating changes to both players after match completion
   */
  static async applyRatingChanges(matchId, playerAId, playerBId, gamesA, gamesB, playerARating, playerBRating) {
    try {
      // Calculate changes
      const changeA = await this.calculateRatingChange(
        matchId, playerAId, playerBId, gamesA, gamesB, playerARating, playerBRating
      );
      
      const changeB = await this.calculateRatingChange(
        matchId, playerBId, playerAId, gamesB, gamesA, playerBRating, playerARating
      );
      
      if (!changeA.success || !changeB.success) {
        return { success: false, error: 'Rating calculation failed' };
      }
      
      // Save rating history records
      await RatingHistory.create(changeA.historyRecord);
      await RatingHistory.create(changeB.historyRecord);
      
      return {
        success: true,
        playerA: {
          newRating: changeA.newRating,
          delta: changeA.ratingDelta
        },
        playerB: {
          newRating: changeB.newRating,
          delta: changeB.ratingDelta
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = RatingCalculator;
