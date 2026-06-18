const User = require('../models/User');
const Match = require('../models/Match');
const Season = require('../models/Season');
const RatingHistory = require('../models/RatingHistory');
const Notification = require('../models/Notification');
const { sendEmailNotification } = require('./EmailService');
const { assignMatches } = require('./MatchAssignmentService');
const { calculateRatingChange } = require('./RatingCalculator');
const SVGtoPNG = require('convert-svg-to-png');

/**
 * Main weekly update job - runs every Sunday at 22:00
 * Tasks:
 * 1. Finalize any incomplete matches
 * 2. Update ratings for all completed matches
 * 3. Calculate rankings
 * 4. Assign new matches to eligible players
 * 5. Check for season end and generate reports
 */
async function runWeeklyUpdates() {
  console.log('📊 Starting weekly update cycle...');
  const startTime = Date.now();

  try {
    // Step 1: Process expired matches
    console.log('⏱️  Processing expired matches...');
    await processExpiredMatches();

    // Step 2: Update ratings for completed matches
    console.log('📈 Updating player ratings...');
    await updatePlayerRatings();

    // Step 3: Calculate and update rankings
    console.log('🏆 Calculating rankings...');
    await updateRankings();

    // Step 4: Assign new matches
    console.log('🎾 Assigning new matches...');
    await assignMatches();

    // Step 5: Check for season end
    console.log('🔍 Checking for season end...');
    await checkSeasonEnd();

    // Step 6: Check for frozen account expirations
    console.log('🔓 Checking frozen accounts...');
    await processFrozenAccountExpirations();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Weekly update completed in ${duration}s`);

    // Send admin notification
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await sendEmailNotification(admin.email, 'weekly_job_completed', {
        adminName: `${admin.firstName} ${admin.lastName}`,
        completedAt: new Date(),
        duration: `${duration}s`
      });
    }
  } catch (error) {
    console.error('❌ Weekly update failed:', error);
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await sendEmailNotification(admin.email, 'weekly_job_failed', {
        adminName: `${admin.firstName} ${admin.lastName}`,
        error: error.message,
        timestamp: new Date()
      });
    }
    throw error;
  }
}

/**
 * Process matches that expired without being played
 */
async function processExpiredMatches() {
  try {
    const now = new Date();

    // Find all assigned matches past their expiration date
    const expiredMatches = await Match.find({
      status: 'assigned',
      createdAt: { $lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } // 30 days old
    }).populate('player1Id').populate('player2Id');

    for (const match of expiredMatches) {
      match.status = 'expired';
      match.expiredAt = new Date();
      await match.save();

      // Notify both players
      await sendEmailNotification(match.player1Id.email, 'match_expired', {
        opponentName: `${match.player2Id.firstName} ${match.player2Id.lastName}`,
        note: 'This match assignment has expired and was not completed.'
      });

      await sendEmailNotification(match.player2Id.email, 'match_expired', {
        opponentName: `${match.player1Id.firstName} ${match.player1Id.lastName}`,
        note: 'This match assignment has expired and was not completed.'
      });
    }

    console.log(`  ✓ Processed ${expiredMatches.length} expired matches`);
  } catch (error) {
    console.error('  ✗ Error processing expired matches:', error);
  }
}

/**
 * Update player ratings based on completed matches
 */
async function updatePlayerRatings() {
  try {
    const now = new Date();
    const lastWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Find matches completed in the last week that haven't been rated yet
    const completedMatches = await Match.find({
      status: 'completed',
      completedAt: { $gte: lastWeekStart },
      ratingApplied: { $ne: true }
    }).populate('player1Id').populate('player2Id');

    let ratingsUpdated = 0;

    for (const match of completedMatches) {
      // Skip if already processed
      if (match.ratingApplied) continue;

      const player1 = match.player1Id;
      const player2 = match.player2Id;

      const { ratingChange1, ratingChange2, expectedScore1 } = calculateRatingChange(
        player1.rating,
        player2.rating,
        match.finalScore.player1Games,
        match.finalScore.player2Games
      );

      const preRating1 = player1.rating;
      const preRating2 = player2.rating;

      // Apply rating changes (hard floor 4.0)
      player1.rating = Math.max(player1.rating + ratingChange1, 4.0);
      player2.rating = Math.max(player2.rating + ratingChange2, 4.0);

      player1.ratingChangeLastWeek = ratingChange1;
      player2.ratingChangeLastWeek = ratingChange2;

      await player1.save();
      await player2.save();

      // Log rating history
      await RatingHistory.create({
        userId: player1.id,
        matchId: match.id,
        preRating: preRating1,
        postRating: player1.rating,
        ratingChange: ratingChange1,
        expectedOutcome: expectedScore1,
        opponent: player2.id,
        createdAt: new Date()
      });

      await RatingHistory.create({
        userId: player2.id,
        matchId: match.id,
        preRating: preRating2,
        postRating: player2.rating,
        ratingChange: ratingChange2,
        expectedOutcome: 1 - expectedScore1,
        opponent: player1.id,
        createdAt: new Date()
      });

      // Mark match as rated
      match.ratingApplied = true;
      await match.save();

      ratingsUpdated++;
    }

    console.log(`  ✓ Updated ratings for ${ratingsUpdated} matches`);
  } catch (error) {
    console.error('  ✗ Error updating player ratings:', error);
  }
}

/**
 * Update player rankings based on current ratings
 */
async function updateRankings() {
  try {
    const allPlayers = await User.find({ paused: false, frozen: false })
      .sort({ rating: -1 });

    let rank = 1;
    for (const player of allPlayers) {
      player.currentRank = rank;
      player.lastRankUpdateAt = new Date();
      await player.save();
      rank++;
    }

    console.log(`  ✓ Updated rankings for ${allPlayers.length} active players`);
  } catch (error) {
    console.error('  ✗ Error updating rankings:', error);
  }
}

/**
 * Process frozen account expirations (3-week freeze)
 */
async function processFrozenAccountExpirations() {
  try {
    const frozenUsers = await User.find({
      frozen: true,
      freezeEndDate: { $lte: new Date() }
    });

    for (const user of frozenUsers) {
      user.frozen = false;
      user.freezeReason = null;
      user.freezeStartDate = null;
      user.freezeEndDate = null;
      user.cancellationCount = 0;
      await user.save();

      await sendEmailNotification(user.email, 'account_unfrozen', {
        userName: `${user.firstName} ${user.lastName}`,
        note: 'Your 3-week freeze period has ended. You are now eligible for match assignments again. Please remember to play fairly and respect your opponents.'
      });
    }

    console.log(`  ✓ Unfroze ${frozenUsers.length} accounts`);
  } catch (error) {
    console.error('  ✗ Error processing frozen account expirations:', error);
  }
}

/**
 * Check for season end and generate end-of-season reports
 */
async function checkSeasonEnd() {
  try {
    const now = new Date();
    const endedSeasons = await Season.find({
      endDate: { $lte: now },
      reportGenerated: { $ne: true }
    });

    for (const season of endedSeasons) {
      console.log(`  📋 Generating end-of-season report for: ${season.name}`);
      await generateSeasonReport(season);

      season.reportGenerated = true;
      await season.save();
    }

    console.log(`  ✓ Generated ${endedSeasons.length} season reports`);
  } catch (error) {
    console.error('  ✗ Error checking season end:', error);
  }
}

/**
 * Generate comprehensive end-of-season report
 */
async function generateSeasonReport(season) {
  try {
    const startDate = season.startDate;
    const endDate = season.endDate;
    const lastTwoWeeksStart = new Date(endDate.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Get top 3 overall (excluding late registrations)
    const topOverall = await User.find({
      registeredAt: { $lt: lastTwoWeeksStart },
      paused: false,
      frozen: false
    })
      .select('firstName lastName rating profilePicture sportClubMembershipNumber')
      .sort({ rating: -1 })
      .limit(3);

    // Get top 3 female (excluding late registrations)
    const topFemale = await User.find({
      gender: 'female',
      registeredAt: { $lt: lastTwoWeeksStart },
      paused: false,
      frozen: false
    })
      .select('firstName lastName rating profilePicture sportClubMembershipNumber')
      .sort({ rating: -1 })
      .limit(3);

    // Generate podium images
    console.log('  🖼️  Generating podium images...');
    const generalPodiumImage = await generatePodiumImage(topOverall, 'General');
    const femalePodiumImage = await generatePodiumImage(topFemale, 'Female');

    // Get all active players for full ranking
    const allPlayers = await User.find({
      registeredAt: { $lt: lastTwoWeeksStart },
      paused: false,
      frozen: false
    })
      .select('firstName lastName rating')
      .sort({ rating: -1 });

    // Send season-end emails to all eligible players
    for (const player of allPlayers) {
      const playerRank = allPlayers.findIndex(p => p.id.equals(player.id)) + 1;

      await sendEmailNotification(player.email, 'season_end_report', {
        playerName: `${player.firstName} ${player.lastName}`,
        seasonName: season.name,
        seasonEndDate: endDate,
        finalRating: player.rating,
        finalRank: playerRank,
        totalPlayers: allPlayers.length,
        generalPodiumImage,
        femalePodiumImage,
        reportLink: `${process.env.FRONTEND_URL}/season-report/${season.id}`
      });
    }

    console.log(`  ✓ Sent season-end emails to ${allPlayers.length} players`);

    // Create notification for admins
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await Notification.create({
        userId: admin.id,
        type: 'season_ended',
        title: `Season Ended: ${season.name}`,
        message: `Season report generated. Top 3 podiums created.`,
        relatedId: season.id,
        createdAt: new Date()
      });
    }
  } catch (error) {
    console.error('  ✗ Error generating season report:', error);
  }
}

/**
 * Generate SVG podium image and convert to PNG
 */
async function generatePodiumImage(topPlayers, category) {
  try {
    // Create SVG with top 3 players
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
        <!-- Background -->
        <rect width="1200" height="600" fill="#f0f0f0"/>
        
        <!-- Title -->
        <text x="600" y="50" font-size="48" font-weight="bold" text-anchor="middle" fill="#333">
          🏆 ${category} Podium 🏆
        </text>
        
        <!-- 2nd Place (Left) -->
        ${topPlayers.length > 1 ? `
          <g>
            <!-- Podium 2nd -->
            <rect x="100" y="350" width="300" height="150" fill="#c0c0c0" stroke="#999" stroke-width="2"/>
            <text x="250" y="400" font-size="24" font-weight="bold" text-anchor="middle" fill="white">2nd Place</text>
            <text x="250" y="450" font-size="20" text-anchor="middle" fill="white">
              ${topPlayers[1].firstName} ${topPlayers[1].lastName}
            </text>
            <text x="250" y="480" font-size="18" text-anchor="middle" fill="white">
              Rating: ${topPlayers[1].rating}
            </text>
          </g>
        ` : ''}
        
        <!-- 1st Place (Center) -->
        ${topPlayers.length > 0 ? `
          <g>
            <!-- Gold star -->
            <text x="600" y="120" font-size="80" text-anchor="middle">⭐</text>
            <!-- Podium 1st -->
            <rect x="450" y="250" width="300" height="250" fill="#ffd700" stroke="#daa520" stroke-width="2"/>
            <text x="600" y="320" font-size="32" font-weight="bold" text-anchor="middle" fill="#333">1st Place</text>
            <text x="600" y="380" font-size="24" text-anchor="middle" fill="#333">
              ${topPlayers[0].firstName} ${topPlayers[0].lastName}
            </text>
            <text x="600" y="420" font-size="22" text-anchor="middle" fill="#333">
              Rating: ${topPlayers[0].rating}
            </text>
            <text x="600" y="460" font-size="16" text-anchor="middle" fill="#333">
              Member #${topPlayers[0].sportClubMembershipNumber}
            </text>
          </g>
        ` : ''}
        
        <!-- 3rd Place (Right) -->
        ${topPlayers.length > 2 ? `
          <g>
            <!-- Podium 3rd -->
            <rect x="800" y="400" width="300" height="100" fill="#cd7f32" stroke="#996633" stroke-width="2"/>
            <text x="950" y="440" font-size="20" font-weight="bold" text-anchor="middle" fill="white">3rd Place</text>
            <text x="950" y="475" font-size="18" text-anchor="middle" fill="white">
              ${topPlayers[2].firstName} ${topPlayers[2].lastName}
            </text>
            <text x="950" y="500" font-size="16" text-anchor="middle" fill="white">
              Rating: ${topPlayers[2].rating}
            </text>
          </g>
        ` : ''}
      </svg>
    `;

    // Convert SVG to PNG (in production, use sharp or similar library)
    // For now, return base64 encoded SVG
    const base64SVG = Buffer.from(svgContent).toString('base64');
    return `data:image/svg+xml;base64,${base64SVG}`;
  } catch (error) {
    console.error('Error generating podium image:', error);
    return null;
  }
}

module.exports = {
  runWeeklyUpdates,
  processExpiredMatches,
  updatePlayerRatings,
  updateRankings,
  processFrozenAccountExpirations,
  checkSeasonEnd,
  generateSeasonReport,
  generatePodiumImage
};
