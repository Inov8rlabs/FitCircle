import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mobile create-circle route dropped `type`, and the service never set it,
// so every insert violated fitcircles.type NOT NULL. These tests pin the fix.
const inserted: any[] = [];
vi.mock('../../supabase-admin', () => {
  let pendingInsert: any = null;
  const chain = {
    insert: (row: any) => { inserted.push(row); pendingInsert = row; return chain; },
    select: () => chain,
    // After insert(): return the row. Otherwise (invite-code uniqueness probe): nothing found.
    single: async () => {
      const row = pendingInsert; pendingInsert = null;
      return row ? { data: { id: 'c1', ...row }, error: null } : { data: null, error: { code: 'PGRST116' } };
    },
    from: () => chain,
    upsert: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return { createAdminSupabase: () => chain, supabaseAdmin: chain };
});

import { CircleService } from '../circle-service';

beforeEach(() => { inserted.length = 0; vi.spyOn(CircleService as any, 'addMemberToCircle').mockResolvedValue(undefined); });

describe('CircleService.createCircle — type', () => {
  it('defaults type to custom when the caller omits it', async () => {
    await CircleService.createCircle('u1', { name: 'Steps', start_date: '2026-09-10', end_date: '2026-10-09' });
    expect(inserted[0].type).toBe('custom');
  });
  it('persists an explicit type', async () => {
    await CircleService.createCircle('u1', { name: 'Steps', type: 'step_count', start_date: '2026-09-10', end_date: '2026-10-09' });
    expect(inserted[0].type).toBe('step_count');
  });
});

import { INVITE_CODE_PATTERN, randomInviteSuffix } from '../circle-service';

describe('invite codes', () => {
  it('always match the DB invite_code_format check and fit varchar(10)', () => {
    for (let i = 0; i < 2000; i++) {
      const code = 'FIT' + randomInviteSuffix(6);
      expect(code).toMatch(INVITE_CODE_PATTERN);
      expect(code.length).toBeLessThanOrEqual(10);
      expect(code).not.toContain('undefined');
    }
  });
});
