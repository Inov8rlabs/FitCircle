/**
 * Sentence-buffered streaming guard (docs/FITZY_V2_SPEC.md §3.1). Model chunks
 * are accumulated; complete sentences are released only after the guard has
 * passed on ALL visible text so far, so unsafe text is never emitted. The meta
 * block (and any partial marker) is held back and never emitted.
 *
 * `maxWords` (onboarding): visible text stops at the last sentence / line end within the budget;
 * anything after is dropped, while the raw text (META block) is still collected.
 */
import { removeEmojiInline } from '../text/strip-emoji';

import { META_MARKER, partialMarkerTail } from './meta';
import { capAtSentence, trimTrailingNoise, wordCount } from './text';

export type GuardEvent = { type: 'delta'; text: string } | { type: 'replace'; text: string };

const BOUNDARY = /[.!?…](?=\s)|\n/g;

export class StreamGuard {
  private raw = '';
  private emitted = '';
  /** How much of the visible model text has been consumed (emitted text may be shorter: trims, emoji removal). */
  private consumed = 0;
  private tripped = false;
  private metaStarted = false;
  private capped = false;

  constructor(
    private readonly guard: (text: string) => boolean,
    private readonly safeFallback: string,
    private readonly maxWords: number | null = null,
    /** Remove emoji from released text (onboarding answers). */
    private readonly noEmoji = false
  ) {}

  /** True when the word budget cut the visible answer. */
  get isCapped() {
    return this.capped;
  }

  get isTripped() {
    return this.tripped;
  }
  get emittedText() {
    return this.emitted;
  }
  get rawText() {
    return this.raw;
  }

  /** Feed a chunk; returns events to send now. */
  push(chunk: string): GuardEvent[] {
    if (this.tripped) return [];
    this.raw += chunk;
    return this.release(false);
  }

  /** End of stream: flush what's left (guarded). */
  finish(): GuardEvent[] {
    if (this.tripped) return [];
    return this.release(true);
  }

  /** Force the safe fallback (e.g. the model failed mid-stream). */
  fail(): GuardEvent[] {
    if (this.tripped) return [];
    this.tripped = true;
    if (this.emitted) {
      this.emitted = this.safeFallback;
      return [{ type: 'replace', text: this.safeFallback }];
    }
    this.emitted = this.safeFallback;
    return [{ type: 'delta', text: this.safeFallback }];
  }

  private visible(): string {
    const i = this.raw.indexOf(META_MARKER);
    if (i >= 0) {
      this.metaStarted = true;
      return this.raw.slice(0, i);
    }
    return this.raw.slice(0, this.raw.length - partialMarkerTail(this.raw));
  }

  private release(final: boolean): GuardEvent[] {
    const raw = this.visible();
    // The answer is complete: drop a trailing letterless line (model noise) before the last release.
    const visible = final || this.metaStarted ? trimTrailingNoise(raw) : raw;
    let cut = this.consumed;
    if (final || this.metaStarted) {
      cut = visible.length;
    } else {
      BOUNDARY.lastIndex = this.consumed;
      let m: RegExpExecArray | null;
      while ((m = BOUNDARY.exec(visible))) cut = m.index + m[0].length;
    }
    if (cut <= this.consumed) return [];
    let next = visible.slice(this.consumed, cut);
    this.consumed = cut;
    // Don't emit leading/trailing whitespace-only chunks at the very end.
    if (final || this.metaStarted) next = next.replace(/\s+$/, '');
    if (this.noEmoji) next = removeEmojiInline(next);
    if (!next || !next.trim() && (final || this.metaStarted)) return [];
    if (this.capped) return [];
    let candidate = this.emitted + next;
    if (this.maxWords != null && wordCount(candidate) > this.maxWords) {
      this.capped = true;
      // Never take back released text: cut only what is new.
      const trimmed = capAtSentence(candidate, this.maxWords);
      if (!trimmed.startsWith(this.emitted) || trimmed.length <= this.emitted.length) return [];
      candidate = trimmed;
      next = candidate.slice(this.emitted.length);
    }
    if (this.guard(candidate)) return this.fail();
    this.emitted = candidate;
    return [{ type: 'delta', text: next }];
  }
}
