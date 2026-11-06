/** Eager free plan preview for the fitzy_recommendations teaser (TRIAL_FIRST_SPEC §3). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { fitzyPlanPreviewReady, warmFitzyPlanPreview } from '../plan-warmup';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
const m = vi.hoisted(() => ({ tier: 'free' as 'free' | 'pro', consent: true, preview: vi.fn(), grounding: vi.fn(async () => 'GROUNDING') }));
vi.mock('../ai-consent', () => ({ hasAiConsentEvidence: async () => m.consent }));
vi.mock('../../services/usage-service', () => ({ UsageService: { fitzyTier: async () => m.tier } }));
vi.mock('../../services/fitzy-service', () => ({ FitzyService: { grounding: m.grounding, guard: () => false } }));
vi.mock('../../services/fitzy-plan-service', () => ({ FitzyPlanService: { preview: m.preview } }));

const USER = '11111111-2222-3333-4444-555555555555';
let db: FakeSupabase;
beforeEach(() => {
  m.tier = 'free';
  m.consent = true;
  m.preview.mockReset();
  db = new FakeSupabase({
    profiles: { rows: [{ id: USER, goals: ['weight_loss'], onboarding_completed: true }] },
    fitzy_plans: {},
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
});

describe('fitzyPlanPreviewReady', () => {
  it('real model preview (this or last week) or a real plan counts; fallback-only or empty does not', async () => {
    expect(await fitzyPlanPreviewReady(USER, '2026-11-06')).toBe(false); // week of 2026-11-02
    db.seed('fitzy_plans', [{ user_id: USER, week_of: '2026-11-02', is_preview: true, model: null, commitments: [{ id: 'x' }] }]);
    expect(await fitzyPlanPreviewReady(USER, '2026-11-06')).toBe(false);
    db.seed('fitzy_plans', [{ user_id: USER, week_of: '2026-10-26', is_preview: true, model: 'anthropic/claude-haiku-5.5', commitments: [{ id: 'y' }] }]);
    expect(await fitzyPlanPreviewReady(USER, '2026-11-06')).toBe(true); // last week's still counts
    expect(await fitzyPlanPreviewReady(USER, '2026-11-20')).toBe(false); // too old
  });
});

describe('warmFitzyPlanPreview', () => {
  it('free user with goals and no preview → generates the teaser once', async () => {
    expect(await warmFitzyPlanPreview(USER, 'UTC')).toBe(true);
    expect(m.preview).toHaveBeenCalledWith(USER, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), null, 'GROUNDING', expect.any(Function));
  });

  it('skips Pro, users without goals or onboarding, and users who already have a real preview', async () => {
    m.tier = 'pro';
    expect(await warmFitzyPlanPreview(USER)).toBe(false);
    m.tier = 'free';
    db.getRows('profiles')[0].goals = [];
    expect(await warmFitzyPlanPreview(USER)).toBe(false);
    db.getRows('profiles')[0].goals = ['health'];
    db.getRows('profiles')[0].onboarding_completed = false;
    expect(await warmFitzyPlanPreview(USER)).toBe(false);
    expect(m.preview).not.toHaveBeenCalled();
  });

  it('server-initiated AI: no consent record / chat evidence → no warm-up, no grounding read', async () => {
    m.consent = false;
    m.grounding.mockClear();
    expect(await warmFitzyPlanPreview(USER, 'UTC')).toBe(false);
    expect(m.preview).not.toHaveBeenCalled();
    expect(m.grounding).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    m.preview.mockRejectedValue(new Error('model down'));
    await expect(warmFitzyPlanPreview(USER)).resolves.toBe(false);
  });
});
