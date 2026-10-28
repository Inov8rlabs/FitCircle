/**
 * Fitzy chat contexts (pure; no I/O, safe to import from routes and the eval).
 */
/**
 * Where a chat turn comes from. `onboarding` = the v2 tour's "Ask Fitzy" step
 * (ONBOARDING_V2_EXPERIMENT_SPEC §5.3 step 6): a short, concrete answer for someone in
 * their first minute of the app. Unknown / absent → normal chat.
 */
export type FitzyChatContext = 'onboarding';
export function parseFitzyContext(raw: unknown): FitzyChatContext | null {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'onboarding' ? 'onboarding' : null;
}

/** Appended (uncached, after the grounding) for context=onboarding. The base prompt's rules still apply. */
export const ONBOARDING_PROMPT_ADDENDUM = [
  'ONBOARDING MODE — this person joined FitCircle a minute ago and tapped a suggested question during setup.',
  'These rules OVERRIDE the STYLE section above (its "~170 words" and "end with at most one short question" do NOT apply):',
  '- LENGTH: the whole reply is 80 words or fewer. Shape: one opening sentence (≤ 15 words), then AT MOST 3 "- "',
  '  bullets (never 4 or more) of ≤ 12 words each, then one closing sentence (≤ 8 words). No headings, no extra tips.',
  '- NO QUESTIONS: the reply contains no "?" at all, and never offers more help ("Would you like…", "If you\'d',
  '  like…", "Which…"). The closing sentence is plain encouragement, e.g. "Pick one to try tomorrow."',
  '- No medical claims: no diagnoses, conditions, supplements or medications.',
  '- Never invent statistics, percentages, studies or facts about other people; use only well-established general',
  "  guidance or numbers from the user's own context.",
  "- If they ask whether their FitCircle plan targets are realistic: say the app's numbers are an estimate from the",
  '  details they entered and a starting point they can adjust anytime, and that steady habits matter more than hitting',
  '  a number exactly. Never calculate, change or set a target yourself.',
  '- The META block still follows the reply as usual.',
].join('\n');

/**
 * Output cap for context=onboarding (≈80-word answer + META block, with headroom). Thinking is
 * OFF for these turns: in the live eval (2026-10-28) Haiku's adaptive thinking spent 350–450 of
 * a 450-token cap on reasoning → empty or cut-off replies with no META block.
 */
export const ONBOARDING_MAX_OUTPUT_TOKENS = 500;


/** maxOutputTokens for a chat turn: undefined = the model default (normal chat, unchanged). */
export const chatMaxOutputTokens = (context: FitzyChatContext | null): number | undefined =>
  context === 'onboarding' ? ONBOARDING_MAX_OUTPUT_TOKENS : undefined;

/** Model thinking for a chat turn: off for onboarding (see ONBOARDING_MAX_OUTPUT_TOKENS), default otherwise. */
export const chatThinking = (context: FitzyChatContext | null): boolean => context !== 'onboarding';
