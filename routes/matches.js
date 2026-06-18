const express = require('express');
const router = express.Router();
const Match = require('../models/Match');
const User = require('../models/User');
const Submission = require('../models/Submission');
const RatingHistory = require('../models/RatingHistory');
const MatchAssignment = require('../services/MatchAssignment');
const RatingCalculator = require('../services/RatingCalculator');
const EmailService = require('../services/EmailService');
const { v4: uuidv4 } = require('uuid');

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
    req.userId = decoded.user_id;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * GET /api/matches
 * Get all open matches
 */
router.get('/', async (req, res) => {
  try {
    const matches = await MatchAssignment.getOpenMatches(50);
    res.json({ success: true, matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/matches/my-matches
 * Get current user's matches
 */
router.get('/my-matches', verifyToken, async (req, res) => {
  try {
    const currentWeek = Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000));
    
    const matches = await Match.find({
      $or: [
        { playerA_id: req.userId },
        { playerB_id: req.userId }
      ],
      week_of_season: currentWeek
    }).populate(['playerA_id', 'playerB_id']);

    res.json({ success: true, matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/matches/:matchId
 * Get match details
 */
router.get('/:matchId', async (req, res) => {
  try {
    const match = await Match.findOne({ match_id: req.params.matchId }).populate(['playerA_id', 'playerB_id']);
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    res.json({ success: true, match });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/matches/:matchId/propose
 * Submit match date/time proposal
 */
router.post('/:matchId/propose', verifyToken, async (req, res) => {
  try {
    const { proposed_date, proposed_start_time, court_number } = req.body;
    const match = await Match.findOne({ match_id: req.params.matchId });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Verify user is one of the players
    if (match.playerA_id !== req.userId && match.playerB_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const proposal = {
      proposal_id: uuidv4(),
      proposer_id: req.userId,
      proposed_date: new Date(proposed_date),
      proposed_start_time,
      court_number,
      proposal_deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
      created_at: new Date()
    };

    match.proposals.push(proposal);
    match.status = 'negotiation';
    await match.save();

    res.json({ success: true, proposal, message: 'Proposal submitted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/matches/:matchId/accept-proposal
 * Accept a proposed date/time
 */
router.post('/:matchId/accept-proposal', verifyToken, async (req, res) => {
  try {
    const { proposalId } = req.body;
    const match = await Match.findOne({ match_id: req.params.matchId });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const proposal = match.proposals.find(p => p.proposal_id === proposalId);
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    // Update match
    match.scheduled_datetime = proposal.proposed_date;
    match.court_number = proposal.court_number;
    match.status = 'scheduled';
    await match.save();

    res.json({ success: true, message: 'Proposal accepted', match });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/matches/:matchId/submit-score
 * Submit match score
 */
router.post('/:matchId/submit-score', verifyToken, async (req, res) => {
  try {
    const { games_playerA, games_playerB } = req.body;
    const match = await Match.findOne({ match_id: req.params.matchId });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Create submission
    const submission = new Submission({
      submission_id: uuidv4(),
      match_id: req.params.matchId,
      submitter_id: req.userId,
      games_playerA,
      games_playerB,
      status: 'pending'
    });

    await submission.save();

    // Calculate expected rating change for preview
    const ratingChangeA = await RatingCalculator.calculateRatingChange(
      req.params.matchId,
      match.playerA_id,
      match.playerB_id,
      games_playerA,
      games_playerB,
      match.playerA_rating_before,
      match.playerB_rating_before
    );

    submission.expected_rating_delta_preview = ratingChangeA.ratingDelta;
    await submission.save();

    res.json({ success: true, submission, message: 'Score submitted for confirmation' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/matches/:matchId/confirm-score
 * Accept/confirm submitted score
 */
router.post('/:matchId/confirm-score', verifyToken, async (req, res) => {
  try {
    const { submissionId } = req.body;
    const match = await Match.findOne({ match_id: req.params.matchId });
    const submission = await Submission.findOne({ submission_id: submissionId });

    if (!match || !submission) {
      return res.status(404).json({ error: 'Match or submission not found' });
    }

    // Apply rating changes
    const ratingResult = await RatingCalculator.applyRatingChanges(
      req.params.matchId,
      match.playerA_id,
      match.playerB_id,
      submission.games_playerA,
      submission.games_playerB,
      match.playerA_rating_before,
      match.playerB_rating_before
    );

    if (!ratingResult.success) {
      return res.status(500).json({ error: 'Failed to calculate ratings' });
    }

    // Update users' ratings
    await User.updateOne({ user_id: match.playerA_id }, { rating: ratingResult.playerA.newRating });
    await User.updateOne({ user_id: match.playerB_id }, { rating: ratingResult.playerB.newRating });

    // Mark submission as accepted and match as played
    submission.status = 'accepted';
    match.status = 'played';
    await submission.save();
    await match.save();

    res.json({ success: true, message: 'Score confirmed', ratingResult });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/matches/:matchId/dispute
 * Dispute match result
 */
router.post('/:matchId/dispute', verifyToken, async (req, res) => {
  try {
    const { submissionId, explanation } = req.body;
    const match = await Match.findOne({ match_id: req.params.matchId });
    const submission = await Submission.findOne({ submission_id: submissionId });

    if (!match || !submission) {
      return res.status(404).json({ error: 'Match or submission not found' });
    }

    // Update submission status
    submission.status = 'disputed';
    submission.resubmission_count += 1;
    await submission.save();

    match.status = 'disputed';
    await match.save();

    // Notify admins
    const adminUsers = await User.find({ role: 'admin' });
    for (const admin of adminUsers) {
      await EmailService.sendDisputeEscalatedEmail(
        admin.email,
        admin.name,
        'Player',
        'Opponent',
        req.params.matchId,
        explanation
      );
    }

    res.json({ success: true, message: 'Dispute raised' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
