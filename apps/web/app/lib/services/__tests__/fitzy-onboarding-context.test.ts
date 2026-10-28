import { describe, expect, it } from 'vitest';

import {
  chatMaxOutputTokens,
  chatThinking,
  chatSystemMessages,
  ONBOARDING_MAX_OUTPUT_TOKENS,
  ONBOARDING_PROMPT_ADDENDUM,
  parseFitzyContext,
  SYSTEM_PROMPT,
} from '../fitzy-service';

describe('Fitzy onboarding context', () => {
  it('parses only "onboarding" (case/space-insensitive); everything else is normal chat', () => {
    expect(parseFitzyContext('onboarding')).toBe('onboarding');
    expect(parseFitzyContext(' Onboarding ')).toBe('onboarding');
    for (const v of [undefined, null, '', 'settings', 'onboarding_v2', 42]) expect(parseFitzyContext(v)).toBeNull();
  });

  it('system messages: cached base prompt, grounding, then the addendum last', () => {
    const normal = chatSystemMessages('GROUNDING');
    expect(normal.map((m) => m.content)).toEqual([SYSTEM_PROMPT, 'GROUNDING']);
    const onboarding = chatSystemMessages('GROUNDING', 'onboarding');
    expect(onboarding.map((m) => m.content)).toEqual([SYSTEM_PROMPT, 'GROUNDING', ONBOARDING_PROMPT_ADDENDUM]);
    expect(onboarding[0].providerOptions).toBeDefined(); // cache breakpoint kept on the base prompt
    expect(onboarding[2].providerOptions).toBeUndefined();
  });

  it('addendum states the product rules; cap only for onboarding', () => {
    expect(ONBOARDING_PROMPT_ADDENDUM).toMatch(/80 words or fewer/);
    expect(ONBOARDING_PROMPT_ADDENDUM).toMatch(/NO QUESTIONS/);
    expect(ONBOARDING_PROMPT_ADDENDUM).toMatch(/No medical claims/);
    expect(ONBOARDING_PROMPT_ADDENDUM).toMatch(/Never invent statistics/);
    expect(chatMaxOutputTokens('onboarding')).toBe(ONBOARDING_MAX_OUTPUT_TOKENS);
    expect(chatMaxOutputTokens(null)).toBeUndefined();
    expect(chatThinking('onboarding')).toBe(false);
    expect(chatThinking(null)).toBe(true);
  });
});
