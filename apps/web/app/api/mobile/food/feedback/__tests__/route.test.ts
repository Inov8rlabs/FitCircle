import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => ({ id: 'user-1' })),
}));
const rateDraft = vi.fn(async () => true);
vi.mock('@/lib/services/nutrition-training-service', () => ({
  NutritionTrainingService: { rateDraft: (...args: unknown[]) => rateDraft(...(args as [])) },
}));

import { POST } from '../route';

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/mobile/food/feedback', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

describe('POST /api/mobile/food/feedback', () => {
  beforeEach(() => rateDraft.mockClear());

  it('records a thumbs rating against the draft parseHash for the user', async () => {
    const res = await post({ parseHash: 'ab12cd34ef56ab12cd34ef56', rating: 'down', comment: 'rice was brown' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { recorded: true } });
    expect(rateDraft).toHaveBeenCalledWith({ userId: 'user-1', parseHash: 'ab12cd34ef56ab12cd34ef56', rating: 'down', comment: 'rice was brown' });
  });

  it('rejects an invalid rating or missing hash with 400', async () => {
    expect((await post({ parseHash: 'ab12cd34ef56ab12cd34ef56', rating: 'meh' })).status).toBe(400);
    expect((await post({ rating: 'up' })).status).toBe(400);
    expect((await post('nope')).status).toBe(400);
    expect(rateDraft).not.toHaveBeenCalled();
  });

  it('returns recorded:false (still 200) when no draft row matches', async () => {
    rateDraft.mockResolvedValueOnce(false);
    const res = await post({ parseHash: 'ab12cd34ef56ab12cd34ef56', rating: 'up' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { recorded: false } });
  });
});
