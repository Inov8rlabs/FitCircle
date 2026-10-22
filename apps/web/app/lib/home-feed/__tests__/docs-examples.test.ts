import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ruleDefinitionSchema, ruleInputSchema } from '../rules';

const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..');
const spec = readFileSync(join(repoRoot, 'docs', 'HOME_FEED_SPEC.md'), 'utf8');
const operating = spec.slice(spec.indexOf('## 9. Operating the feed'));
const ruleBlocks = [...operating.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));

describe('HOME_FEED_SPEC §9 rule examples', () => {
  it('has the documented examples', () => {
    expect(ruleBlocks.map((r) => r.key)).toEqual(['streak_rescue_evening', 'water_first', 'new_user_goals_first', 'referral_compact_10pct', 'hide_charts_android_108']);
  });

  it.each(ruleBlocks.map((r) => [r.key, r]))('%s validates', (_key, r) => {
    const parsed = ruleInputSchema.safeParse(r);
    expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues)).toBe(true);
  });

  it('the migration 106 seed matches the documented water_first rule', () => {
    const sql = readFileSync(join(repoRoot, 'supabase', 'migrations', '106_home_feed.sql'), 'utf8');
    const seed = JSON.parse(/\$json\$([\s\S]*?)\$json\$/.exec(sql)![1]);
    const { key: _k, enabled: _e, priority: _p, ...doc } = ruleBlocks.find((r) => r.key === 'water_first');
    expect(ruleDefinitionSchema.parse(seed)).toEqual(ruleDefinitionSchema.parse(doc));
    expect(sql).toMatch(/'water_first',\s*false,\s*100/);
  });
});
