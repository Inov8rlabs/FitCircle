/**
 * Fitzy reliability (2026-10-28): the stream watchdog that ends stalled gateway streams, the
 * onboarding visible-word cap, and the deterministic fallback answers.
 */
import { describe, expect, it, vi } from 'vitest';

import { hasEmoji } from '../../text/strip-emoji';
import { FITZY_UNAVAILABLE, onboardingFallbackAnswer } from '../fallback-answers';
import { ModelStallError, watchdog, withDeadline } from '../models';
import { StreamGuard } from '../stream-guard';
import { capAtSentence, trimTrailingNoise, wordCount } from '../text';

async function* chunks(items: string[], delays: number[] = []) {
  for (const [i, c] of items.entries()) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    yield c;
  }
}
const never = (): AsyncIterable<string> => ({
  [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<string>>(() => {}) }),
});

describe('watchdog', () => {
  it('passes a healthy stream through', async () => {
    const out: string[] = [];
    for await (const c of watchdog(chunks(['a', 'b', 'c']), { firstChunkMs: 50, idleMs: 50, totalMs: 500 })) out.push(c);
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('fails a stream that never sends a first chunk, and calls onStall (abort)', async () => {
    const onStall = vi.fn();
    const run = async () => {
      for await (const c of watchdog(never(), { firstChunkMs: 20, idleMs: 20, totalMs: 500, onStall })) void c;
    };
    await expect(run()).rejects.toMatchObject({ name: 'ModelStallError', kind: 'first_chunk' });
    expect(onStall).toHaveBeenCalledOnce();
  });

  it('fails a stream that goes quiet after some text (the observed partial-then-hang)', async () => {
    const got: string[] = [];
    const src = (async function* () {
      yield 'First sentence. ';
      await new Promise(() => {});
    })();
    const run = async () => {
      for await (const c of watchdog(src, { firstChunkMs: 50, idleMs: 20, totalMs: 500 })) got.push(c);
    };
    await expect(run()).rejects.toMatchObject({ kind: 'idle' });
    expect(got).toEqual(['First sentence. ']);
  });

  it('enforces the total deadline', async () => {
    const run = async () => {
      for await (const c of watchdog(chunks(['a', 'b', 'c', 'd'], [0, 15, 15, 15]), { firstChunkMs: 50, idleMs: 50, totalMs: 30 })) void c;
    };
    await expect(run()).rejects.toMatchObject({ kind: 'total' });
  });

  it('withDeadline rejects even when the work ignores the abort', async () => {
    let aborted = false;
    await expect(
      withDeadline(20, undefined, (signal) => {
        signal.addEventListener('abort', () => (aborted = true));
        return new Promise(() => {});
      })
    ).rejects.toBeInstanceOf(ModelStallError);
    expect(aborted).toBe(true);
  });
});

describe('capAtSentence / StreamGuard word cap', () => {
  it('cuts at the last sentence or line end that fits', () => {
    const text = 'One two three. Four five six.\n- seven eight nine ten';
    expect(capAtSentence(text, 100)).toBe(text);
    expect(capAtSentence(text, 7)).toBe('One two three. Four five six.');
    expect(capAtSentence('a b c d e f', 3)).toBe('a b c…');
  });

  it('never emits past maxWords and never takes back released text', () => {
    const g = new StreamGuard(() => false, 'SAFE', 10);
    const out: string[] = [];
    for (const c of ['One two three four. ', 'Five six seven. ', 'Eight nine ten eleven twelve. ', 'More text here.']) {
      for (const e of g.push(c)) out.push(e.text);
    }
    for (const e of g.finish()) out.push(e.text);
    const shown = out.join('');
    expect(wordCount(shown)).toBeLessThanOrEqual(10);
    expect(shown).toBe('One two three four. Five six seven.');
    expect(g.isCapped).toBe(true);
  });

  it('keeps collecting the raw text (META) after the cap', () => {
    const g = new StreamGuard(() => false, 'SAFE', 3);
    g.push('One two three. Four five. ');
    g.push('\n<<<FITZY_META>>>{"suggestions":[]}');
    g.finish();
    expect(g.emittedText).toBe('One two three.');
    expect(g.rawText).toContain('FITZY_META');
  });
});

describe('trailing noise', () => {
  it('drops a final letterless line, keeps real text', () => {
    expect(trimTrailingNoise('Start today.\n\n 0 2 4 6')).toBe('Start today.');
    expect(trimTrailingNoise('Start today.\n- Walk 10 minutes')).toBe('Start today.\n- Walk 10 minutes');
    expect(trimTrailingNoise('Only line')).toBe('Only line');
    const g = new StreamGuard(() => false, 'SAFE');
    g.push('Build from there.\n\n 0 2 4 6');
    g.finish();
    expect(g.emittedText.trim()).toBe('Build from there.');
  });
});

describe('fallback answers', () => {
  const chips = [
    'High-protein breakfast ideas?',
    'How do I hit 8,000 steps?',
    'Is my calorie target realistic?',
    'Easy ways to eat more veg?',
    "Healthy snacks I'll actually like?",
    "What's one small habit to start with?",
    'How can friends keep me on track?',
    'Something else entirely',
  ];

  it('every onboarding chip gets a distinct, short, emoji-free, question-free answer', () => {
    const answers = chips.map(onboardingFallbackAnswer);
    expect(new Set(answers).size).toBe(chips.length);
    for (const a of [...answers, FITZY_UNAVAILABLE]) {
      expect(wordCount(a)).toBeLessThanOrEqual(70);
      expect(hasEmoji(a)).toBe(false);
      expect(a).not.toContain('?');
    }
  });
});

describe('emoji policy in the stream (owner decision 2026-10-28)', () => {
  it('onboarding guard (noEmoji) removes emoji from released text, keeping sentence spacing', () => {
    const g = new StreamGuard(() => false, 'SAFE', null, true);
    const out: string[] = [];
    for (const c of ['Try oats 🥣. ', 'Add fruit 🍓!\n', '- Eggs 🍳 on toast']) for (const e of g.push(c)) out.push(e.text);
    for (const e of g.finish()) out.push(e.text);
    expect(out.join('')).toBe('Try oats. Add fruit!\n- Eggs on toast');
    expect(g.emittedText).toBe('Try oats. Add fruit!\n- Eggs on toast');
  });

  it('normal chat keeps emoji in the reply text', () => {
    const g = new StreamGuard(() => false, 'SAFE');
    g.push('Nice work 💪. ');
    g.finish();
    expect(g.emittedText.trim()).toBe('Nice work 💪.');
  });
});
