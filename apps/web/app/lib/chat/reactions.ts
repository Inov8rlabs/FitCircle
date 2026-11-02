// Circle Chat Reactions v2 — pure reaction-value rules shared by the service,
// the routes and the web chat UI (docs/CHAT_REACTIONS_V2.md). No I/O here.
//
// A reaction value is either a named kind (`clap`, `muscle`, …) or exactly one
// emoji. Named kinds are canonical: the emoji of a named kind ("👏", or "❤"
// without the variation selector) is stored as the kind. Skin-tone variants
// ("👏🏽") are kept as custom emoji so the reactor's choice is preserved.

import {
  CHAT_REACTION_KINDS,
  CHEER_REACTION_KINDS,
  CUSTOM_REACTION_MAX_BYTES,
  REACTION_EMOJI,
  type ChatReactionKind,
  type ChatReactionValue,
} from '@/lib/types/circle-chat';

const KIND_SET: ReadonlySet<string> = new Set(CHAT_REACTION_KINDS);

const VARIATION_SELECTOR_16 = /️/g;

/** Named-kind emoji (with and without VS16) → kind. */
const EMOJI_TO_KIND: ReadonlyMap<string, ChatReactionKind> = (() => {
  const map = new Map<string, ChatReactionKind>();
  for (const kind of CHAT_REACTION_KINDS) {
    const emoji = REACTION_EMOJI[kind];
    map.set(emoji, kind);
    map.set(emoji.replace(VARIATION_SELECTOR_16, ''), kind);
  }
  return map;
})();

// RGI emoji (Unicode property of strings, `v` flag — Node 20+, current browsers).
// Older engines fall back to an Extended_Pictographic / flag / keycap check.
const RGI_EMOJI: RegExp | null = (() => {
  try {
    return new RegExp('^\\p{RGI_Emoji}$', 'v');
  } catch {
    return null;
  }
})();
const FALLBACK_EMOJI =
  /^(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[0-9#*]️?⃣)$/u;

function graphemeCount(value: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let n = 0;
    for (const _ of segmenter.segment(value)) n += 1;
    return n;
  }
  return Array.from(value).length;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** True for exactly one emoji grapheme of at most CUSTOM_REACTION_MAX_BYTES bytes. */
export function isSingleEmoji(value: string): boolean {
  if (!value || utf8Bytes(value) > CUSTOM_REACTION_MAX_BYTES) return false;
  if (graphemeCount(value) !== 1) return false;
  return RGI_EMOJI ? RGI_EMOJI.test(value) : FALLBACK_EMOJI.test(value);
}

export function isNamedReactionKind(value: string): value is ChatReactionKind {
  return KIND_SET.has(value);
}

/**
 * Client input → the stored value: a named kind (also when the client sent that
 * kind's emoji) or a single custom emoji. Returns null for anything else.
 */
export function canonicalizeChatReaction(input: unknown): ChatReactionValue | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return null;
  if (isNamedReactionKind(value)) return value;
  const named = EMOJI_TO_KIND.get(value) ?? EMOJI_TO_KIND.get(value.replace(VARIATION_SELECTOR_16, ''));
  if (named) return named;
  return isSingleEmoji(value) ? value : null;
}

/** The emoji to draw for a stored value (named kind → its emoji; custom → itself). */
export function reactionEmoji(value: string): string {
  return isNamedReactionKind(value) ? REACTION_EMOJI[value] : value;
}

/** clap / same / muscle read as a cheer ("cheered your message"). */
export function isCheerReaction(value: string): boolean {
  return CHEER_REACTION_KINDS.has(value);
}

/** The analytics `reaction` property: the kind, or "custom" (never the raw emoji). */
export function reactionAnalyticsValue(value: string): string {
  return isNamedReactionKind(value) ? value : 'custom';
}
