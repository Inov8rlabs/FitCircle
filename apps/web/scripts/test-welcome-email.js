#!/usr/bin/env node

/**
 * Test script to send welcome email
 *
 * Usage:
 *   node scripts/test-welcome-email.js your-email@example.com "Your Name"
 *
 * Or with bun:
 *   bun scripts/test-welcome-email.js your-email@example.com "Your Name"
 */

import { sendWelcomeEmail } from '../app/lib/email/email-service.js';

const email = process.argv[2];
const name = process.argv[3] || 'Test User';

if (!email) {
  console.error('❌ Error: Email address is required');
  console.log('\nUsage:');
  console.log('  node scripts/test-welcome-email.js your-email@example.com "Your Name"');
  console.log('  bun scripts/test-welcome-email.js your-email@example.com "Your Name"');
  process.exit(1);
}

console.log('📧 Sending welcome email...');
console.log(`   To: ${email}`);
console.log(`   Name: ${name}`);
console.log('');

sendWelcomeEmail({
  to: email,
  userName: name,
})
  .then((result) => {
    if (result.success) {
      console.log('✅ Success! Welcome email sent successfully');
      console.log('   Check your inbox at:', email);
    } else {
      console.error('❌ Failed to send email:', result.error);
    }
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
  })
  .finally(() => {
    process.exit(0);
  });
