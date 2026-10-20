/**
 * Sentence-buffered streaming guard (docs/FITZY_V2_SPEC.md §3.1). Model chunks
 * are accumulated; complete sentences are released only after the guard has
 * passed on ALL visible text so far, so unsafe text is never emitted. The meta
 * block (and any partial marker) is held back and never emitted.
 */
import { META_MARKER, partialMarkerTail } from './meta';

export type GuardEvent = { type: 'delta'; text: string } | { type: 'replace'; text: string };

const BOUNDARY = /[.!?…](?=\s)|\n/g;

export class StreamGuard {
  private raw = '';
  private emitted = '';
  private tripped = false;
  private metaStarted = false;

  constructor(
    private readonly guard: (text: string) => boolean,
    private readonly safeFallback: string
  ) {}

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
    const visible = this.visible();
    let cut = this.emitted.length;
    if (final || this.metaStarted) {
      cut = visible.length;
    } else {
      BOUNDARY.lastIndex = this.emitted.length;
      let m: RegExpExecArray | null;
      while ((m = BOUNDARY.exec(visible))) cut = m.index + m[0].length;
    }
    if (cut <= this.emitted.length) return [];
    let next = visible.slice(this.emitted.length, cut);
    // Don't emit leading/trailing whitespace-only chunks at the very end.
    if (final || this.metaStarted) next = next.replace(/\s+$/, '');
    if (!next) return [];
    const candidate = this.emitted + next;
    if (this.guard(candidate)) return this.fail();
    this.emitted = candidate;
    return [{ type: 'delta', text: next }];
  }
}
