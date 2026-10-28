import { describe, expect, it } from 'vitest';

import { hasEmoji, stripEmoji, stripEmojiOrNull } from '../strip-emoji';

describe('stripEmoji', () => {
  it.each([
    ['Nice work 🔥', 'Nice work'],
    ['Nice work 🔥!', 'Nice work!'],
    ['🎉 Big day', 'Big day'],
    ['Snack idea 🥚', 'Snack idea'],
    ['Water break? 💧', 'Water break?'],
    ['Stretch 🧘‍♀️ then rest', 'Stretch then rest'],
    ['Thumbs 👍🏽 up', 'Thumbs up'],
    ['Flags 🇺🇸 too', 'Flags too'],
    ['Keycap 1️⃣ gone', 'Keycap gone'],
    ['Heart ❤️ and star ⭐', 'Heart and star'],
    ['Line one 🔥\nLine two ✅', 'Line one\nLine two'],
    ['(🔥) tidy', '() tidy'],
  ])('%j → %j', (input, expected) => {
    expect(stripEmoji(input)).toBe(expected);
    expect(hasEmoji(stripEmoji(input))).toBe(false);
  });

  it('returns text without emoji unchanged (same string)', () => {
    const s = 'Plain text — with a dash, 3 numbers 1 2, and a → arrow.';
    expect(stripEmoji(s)).toBe(s);
    expect(hasEmoji(s)).toBe(false);
  });

  it('keeps © ® ™', () => {
    expect(hasEmoji('FitCircle™')).toBe(false);
    expect(stripEmoji('FitCircle™ 🔥')).toBe('FitCircle™');
  });

  it('handles empty values', () => {
    expect(stripEmoji('')).toBe('');
    expect(stripEmoji(null)).toBeNull();
    expect(stripEmojiOrNull('🔥')).toBeNull();
    expect(stripEmojiOrNull(undefined)).toBeNull();
    expect(stripEmojiOrNull('ok 🔥')).toBe('ok');
  });
});

describe('removeEmojiInline', () => {
  it('keeps the fragment edges (streamed deltas)', async () => {
    const { removeEmojiInline } = await import('../strip-emoji');
    expect(removeEmojiInline('Try oats 🥣. ')).toBe('Try oats. ');
    expect(removeEmojiInline(' and fruit 🍓\n')).toBe(' and fruit\n');
    expect(removeEmojiInline('plain ')).toBe('plain ');
  });
});
