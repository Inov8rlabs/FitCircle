#!/usr/bin/env tsx

/**
 * Test script to send invitation email
 *
 * Usage:
 *   bun scripts/test-invitation-email.ts your-email@example.com "Inviter Name"
 */

import { sendInvitationEmail } from '../app/lib/email/email-service';

const email = process.argv[2];
const inviterName = process.argv[3] || 'Ani';

if (!email) {
  console.error('❌ Error: Email address is required');
  console.log('\nUsage:');
  console.log('  bun scripts/test-invitation-email.ts your-email@example.com "Inviter Name"');
  process.exit(1);
}

console.log('📧 Sending invitation email...');
console.log(`   To: ${email}`);
console.log(`   From: ${inviterName}`);
console.log('');

(async () => {
  try {
    // Test invitation data
    const testInvitation = {
      to: email,
      invitedByName: inviterName,
      circleName: 'Summer Weight Loss Challenge 2025',
      circleType: 'weight_loss' as const,
      startDate: '2025-06-01T12:00:00Z',
      endDate: '2025-08-31T12:00:00Z',
      participantCount: 8,
      inviteCode: 'TEST123',
    };

    const result = await sendInvitationEmail(testInvitation);

    if (result.success) {
      console.log('✅ Success! Invitation email sent successfully');
      console.log('   Check your inbox at:', email);
      console.log('');
      console.log('   Test FitCircle Details:');
      console.log('   - Name:', testInvitation.circleName);
      console.log('   - Type: Weight Loss Challenge');
      console.log('   - Duration: June 1 - August 31, 2025');
      console.log('   - Participants:', testInvitation.participantCount);
    } else {
      console.error('❌ Failed to send email:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
