#!/usr/bin/env tsx
/**
 * Writes the branded Supabase Auth templates to supabase/templates/*.html
 * (plus subjects.txt) for pasting into the Supabase dashboard
 * (Authentication → Emails → Templates). Doesn't touch the dashboard.
 *
 *   npx tsx apps/web/scripts/render-auth-email-templates.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { authEmailTemplates } from '../app/lib/email/auth-templates';

const out = path.resolve(__dirname, '../../../supabase/templates');
mkdirSync(out, { recursive: true });
const subjects: string[] = [];
for (const t of authEmailTemplates()) {
  writeFileSync(path.join(out, `${t.key}.html`), t.html);
  subjects.push(`${t.dashboardName} (${t.key}.html): ${t.subject}`);
}
writeFileSync(path.join(out, 'subjects.txt'), `${subjects.join('\n')}\n`);
console.log(`wrote ${subjects.length} templates to ${out}`);
