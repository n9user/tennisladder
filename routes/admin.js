const express = require('express');
const router = express.Router();
const Match = require('../models/Match');
const Dispute = require('../models/Dispute');
const User = require('../models/User');
const RatingHistory = require('../models/RatingHistory');
const Submission = require('../models/Submission');
const { sendEmailNotification } = require('../services/EmailService');
const { calculateRatingChange } = require('../services/RatingCalculator');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');

// Get all pending disputes
router.get('/disputes', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const disputes = await Dispute.find({ status: { $in: ['escalated_to_admin', 'pending_admin_review'] } })
      .populate('matchId')
      .sort({ createdAt: -1 });

    res.json({ disputes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dispute details
router.get('/disputes/:disputeId', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { disputeId } = req.params;
    const dispute = await Dispute.findById(disputeId)
      .populate({
        path: 'matchId',
        populate: [
          { path: 'player1Id', select: 'firstName lastName email rating' },
          { path: 'player2Id', select: 'firstName lastName email rating' }
        ]
      });

    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

    const submissions = await Submission.find({ matchId: dispute.matchId });

    res.json({ dispute, submissions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin decides to accept one submission
router.post('/disputes/:disputeId/accept-submission', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { submissionId } = req.body;

    const dispute = await Dispute.findById(disputeId);
    const submission = await Submission.findById(submissionId);
    const match = await Match.findById(dispute.matchId);

    if (!dispute || !submission || !match) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Set final score from accepted submission
    match.finalScore = {
      player1Games: submission.player1Games,
      player2Games: submission.player2Games
    };
    match.status = 'completed';
    match.completedAt = new Date();
    match.adminMediation = true;
    match.adminDecision = `Admin accepted submission from ${submission.submittedBy}`;

    await match.save();

    // Update ratings
    await updateMatchRatings(match);

    // Close dispute
    dispute.status = 'resolved';
    dispute.resolvedBy = req.user.id;
    dispute.resolution = 'admin_accepted_submission';
    dispute.resolvedAt = new Date();

    await dispute.save();

    // Notify both players
    const player1 = await User.findById(match.player1Id);
    const player2 = await User.findById(match.player2Id);

    await sendEmailNotification(player1.email, 'dispute_resolved', {
      matchId: match.id,
      resolution: 'Admin accepted one player\'s score submission',
      finalScore: `${match.finalScore.player1Games}-${match.finalScore.player2Games}`
    });

    await sendEmailNotification(player2.email, 'dispute_resolved', {
      matchId: match.id,
      resolution: 'Admin accepted one player\'s score submission',
      finalScore: `${match.finalScore.player1Games}-${match.finalScore.player2Games}`
    });

    res.json({ message: 'Dispute resolved', dispute, match });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin sets custom final score
router.post('/disputes/:disputeId/set-final-score', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { player1Games, player2Games } = req.body;

    const dispute = await Dispute.findById(disputeId);
    const match = await Match.findById(dispute.matchId);

    if (!dispute || !match) return res.status(404).json({ error: 'Not found' });

    match.finalScore = { player1Games, player2Games };
    match.status = 'completed';
    match.completedAt = new Date();
    match.adminMediation = true;
    match.adminDecision = `Admin set custom final score: ${player1Games}-${player2Games}`;

    await match.save();

    // Update ratings
    await updateMatchRatings(match);

    // Close dispute
    dispute.status = 'resolved';
    dispute.resolvedBy = req.user.id;
    dispute.resolution = 'admin_set_custom_score';
    dispute.resolvedAt = new Date();

    await dispute.save();

    // Notify both players
    const player1 = await User.findById(match.player1Id);
    const player2 = await User.findById(match.player2Id);

    await sendEmailNotification(player1.email, 'dispute_resolved', {
      matchId: match.id,
      resolution: `Admin set final score to ${player1Games}-${player2Games}`,
      adminNote: match.adminDecision
    });

    await sendEmailNotification(player2.email, 'dispute_resolved', {
      matchId: match.id,
      resolution: `Admin set final score to ${player1Games}-${player2Games}`,
      adminNote: match.adminDecision
    });

    res.json({ message: 'Final score set', dispute, match });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin cancels match (no rating change)
router.post('/disputes/:disputeId/cancel-match', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { disputeId } = req.params;

    const dispute = await Dispute.findById(disputeId);
    const match = await Match.findById(dispute.matchId);

    if (!dispute || !match) return res.status(404).json({ error: 'Not found' });

    match.status = 'cancelled';
    match.cancelledAt = new Date();
    match.adminMediation = true;
    match.adminDecision = 'Admin cancelled match due to dispute - no rating change';

    await match.save();

    // Close dispute WITHOUT rating update
    dispute.status = 'resolved';
    dispute.resolvedBy = req.user.id;
    dispute.resolution = 'admin_cancelled_match';
    dispute.resolvedAt = new Date();

    await dispute.save();

    // Notify both players
    const player1 = await User.findById(match.player1Id);
    const player2 = await User.findById(match.player2Id);

    await sendEmailNotification(player1.email, 'dispute_resolved', {
      matchId: match.id,
      resolution: 'Admin cancelled the match - no rating changes applied'
    });

    await sendEmailNotification(player2.email, 'dispute_resolved', {
      matchId: match.id,
      resolution: 'Admin cancelled the match - no rating changes applied'
    });

    res.json({ message: 'Match cancelled by admin', dispute, match });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Flag user for inappropriate behaviour
router.post('/users/:userId/flag', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.flagged = true;
    user.flaggedReason = reason;
    user.flaggedAt = new Date();
    user.flaggedBy = req.user.id;

    await user.save();

    // Notify user
    await sendEmailNotification(user.email, 'account_flagged', {
      userName: `${user.firstName} ${user.lastName}`,
      reason,
      note: 'You have been flagged for the upcoming match assignment round. Contact admin if you have questions.'
    });

    res.json({ message: 'User flagged', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unflag user
router.post('/users/:userId/unflag', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.flagged = false;
    user.flaggedReason = null;
    user.flaggedAt = null;
    user.flaggedBy = null;

    await user.save();

    // Notify user
    await sendEmailNotification(user.email, 'account_unflagged', {
      userName: `${user.firstName} ${user.lastName}`,
      note: 'Your account has been cleared and you are eligible for match assignments again.'
    });

    res.json({ message: 'User unflagged', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Freeze account manually
router.post('/users/:userId/freeze', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.frozen = true;
    user.freezeReason = reason;
    user.freezeStartDate = new Date();
    user.freezeEndDate = new Date(new Date().getTime() + 3 * 7 * 24 * 60 * 60 * 1000); // 3 weeks
    user.frozenBy = req.user.id;

    await user.save();

    // Notify user
    await sendEmailNotification(user.email, 'account_frozen', {
      userName: `${user.firstName} ${user.lastName}`,
      reason,
      freezeEndDate: user.freezeEndDate,
      note: 'Your account is frozen for 3 weeks. During this period, each week counts as 1 cancelled match for rating purposes.'
    });

    res.json({ message: 'User account frozen', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unfreeze account manually
router.post('/users/:userId/unfreeze', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.frozen = false;
    user.freezeReason = null;
    user.freezeStartDate = null;
    user.freezeEndDate = null;
    user.frozenBy = null;
    user.cancellationCount = 0;

    await user.save();

    // Notify user
    await sendEmailNotification(user.email, 'account_unfrozen', {
      userName: `${user.firstName} ${user.lastName}`,
      note: 'Your account has been unfrozen and you are eligible for match assignments again.'
    });

    res.json({ message: 'User account unfrozen', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user flags and suspension history
router.get('/users/:userId/moderation-history', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('+flagged +flaggedReason +flaggedAt +frozen +freezeReason +freezeStartDate +freezeEndDate +cancellationCount');

    if (!user) return res.status(404).json({ error: 'User not found' });

    const disputes = await Dispute.find({ $or: [{ 'submissions.submittedBy': userId }] }).populate('matchId');
    const ratingHistory = await RatingHistory.find({ userId }).sort({ createdAt: -1 }).limit(20);

    res.json({
      user: {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        flagged: user.flagged,
        flaggedReason: user.flaggedReason,
        flaggedAt: user.flaggedAt,
        frozen: user.frozen,
        freezeReason: user.freezeReason,
        freezeEndDate: user.freezeEndDate,
        cancellationCount: user.cancellationCount
      },
      recentDisputes: disputes.length,
      ratingHistory
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: Update match ratings
async function updateMatchRatings(match) {
  const player1 = await User.findById(match.player1Id);
  const player2 = await User.findById(match.player2Id);

  const { ratingChange1, ratingChange2, expectedScore1 } = calculateRatingChange(
    player1.rating,
    player2.rating,
    match.finalScore.player1Games,
    match.finalScore.player2Games
  );

  const preRating1 = player1.rating;
  const preRating2 = player2.rating;

  player1.rating = Math.max(player1.rating + ratingChange1, 4.0);
  player2.rating = Math.max(player2.rating + ratingChange2, 4.0);

  await player1.save();
  await player2.save();

  await RatingHistory.create({
    userId: player1.id,
    matchId: match.id,
    preRating: preRating1,
    postRating: player1.rating,
    ratingChange: ratingChange1,
    expectedOutcome: expectedScore1,
    opponent: player2.id,
    adminMediation: true
  });

  await RatingHistory.create({
    userId: player2.id,
    matchId: match.id,
    preRating: preRating2,
    postRating: player2.rating,
    ratingChange: ratingChange2,
    expectedOutcome: 1 - expectedScore1,
    opponent: player1.id,
    adminMediation: true
  });
}

module.exports = router;
