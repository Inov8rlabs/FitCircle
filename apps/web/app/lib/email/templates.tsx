/**
 * FitCircle Email Templates
 *
 * Design-forward, on-brand email templates with dark theme and bright accents
 */

// Production domain - use environment variable or fallback to hardcoded value
const PRODUCTION_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.fitcircle.ai';

// Base styles for all emails - matches FitCircle's brand
const baseStyles = `
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: #0f172a;
  }
  .container {
    max-width: 600px;
    margin: 0 auto;
    padding: 40px 20px;
  }
  .card {
    background: #1e293b;
    border: 1px solid rgba(71, 85, 105, 0.3);
    border-radius: 16px;
    overflow: hidden;
  }
  .header {
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
    padding: 40px 30px;
    text-align: center;
  }
  .logo-wrapper {
    text-align: center;
    margin-bottom: 12px;
  }
  .logo-table {
    display: inline-block;
  }
  .logo-icon {
    width: 48px;
    height: 48px;
    border-radius: 24px;
    background: white;
    text-align: center;
    vertical-align: middle;
    display: inline-block;
    margin-right: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .logo-f {
    font-family: Georgia, 'Times New Roman', serif;
    font-style: italic;
    font-size: 32px;
    font-weight: bold;
    color: #8b5cf6;
    line-height: 48px;
    display: inline-block;
  }
  .logo-text {
    font-size: 28px;
    font-weight: 800;
    color: white;
    letter-spacing: -0.5px;
    display: inline-block;
    vertical-align: middle;
    line-height: 48px;
  }
  .tagline {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.9);
    margin: 8px 0 0 0;
    letter-spacing: 0.5px;
  }
  .content {
    padding: 40px 30px;
    color: #f1f5f9;
    background: #0f172a;
  }
  .title {
    font-size: 24px;
    font-weight: 700;
    color: white;
    margin: 0 0 16px 0;
    line-height: 1.3;
  }
  .text {
    font-size: 16px;
    line-height: 1.6;
    color: #cbd5e1;
    margin: 0 0 20px 0;
  }
  .button {
    display: inline-block;
    background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
    color: #ffffff !important;
    text-decoration: none;
    padding: 16px 40px;
    border-radius: 12px;
    font-weight: 700;
    font-size: 16px;
    margin: 24px 0;
    box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
  }
  .button:visited {
    color: #ffffff !important;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin: 24px 0;
  }
  .stat-card {
    background: #0f172a;
    border: 1px solid rgba(71, 85, 105, 0.3);
    border-radius: 8px;
    padding: 14px 16px;
    text-align: center;
  }
  .stat-label {
    font-size: 10px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 6px 0;
    font-weight: 600;
  }
  .stat-value {
    font-size: 18px;
    font-weight: 700;
    color: #a78bfa;
    margin: 0;
    line-height: 1.2;
  }
  .highlight-box {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(99, 102, 241, 0.1) 100%);
    border-left: 4px solid #8b5cf6;
    padding: 20px;
    border-radius: 8px;
    margin: 24px 0;
  }
  .footer {
    padding: 30px;
    text-align: center;
    border-top: 1px solid rgba(71, 85, 105, 0.3);
    background: #0f172a;
  }
  .footer-text {
    font-size: 14px;
    color: #94a3b8;
    margin: 0 0 12px 0;
  }
  .footer-links {
    margin: 16px 0 0 0;
  }
  .footer-link {
    color: #8b5cf6;
    text-decoration: none;
    margin: 0 12px;
    font-size: 14px;
  }
  .divider {
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.2), transparent);
    margin: 24px 0;
  }
  .badge {
    display: inline-block;
    background: rgba(139, 92, 246, 0.2);
    color: #c4b5fd;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .link-box {
    background: #1e293b;
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 12px;
    padding: 20px;
    margin: 24px 0;
    text-align: center;
  }
  .link-label {
    font-size: 13px;
    color: #94a3b8;
    margin: 0 0 12px 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .link-url {
    display: block;
    background: #0f172a;
    border: 1px solid rgba(71, 85, 105, 0.3);
    padding: 16px 20px;
    border-radius: 8px;
    color: #a78bfa !important;
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    word-break: break-all;
    font-family: 'Courier New', monospace;
  }
  .link-url:hover {
    background: #1e293b;
    border-color: rgba(139, 92, 246, 0.5);
  }
  .link-url:visited {
    color: #a78bfa !important;
  }
`;

