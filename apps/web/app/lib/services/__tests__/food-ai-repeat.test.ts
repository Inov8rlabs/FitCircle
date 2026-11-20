/**
 * Repeat food AI analyses (ENGAGEMENT_115_SPEC §14.4 item 3): UsageService.recentFoodAiCredit,
 * the credit hash format and the X-Analysis-Job-Id header parser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';
import { parseAnalysisJobId, readAnalysisJobId } from '@/lib/validation/analysis-job-id';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { FOOD_AI_REPEAT_WINDOW_MS, UsageService, foodAiCreditHash } from '../usage-service';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-16T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
let db: FakeSupabase;

beforeEach(() => {
  db = new FakeSupabase({ nutrition_parse_log: {} });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
});

describe('foodAiCreditHash', () => {
  it('content hash alone, or tagged with the job id', () => {
    expect(foodAiCreditHash('abc')).toBe('abc');
    expect(foodAiCreditHash('abc', 'job-12345678')).toBe('abc|job:job-12345678');
  });
});

describe('UsageService.recentFoodAiCredit', () => {
  it('matches the same content within the window (with or without a job tag)', async () => {
    db.seed('nutrition_parse_log', [{ id: '1', user_id: U, image_hash: 'h1|job:j-00000001', created_at: ago(60_000) }]);
    expect(await UsageService.recentFoodAiCredit(U, 'h1', undefined, NOW)).toEqual({ contentHash: 'h1', countedAt: ago(60_000), matchedBy: 'content' });
  });
  it('matches the same job id with different content', async () => {
    db.seed('nutrition_parse_log', [{ id: '1', user_id: U, image_hash: 'h1|job:j-00000001', created_at: ago(30_000) }]);
    expect(await UsageService.recentFoodAiCredit(U, 'h2', 'j-00000001', NOW)).toMatchObject({ contentHash: 'h1', matchedBy: 'job' });
    expect(await UsageService.recentFoodAiCredit(U, 'h2', 'j-00000002', NOW)).toBeNull();
    expect(await UsageService.recentFoodAiCredit(U, 'h2', undefined, NOW)).toBeNull();
  });
  it('ignores rows older than the window and other users', async () => {
    db.seed('nutrition_parse_log', [
      { id: '1', user_id: U, image_hash: 'h1', created_at: ago(FOOD_AI_REPEAT_WINDOW_MS + 1_000) },
      { id: '2', user_id: OTHER, image_hash: 'h1', created_at: ago(1_000) },
    ]);
    expect(await UsageService.recentFoodAiCredit(U, 'h1', undefined, NOW)).toBeNull();
  });
  it('fails soft (null → counted as usual) when the read throws', async () => {
    vi.mocked(createAdminSupabase).mockImplementation(() => {
      throw new Error('db down');
    });
    expect(await UsageService.recentFoodAiCredit(U, 'h1', undefined, NOW)).toBeNull();
  });
});

describe('X-Analysis-Job-Id parsing', () => {
  it('accepts 8–64 [A-Za-z0-9_-], lower-cases; anything else is ignored', () => {
    expect(parseAnalysisJobId('A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')).toBe('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
    expect(parseAnalysisJobId(' job_12345678 ')).toBe('job_12345678');
    for (const bad of [null, undefined, '', 'short', 'has space 123', 'pipe|job:x123', 'x'.repeat(65)]) expect(parseAnalysisJobId(bad)).toBeUndefined();
    expect(readAnalysisJobId({ headers: new Headers({ 'X-Analysis-Job-Id': 'abcdefgh' }) })).toBe('abcdefgh');
  });
});
