import { describe, it, expect, vi } from 'vitest';

import { resolveEntryDate } from '@/lib/utils/entry-date';

vi.mock('@/lib/utils/timezone', () => ({ getUserTimezone: vi.fn(async () => 'Asia/Kolkata') }));

const req = (tz?: string) => ({ headers: { get: (n: string) => (n === 'x-client-timezone' ? tz ?? null : null) } });
const supabase = {} as never;

describe('resolveEntryDate', () => {
  it('keeps an explicit entry_date', async () => {
    expect(await resolveEntryDate(req('America/Toronto'), { entry_date: '2026-09-29', logged_at: '2026-09-30T02:56:00Z' }, 'u', supabase)).toBe('2026-09-29');
  });

  it('files a 10:56 pm Toronto snack under the local day, not the UTC day', async () => {
    expect(await resolveEntryDate(req('America/Toronto'), { logged_at: '2026-09-30T02:56:40Z' }, 'u', supabase)).toBe('2026-09-29');
  });

  it('falls back to the profile timezone when the app sent none', async () => {
    // 20:00 UTC on the 29th is 01:30 on the 30th in Kolkata.
    expect(await resolveEntryDate(req(), { logged_at: '2026-09-29T20:00:00Z' }, 'u', supabase)).toBe('2026-09-30');
  });

  it('ignores an invalid header timezone', async () => {
    expect(await resolveEntryDate(req('Not/AZone'), { logged_at: '2026-09-29T20:00:00Z' }, 'u', supabase)).toBe('2026-09-30');
  });
});
