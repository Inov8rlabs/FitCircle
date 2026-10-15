import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiEstimateNote, EstimateWithAi, NO_AMOUNT_HINT } from '@/components/nutrition/AiTextEstimate';
import type * as AnalyticsModule from '@/lib/analytics';
import { ApiError, nutritionClient, type NutritionDraft } from '@/lib/api/nutrition-client';

const track = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>();
  return { ...actual, analytics: { ...actual.analytics, track: (...args: unknown[]) => track(...args) } };
});
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ token: 'tok' }) },
}));

const draft: NutritionDraft = {
  items: [
    {
      name: 'Scrambled eggs',
      quantity: 2,
      quantityRange: null,
      servingUnit: 'egg',
      grams: 100,
      calories: 182,
      proteinG: 13,
      carbsG: 2,
      fatG: 14,
      confidence: 0.9,
    },
  ],
  overallConfidence: 0.85,
  notes: null,
  inputMethod: 'voice',
  nutritionSource: 'llm_voice',
  model: 'm',
  cached: false,
  totals: { calories: 182, proteinG: 13, carbsG: 2, fatG: 14 },
  assumptions: ['2 large eggs', 'Scrambled in 1 tsp butter'],
};

describe('EstimateWithAi', () => {
  beforeEach(() => {
    track.mockClear();
    vi.restoreAllMocks();
  });

  it('is disabled until there is text, and hints when no amount was given', () => {
    const { rerender } = render(<EstimateWithAi text="  " onEstimate={() => {}} />);
    expect(screen.getByRole('button', { name: /Estimate with AI/ })).toBeDisabled();
    expect(screen.queryByText(NO_AMOUNT_HINT)).toBeNull();

    rerender(<EstimateWithAi text="chicken biryani" onEstimate={() => {}} />);
    expect(screen.getByRole('button', { name: /Estimate with AI/ })).toBeEnabled();
    expect(screen.getByText(NO_AMOUNT_HINT)).toBeInTheDocument();

    rerender(<EstimateWithAi text="2 eggs" onEstimate={() => {}} />);
    expect(screen.queryByText(NO_AMOUNT_HINT)).toBeNull();
  });

  it('sends the text with source "text" + no fallback save and hands back the draft', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: draft, error: null, meta: {} }), { status: 200 }),
    );
    const onEstimate = vi.fn();
    render(<EstimateWithAi text="2 eggs" existingEntryId="3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23" onEstimate={onEstimate} />);
    fireEvent.click(screen.getByRole('button', { name: /Estimate with AI/ }));
    await waitFor(() => expect(onEstimate).toHaveBeenCalledWith(draft));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/mobile/food/voice-parse');
    expect(JSON.parse(init.body as string)).toEqual({
      transcript: '2 eggs',
      source: 'text',
      skip_fallback_save: true,
      existing_entry_id: '3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23',
    });
  });

  it('shows the server message inline on the AI limit and tracks it; the text is untouched', async () => {
    vi.spyOn(nutritionClient, 'textParse').mockRejectedValue(
      new ApiError("You've used your 3 free AI logs today — go Pro for unlimited.", 'UPGRADE_REQUIRED', { limit: 3 }),
    );
    const onEstimate = vi.fn();
    render(<EstimateWithAi text="latte" surface="manual_form" onEstimate={onEstimate} />);
    fireEvent.click(screen.getByRole('button', { name: /Estimate with AI/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('go Pro for unlimited');
    expect(onEstimate).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AI Limit Reached', properties: { feature: 'voice_log', source: 'manual_form' } }),
    );
  });

  it('treats a draft with no foods as an inline error, not an estimate', async () => {
    vi.spyOn(nutritionClient, 'textParse').mockResolvedValue({ ...draft, items: [] });
    const onEstimate = vi.fn();
    render(<EstimateWithAi text="hello there" onEstimate={onEstimate} />);
    fireEvent.click(screen.getByRole('button', { name: /Estimate with AI/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't find a food/i);
    expect(onEstimate).not.toHaveBeenCalled();
  });
});

describe('AiEstimateNote', () => {
  it('lists the assumptions under an "AI estimate" label', () => {
    render(<AiEstimateNote assumptions={['2 large eggs', 'Scrambled in 1 tsp butter']} />);
    expect(screen.getByText(/AI estimate/)).toBeInTheDocument();
    expect(screen.getByText('2 large eggs')).toBeInTheDocument();
    expect(screen.getByText('Scrambled in 1 tsp butter')).toBeInTheDocument();
  });

  it('shows just the label when nothing was assumed', () => {
    render(<AiEstimateNote assumptions={[]} />);
    expect(screen.getByText(/AI estimate/)).toBeInTheDocument();
    expect(screen.queryByText('We assumed:')).toBeNull();
  });
});