interface WelcomeEmailProps {
  userName: string;
  userEmail: string;
}

export function generateWelcomeEmail({ userName, userEmail }: WelcomeEmailProps): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to FitCircle</title>
  <style>${baseStyles}</style>
</head>
<body>
  <div class="container">
    <div class="card">
      <!-- Header with gradient background -->
      <div class="header">
        <div class="logo-wrapper">
          <span class="logo-icon"><span class="logo-f">f</span></span><span class="logo-text">FitCircle</span>
        </div>
        <p class="tagline">Social Weight Loss Competitions</p>
      </div>

      <!-- Main content -->
      <div class="content">
        <h2 class="title">Welcome to the Circle, ${userName}! 🎉</h2>

        <p class="text">
          We're thrilled to have you join FitCircle! You're now part of a community that makes
          staying healthy fun, social, and incredibly motivating through friendly competition.
        </p>

        <div class="highlight-box">
          <p class="text" style="margin: 0;">
            <strong style="color: #c4b5fd;">🚀 Quick Start:</strong> Complete your profile,
            set your goals, and join your first FitCircle to start competing with friends!
          </p>
        </div>

        <div style="text-align: center;">
          <a href="${PRODUCTION_URL}/dashboard" class="button">
            Go to Dashboard →
          </a>
        </div>

        <div class="divider"></div>

        <p class="text"><strong style="color: white;">What happens next?</strong></p>
        <p class="text">
          ✨ <strong>Set Your Goals:</strong> Define your weight loss targets<br>
          🎯 <strong>Join or Create Circles:</strong> Compete with friends or join public challenges<br>
          📊 <strong>Track Daily:</strong> Log your progress and climb the leaderboard<br>
          🏆 <strong>Stay Motivated:</strong> See real-time progress and celebrate wins together
        </p>

        <div class="divider"></div>

        <p class="text" style="font-size: 14px; color: #94a3b8;">
          <strong>Pro tip:</strong> The most successful FitCircle members check in daily and
          compete with at least 3 friends. Accountability drives results!
        </p>
      </div>

      <!-- Footer -->
      <div class="footer">
        <p class="footer-text">
          Questions? We're here to help!
        </p>
        <div class="footer-links">
          <a href="${PRODUCTION_URL}/help" class="footer-link">Help Center</a>
          <a href="${PRODUCTION_URL}/about" class="footer-link">About</a>
        </div>
        <p class="footer-text" style="margin-top: 20px; font-size: 12px;">
          FitCircle • Making weight loss social and fun
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

interface InvitationEmailProps {
  invitedByName: string;
  invitedEmail: string;
  circleName: string;
  circleType: string;
  startDate: string;
  endDate: string;
  participantCount: number;
  inviteCode: string;
}

export function generateInvitationEmail({
  invitedByName,
  invitedEmail,
  circleName,
  circleType,
  startDate,
  endDate,
  participantCount,
  inviteCode,
}: InvitationEmailProps): string {
  const inviteUrl = `${PRODUCTION_URL}/join/${inviteCode}`;

  // Format dates
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    });
  };

  const circleTypeLabel = {
    weight_loss: 'Weight Loss',
    step_count: 'Step Count',
    workout_frequency: 'Workout Frequency',
    custom: 'Custom Goal'
  }[circleType] || 'Challenge';

  const circleIcon = {
    weight_loss: '⚖️',
    step_count: '👟',
    workout_frequency: '💪',
    custom: '🎯'
  }[circleType] || '🎯';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited to Join ${circleName}</title>
  <style>${baseStyles}</style>
