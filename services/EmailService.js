const { Resend } = require('resend');
const Notification = require('../models/Notification');
const { v4: uuidv4 } = require('uuid');

const resend = new Resend(process.env.RESEND_API_KEY);

class EmailService {
  static senderEmail = process.env.SENDER_EMAIL || 'noreply@tennisladder.com';

  /**
   * Send email and create notification record
   */
  static async sendEmail(recipientEmail, subject, htmlContent, notificationType, recipientId, metadata = {}) {
    try {
      // Create notification record first
      const notificationId = uuidv4();
      const notification = new Notification({
        notification_id: notificationId,
        recipient_id: recipientId,
        type: notificationType,
        title: subject,
        message: htmlContent,
        ...metadata
      });

      // Attempt to send email via Resend
      let emailSent = false;
      let emailError = null;

      try {
        await resend.emails.send({
          from: this.senderEmail,
          to: recipientEmail,
          subject: subject,
          html: htmlContent
        });
        emailSent = true;
      } catch (err) {
        emailError = err.message;
        console.error(`Email send failed for ${recipientEmail}: ${err.message}`);
      }

      // Update notification with email status
      notification.email_sent = emailSent;
      if (emailSent) {
        notification.email_sent_at = new Date();
      } else {
        notification.email_error = emailError;
      }

      await notification.save();

      return {
        success: true,
        notificationId,
        emailSent,
        error: emailError
      };
    } catch (error) {
      console.error(`Email service error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Match proposal notification
   */
  static async sendMatchProposalEmail(playerEmail, playerName, opponentName, proposalDeadline) {
    const subject = `New Match Proposal - ${opponentName}`;
    const htmlContent = `
      <h2>New Match Proposal</h2>
      <p>Hi ${playerName},</p>
      <p><strong>${opponentName}</strong> has proposed a match against you!</p>
      <p>Please log in to the Tennis Ladder to respond to the proposal.</p>
      <p><strong>Deadline:</strong> ${proposalDeadline.toLocaleDateString()}</p>
      <p>Best regards,<br>Tennis Ladder Team</p>
    `;
    
    return this.sendEmail(playerEmail, subject, htmlContent, 'proposal', null);
  }

  /**
   * Match accepted notification
   */
  static async sendMatchAcceptedEmail(playerEmail, playerName, opponentName, matchDate) {
    const subject = `Match Accepted - ${opponentName}`;
    const htmlContent = `
      <h2>Match Accepted!</h2>
      <p>Hi ${playerName},</p>
      <p>Great news! <strong>${opponentName}</strong> has accepted your match proposal.</p>
      <p><strong>Scheduled Date:</strong> ${matchDate ? matchDate.toLocaleDateString() : 'To be scheduled'}</p>
      <p>See you on the court!</p>
      <p>Best regards,<br>Tennis Ladder Team</p>
    `;
    
    return this.sendEmail(playerEmail, subject, htmlContent, 'proposal_accepted', null);
  }

  /**
   * Score submitted notification
   */
  static async sendScoreSubmittedEmail(playerEmail, playerName, opponentName, games) {
    const subject = `Score Submitted - Match vs ${opponentName}`;
    const htmlContent = `
      <h2>Score Submitted</h2>
      <p>Hi ${playerName},</p>
      <p>A score has been submitted for your match against <strong>${opponentName}</strong>:</p>
      <p><strong>Score:</strong> ${games.playerA} - ${games.playerB}</p>
      <p>Please log in to the Tennis Ladder to accept or dispute this score.</p>
      <p>Best regards,<br>Tennis Ladder Team</p>
    `;
    
    return this.sendEmail(playerEmail, subject, htmlContent, 'score_submitted', null);
  }

  /**
   * Dispute escalated notification (to admin)
   */
  static async sendDisputeEscalatedEmail(adminEmail, adminName, playerName, opponentName, matchId, reason) {
    const subject = `Match Dispute Escalated - Action Required`;
    const htmlContent = `
      <h2>Match Dispute Escalated</h2>
      <p>Hi ${adminName},</p>
      <p>A match dispute has been escalated and requires your review.</p>
      <p><strong>Players:</strong> ${playerName} vs ${opponentName}</p>
      <p><strong>Match ID:</strong> ${matchId}</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Please log in to the admin panel to review and resolve this dispute.</p>
      <p>Best regards,<br>Tennis Ladder Team</p>
    `;
    
    return this.sendEmail(adminEmail, subject, htmlContent, 'dispute_escalated', null);
  }

  /**
   * Dispute resolved notification
   */
  static async sendDisputeResolvedEmail(playerEmail, playerName, resolution) {
    const subject = `Match Dispute Resolved`;
    const htmlContent = `
      <h2>Dispute Resolution</h2>
      <p>Hi ${playerName},</p>
      <p>The dispute for your match has been resolved.</p>
      <p><strong>Resolution:</strong> ${resolution}</p>
      <p>The rating changes have been applied to your account.</p>
      <p>Best regards,<br>Tennis Ladder Team</p>
    `;
    
    return this.sendEmail(playerEmail, subject, htmlContent, 'dispute_resolved', null);
  }

  /**
   * Account frozen notification
   */
  static async sendAccountFrozenEmail(playerEmail, playerName, reason, freezeUntil) {
    const subject = `Account Frozen - Tennis Ladder`;
    const htmlContent = `
      <h2>Account Frozen</h2>
      <p>Hi ${playerName},</p>
      <p>Your account has been temporarily frozen.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p><strong>Frozen Until:</strong> ${freezeUntil.toLocaleDateString()}</p>
      <p>If you believe this is a mistake, please contact support.</p>
      <p>Best regards,<br>Tennis Ladder Team</p>
    `;
    
    return this.sendEmail(playerEmail, subject, htmlContent, 'account_frozen', null);
  }

  /**
   * Account unfrozen notification
   */
  static async sendAccountUnfrozenEmail(playerEmail, playerName) {
    const subject = `Account Unfrozen - Tennis Ladder`;
    const htmlContent = `
      <h2>Account Restored</h2>
      <p>Hi ${playerName},</p>
      <p>Your account has been restored and you can now participate in matches again!</p>
      <p>Welcome back!</p>
      <p>Best regards,<br>Tennis Ladder Team</p>
    `;
    
    return this.sendEmail(playerEmail, subject, htmlContent, 'account_unfrozen', null);
  }

  /**
   * Season report notification
   */
  static async sendSeasonReportEmail(playerEmail, playerName, seasonStats) {
    const subject = `Your Season Report - Tennis Ladder`;
    const htmlContent = `
      <h2>Season Report</h2>
      <p>Hi ${playerName},</p>
      <p>Here's your season summary:</p>
      <ul>
        <li><strong>Final Rating:</strong> ${seasonStats.finalRating}</li>
        <li><strong>Rating Change:</strong> ${seasonStats.ratingChange > 0 ? '+' : ''}${seasonStats.ratingChange}</li>
        <li><strong>Matches Played:</strong> ${seasonStats.matchesPlayed}</li>
        <li><strong>Wins:</strong> ${seasonStats.wins}</li>
        <li><strong>Final Position:</strong> ${seasonStats.finalPosition}</li>
      </ul>
      <p>Great season! See you next time!</p>
      <p>Best regards,<br>Tennis Ladder Team</p>
    `;
    
    return this.sendEmail(playerEmail, subject, htmlContent, 'season_report', null);
  }

  /**
   * Match expired notification
   */
  static async sendMatchExpiredEmail(playerEmail, playerName, opponentName) {
    const subject = `Match Expired - ${opponentName}`;
    const htmlContent = `
      <h2>Match Expired</h2>
      <p>Hi ${playerName},</p>
      <p>Your match proposal against <strong>${opponentName}</strong> has expired.</p>
      <p>A new match will be assigned in the next round.</p>
      <p>Best regards,<br>Tennis Ladder Team</p>
    `;
    
    return this.sendEmail(playerEmail, subject, htmlContent, 'match_expired', null);
  }

  /**
   * Mark notification as seen by user
   */
  static async markNotificationAsSeen(notificationId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { notification_id: notificationId },
        { seen: true, seen_at: new Date() },
        { new: true }
      );
      return { success: true, notification };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get unread notifications for a user
   */
  static async getUnreadNotifications(userId, limit = 20) {
    try {
      const notifications = await Notification.find({
        recipient_id: userId,
        seen: false
      }).sort({ created_at: -1 }).limit(limit);

      return { success: true, notifications };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = EmailService;
