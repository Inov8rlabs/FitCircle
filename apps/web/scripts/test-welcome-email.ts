#!/usr/bin/env tsx

/**
 * Render (and optionally send) the welcome email.
 *
 *   npx tsx scripts/test-welcome-email.ts --out /tmp/welcome          # writes welcome-{app,web}.html/.txt
 *   npx tsx scripts/test-welcome-email.ts --send you@fitcircle.ai "Maya Rao" [--web]
 *
 * --send goes through the central sender (suppression list, category tag) with
 * the real template; it needs RESEND_API_KEY. Only send to your own inbox.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { sendEmail } from '../app/lib/email/email-service';
import { welcomeEmail, type WelcomePlatform } from '../app/lib/email/welcome-email';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

void (async () => {
  const out = value('--out');
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const platform of ['ios', 'web'] as WelcomePlatform[]) {
      const r = welcomeEmail({
        firstName: 'Maya',
        platform,
        unsubscribeUrl: 'https://www.fitcircle.ai/api/campaigns/unsubscribe?t=preview',
        postalAddress: process.env.EMAIL_POSTAL_ADDRESS || null,
      });
      const name = platform === 'web' ? 'web' : 'app';
      writeFileSync(path.join(out, `welcome-${name}.html`), r.html);
      writeFileSync(path.join(out, `welcome-${name}.txt`), `Subject: ${r.subject}\nPreheader: ${r.preheader}\n\n${r.text}\n`);
      console.log(`wrote welcome-${name}.html (${r.html.length} bytes)`);
    }
    return;
  }

  const to = value('--send');
  if (!to) {
    console.error('Usage: --out <dir> | --send <email> [name] [--web]');
    process.exit(1);
  }
  const nameArg = args[args.indexOf('--send') + 2];
  const firstName = nameArg && !nameArg.startsWith('--') ? nameArg.split(/\s+/)[0] : null;
  const r = welcomeEmail({ firstName, platform: flag('--web') ? 'web' : 'ios', postalAddress: process.env.EMAIL_POSTAL_ADDRESS || null });
  const res = await sendEmail({ to, subject: `[Test] ${r.subject}`, html: r.html, text: r.text, category: 'welcome', tags: { test: '1' } });
  if (!res.success) {
    console.error('Failed:', res.errorName, res.error);
    process.exit(1);
  }
  console.log('Sent:', res.id);
})();