</head>
<body>
  <div class="container">
    <div class="card">
      <!-- Header -->
      <div class="header">
        <div class="logo-wrapper">
          <span class="logo-icon"><span class="logo-f">f</span></span><span class="logo-text">FitCircle</span>
        </div>
        <p class="tagline">You've Been Invited!</p>
      </div>

      <!-- Main content -->
      <div class="content">
        <p class="text" style="font-size: 15px; margin-bottom: 12px;">
          <strong style="color: #c4b5fd;">${invitedByName}</strong> wants you to join:
        </p>

        <div style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(99, 102, 241, 0.2) 100%); border: 2px solid rgba(139, 92, 246, 0.4); padding: 24px; border-radius: 12px; margin: 16px 0 24px 0; text-align: center;">
          <p style="font-size: 28px; font-weight: 800; color: #ffffff; margin: 0 0 8px 0; line-height: 1.2;">
            ${circleIcon} ${circleName}
          </p>
          <p style="font-size: 13px; color: #a78bfa; margin: 0; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">
            ${circleTypeLabel} Challenge
          </p>
        </div>

        <p class="text" style="font-size: 16px; text-align: center;">
          Ready to crush your goals together? Let's go! 💪
        </p>

        <!-- Challenge Stats -->
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 24px 0;">
          <tr>
            <td width="49%" style="background: #0f172a; border: 1px solid rgba(71, 85, 105, 0.3); border-radius: 8px; padding: 14px 16px; text-align: center; vertical-align: top;">
              <p style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px 0; font-weight: 600;">START DATE</p>
              <p style="font-size: 16px; font-weight: 700; color: #06b6d4; margin: 0; line-height: 1.2;">
                ${formatDate(startDate)}
              </p>
            </td>
            <td width="2%"></td>
            <td width="49%" style="background: #0f172a; border: 1px solid rgba(71, 85, 105, 0.3); border-radius: 8px; padding: 14px 16px; text-align: center; vertical-align: top;">
              <p style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px 0; font-weight: 600;">END DATE</p>
              <p style="font-size: 16px; font-weight: 700; color: #f97316; margin: 0; line-height: 1.2;">
                ${formatDate(endDate)}
              </p>
            </td>
          </tr>
          <tr><td colspan="3" height="12"></td></tr>
          <tr>
            <td width="49%" style="background: #0f172a; border: 1px solid rgba(71, 85, 105, 0.3); border-radius: 8px; padding: 14px 16px; text-align: center; vertical-align: top;">
              <p style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px 0; font-weight: 600;">PARTICIPANTS</p>
              <p style="font-size: 18px; font-weight: 700; color: #a78bfa; margin: 0; line-height: 1.2;">
                ${participantCount}
              </p>
            </td>
            <td width="2%"></td>
            <td width="49%" style="background: #0f172a; border: 1px solid rgba(71, 85, 105, 0.3); border-radius: 8px; padding: 14px 16px; text-align: center; vertical-align: top;">
              <p style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px 0; font-weight: 600;">TYPE</p>
              <p style="font-size: 14px; font-weight: 700; color: #10b981; margin: 0; line-height: 1.2;">
                ${circleIcon} ${circleTypeLabel}
              </p>
            </td>
          </tr>
        </table>

        <div class="highlight-box">
          <p class="text" style="margin: 0;">
            <strong style="color: #c4b5fd;">💡 How it works:</strong> Join the challenge,
            set your goals, track your daily progress, and compete on the leaderboard.
            The friendly competition keeps everyone motivated!
          </p>
        </div>

        <div style="text-align: center;">
          <a href="${inviteUrl}" class="button">
            Join ${circleName} →
          </a>
        </div>

        <div class="divider"></div>

        <div class="link-box">
          <p class="link-label">Or use this invite link:</p>
          <a href="${inviteUrl}" class="link-url">
            ${inviteUrl}
          </a>
        </div>

        <div class="divider"></div>

        <p class="text" style="font-size: 14px;">
          <strong style="color: white;">What you'll get:</strong>
        </p>
        <p class="text" style="font-size: 14px;">
          📊 Real-time leaderboard and progress tracking<br>
          🎯 Personalized goals and milestones<br>
          🏆 Achievement badges and celebrations<br>
          💪 Daily check-ins and accountability<br>
          👥 Compete and connect with friends
        </p>
      </div>

      <!-- Footer -->
      <div class="footer">
        <p class="footer-text">
          New to FitCircle? Sign up for free when you join!
        </p>
        <div class="footer-links">
          <a href="${PRODUCTION_URL}/about" class="footer-link">Learn More</a>
          <a href="${PRODUCTION_URL}/help" class="footer-link">Help</a>
        </div>
        <p class="footer-text" style="margin-top: 20px; font-size: 12px;">
          FitCircle • Making weight loss social and fun
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}
