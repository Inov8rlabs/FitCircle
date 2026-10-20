/**
 * Model meta block (docs/FITZY_V2_SPEC.md §4): every reply ends with
 * `<<<FITZY_META>>>` + one JSON object `{ suggestions, actions }`. The server
 * strips it (never streamed), parses tolerantly, validates, and enforces the
 * growth guardrails itself.
 */
import type { FitzyAction, FitzyActionType } from '../types/fitzy';

export const META_MARKER = '<<<FITZY_META>>>';
export const ACTION_TYPES: readonly FitzyActionType[] = ['log_meal', 'log_workout', 'start_plan', 'share_tip', 'invite_buddy', 'open_circle'];
export const MAX_SUGGESTIONS = 3;
export const MAX_ACTIONS = 2;
export const GROWTH_NUDGE_DAYS = 7;

/** Visible answer (before the marker) + raw meta (after it, or null). */
export function splitMeta(text: string): { answer: string; metaRaw: string | null } {
  const i = text.indexOf(META_MARKER);
  if (i < 0) return { answer: text.trim(), metaRaw: null };
  return { answer: text.slice(0, i).trim(), metaRaw: text.slice(i + META_MARKER.length).trim() };
}

/** Length of a trailing prefix of the marker (e.g. "…<<<FIT") that must be held back while streaming. */
export function partialMarkerTail(text: string): number {
  for (let n = Math.min(META_MARKER.length - 1, text.length); n > 0; n--) {
    if (META_MARKER.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

const cp = (s: string) => [...s].length;

/** Tolerant JSON: first {...} block, code fences and trailing commas allowed. */
function looseJson(raw: string): any {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = cleaned.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function parseMeta(raw: string | null): { suggestions: string[]; actions: FitzyAction[]; ok: boolean } {
  if (!raw) return { suggestions: [], actions: [], ok: false };
  const j = looseJson(raw);
  if (!j || typeof j !== 'object') return { suggestions: [], actions: [], ok: false };
  const suggestions = (Array.isArray(j.suggestions) ? j.suggestions : [])
    .filter((s: unknown): s is string => typeof s === 'string')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0 && cp(s) <= 40)
    .slice(0, MAX_SUGGESTIONS);
  const actions: FitzyAction[] = [];
  for (const a of Array.isArray(j.actions) ? j.actions : []) {
    if (!a || typeof a !== 'object') continue;
    if (!(ACTION_TYPES as readonly string[]).includes(a.type)) continue;
    const label = typeof a.label === 'string' ? a.label.trim() : '';
    if (!label || cp(label) > 28) continue;
    const payload: FitzyAction['payload'] = {};
    if (a.payload && typeof a.payload === 'object') {
      if (typeof a.payload.text === 'string' && a.payload.text.trim()) payload.text = a.payload.text.trim().slice(0, 280);
      if (typeof a.payload.circleId === 'string' && a.payload.circleId.trim()) payload.circleId = a.payload.circleId.trim().slice(0, 100);
    }
    if (actions.some((x) => x.type === a.type)) continue;
    actions.push({ type: a.type, label, ...(Object.keys(payload).length ? { payload } : {}) });
    if (actions.length >= MAX_ACTIONS) break;
  }
  return { suggestions, actions, ok: true };
}

// ---------------------------------------------------------------- guardrails

const SENSITIVE = /\b(pain|painful|hurts?|hurting|injur\w*|sprain\w*|strain(?:ed)?|tendon\w*|surgery|rehab\w*|medic\w*|medication\w*|meds|prescri\w*|diagnos\w*|condition|doctor|physio\w*|body[\s-]?fat|fat\s+mass|body[\s-]?comp\w*|muscle\s+mass|scan|dexa|bmi)\b/i;
const GROWTH_TOPIC = /\b(motivat\w*|accountab\w*|consisten\w*|stick\s+(?:to|with)|keep\s+(?:going|it\s+up|up)|habit\w*|friends?|buddy|buddies|partner|together|circle|crew|plan|planning|routine|lazy|give\s+up|on\s+track|streak)\b/i;

/** Medical / injury / medication / body-comp context in the user message or the answer. */
export const isSensitiveContext = (...texts: string[]) => texts.some((t) => SENSITIVE.test(t ?? ''));

/** The user's message is about motivation, accountability, consistency, friends or a plan. */
export const isGrowthTopic = (message: string) => GROWTH_TOPIC.test(message ?? '');

export function growthNudgeAllowed(message: string, lastNudgeAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!isGrowthTopic(message)) return false;
  if (!lastNudgeAt) return true;
  return now.getTime() - Date.parse(lastNudgeAt) >= GROWTH_NUDGE_DAYS * 86_400_000;
}

/**
 * Server-enforced action rules: share_tip never in sensitive contexts;
 * invite_buddy only when allowed; start_plan for free users stays (it opens the paywall);
 * payload text runs through the guard. Returns the kept actions.
 */
export function applyGuardrails(
  actions: FitzyAction[],
  ctx: { userMessage: string; answer: string; growthAllowed: boolean; guard: (text: string) => boolean }
): FitzyAction[] {
  const sensitive = isSensitiveContext(ctx.userMessage, ctx.answer);
  return actions.filter((a) => {
    if (a.type === 'share_tip' && (sensitive || !a.payload?.text)) return false;
    if (a.type === 'invite_buddy' && !ctx.growthAllowed) return false;
    if (a.payload?.text && ctx.guard(a.payload.text)) return false;
    if (ctx.guard(a.label)) return false;
    return true;
  });
}

const STATIC_SUGGESTIONS: Array<{ re: RegExp; items: string[] }> = [
  { re: /\b(eat|meal|food|dinner|lunch|breakfast|protein|snack|recipe|vegetarian|vegan)\b/i, items: ['Another quick dinner idea?', 'High-protein breakfast ideas?', 'Make it vegetarian?'] },
  { re: /\b(workout|exercise|train|run|walk|gym|strength|cardio|steps|yoga)\b/i, items: ['A 20-min home workout?', 'How do I warm up?', 'Make it easier?'] },
  { re: /\b(sleep|tired|energy|rest|recover)\b/i, items: ['Tips to wind down?', 'Does sleep affect energy?', 'A gentle recovery day?'] },
  { re: /\b(motivat|consisten|habit|plan|stuck|lazy)\b/i, items: ['Plan my week', 'Help me stay consistent', 'Small win for today?'] },
];
const DEFAULT_SUGGESTIONS = ['Plan my week', 'Quick dinner idea', '20-min workout'];

/** Fallback suggestions when the meta block is missing or unparseable. */
export function staticSuggestions(message: string): string[] {
  return STATIC_SUGGESTIONS.find((s) => s.re.test(message ?? ''))?.items ?? DEFAULT_SUGGESTIONS;
}
