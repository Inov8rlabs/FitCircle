#!/usr/bin/env tsx

/**
 * Test script to send welcome email
 *
 * Usage:
 *   bun scripts/test-welcome-email.ts your-email@example.com "Your Name"
 */

import { sendWelcomeEmail } from '../app/lib/email/email-service';

const email = process.argv[2];
const name = process.argv[3] || 'Test User';

if (!email) {
  console.error('❌ Error: Email address is required');
  console.log('\nUsage:');
  console.log('  bun scripts/test-welcome-email.ts your-email@example.com "Your Name"');
  process.exit(1);
}

console.log('📧 Sending welcome email...');
console.log(`   To: ${email}`);
console.log(`   Name: ${name}`);
console.log('');

(async () => {
  try {
    const result = await sendWelcomeEmail({
      to: email,
      userName: name,
    });

    if (result.success) {
      console.log('✅ Success! Welcome email sent successfully');
      console.log('   Check your inbox at:', email);
    } else {
      console.error('❌ Failed to send email:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
