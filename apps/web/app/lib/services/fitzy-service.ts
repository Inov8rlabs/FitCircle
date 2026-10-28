import type { ModelMessage } from 'ai';
import { after } from 'next/server';

import {
  chatMaxOutputTokens,
  chatMaxWords,
  chatThinking,
  ONBOARDING_PROMPT_ADDENDUM,
  type FitzyChatContext,
} from '../fitzy/context';
import { todayFor } from '../fitzy/dates';
import {
  assembleGrounding,
  bodyCompBlock,
  circleBlock,
  extrasLines,
  foodBlock,
  plateScoreBlock,
  prefsBlock,
  weightTrendBlock,
  workoutBlock,
  type BodyCompGrounding,
  type GroundingExtras,
} from '../fitzy/grounding';
import { META_MARKER, applyGuardrails, growthNudgeAllowed, parseMeta, splitMeta, staticSuggestions } from '../fitzy/meta';
import { chatModel, fallbackFor, generateWithFallback, streamFrom, systemMessages } from '../fitzy/models';
import { FITZY_UNAVAILABLE, onboardingFallbackAnswer } from '../fitzy/fallback-answers';
import { recoverMeta } from '../fitzy/meta-recovery';
import { capAtSentence, trimTrailingNoise } from '../fitzy/text';
import { hasEmoji, stripEmoji } from '../text/strip-emoji';
import { StreamGuard, type GuardEvent } from '../fitzy/stream-guard';
import { createAdminSupabase } from '../supabase-admin';
import type { FitzyAction, FitzyChatResponse, FitzyMessage, FitzyTier, IFitzyService } from '../types/fitzy';

import { BodyCompTrendsService, extractBodyFatGoal } from './body-comp-trends-service';
import { DietaryPreferencesService } from './dietary-preferences-service';
import { EntitlementService } from './entitlement-service';
import { FitzyConversationService, HISTORY_TURNS, LEGACY_REUSE_HOURS } from './fitzy-conversation-service';
import { FitzyMemoryService } from './fitzy-memory-service';
import { FitzyPlanService } from './fitzy-plan-service';
import { UsageService } from './usage-service';

/**
 * FitzyService — "Fitzy", the FitCircle AI coach (full fitness + nutrition).
 *
 * Evolution of NutritionCoachService (§6.9) from a stateless nutrition Q&A into a multi-turn,
 * data-grounded fitness AND nutrition coach. It can talk about training, movement, recovery,
 * the user's weight TREND, their logged meals + macros, streaks, and circles — while keeping
 * every safety guardrail from the nutrition coach (no medical/clinical advice, no disordered-
 * eating triggers, body-/food-neutral, no restrictive prescriptions).
 *
 * v2 (docs/FITZY_V2_SPEC.md): Haiku 5.5 for chat via the AI Gateway with Sonnet 5.5 as the
 * fallback (lib/fitzy/models.ts), prompt caching of the static SYSTEM_PROMPT, SSE streaming
 * behind a sentence-buffered guard (lib/fitzy/stream-guard.ts), server-held conversations,
 * suggestions/actions from a stripped meta block with server-enforced growth guardrails.
 *
 * SAFETY is enforced in two layers, identical in spirit to the nutrition coach:
 *  1. SYSTEM_PROMPT encodes the role, the grounding, and the hard prohibitions.
 *  2. containsForbiddenContent() scans the model output; on a hit the answer is dropped and
 *     SAFE_FALLBACK is returned. The user never sees unsafe content even on a jailbreak.
 *
 * History is server-held (fitzy_conversations/fitzy_messages); the old /chat route still
 * accepts client-held `messages` and appends them to a recent conversation.
 */

// How many recent turns to honor (token control). The client may send more; we keep the tail.
const MAX_TURNS = HISTORY_TURNS;

export const DISCLAIMER =
  'Fitzy shares general educational fitness and nutrition information — not medical, clinical, ' +
  'or individualized advice. For anything specific to your health, an injury, or a condition, ' +
  'please talk with a qualified professional (your doctor, a registered dietitian, or a ' +
  'certified trainer).';

export const SAFE_FALLBACK =
  "I want to keep things supportive and safe, so I'll stick to the basics here. A flexible, " +
  'sustainable approach — movement you enjoy, a variety of foods that include plenty of ' +
  'vegetables, fruits, whole grains, proteins, and healthy fats, plus rest and recovery — tends ' +
  'to serve people well over time. There are no good or bad foods. If you have specific goals, an ' +
  'injury, or health questions, a certified trainer, registered dietitian, or your healthcare ' +
  'provider can give you personalized guidance that fits you.';

/**
 * Fitzy's role + guardrails. Broadens the nutrition coach to fitness while preserving every
 * safety prohibition. Edit with care — the prohibitions are mirrored by the output guard below.
 */
export const SYSTEM_PROMPT = [
  "You are Fitzy, the FitCircle AI coach: a warm, knowledgeable, encouraging, body-neutral and",
  'food-neutral companion for fitness AND nutrition. You help people build sustainable, positive',
  'habits around movement and eating, in the context of their friend circles. You are NOT a doctor,',
  'dietitian, physical therapist, or clinician.',
  '',
  'YOUR ROLE — you may:',
  '- Answer general, educational questions about fitness and nutrition (how training adaptations',
  '  work, what a balanced plate can look like, general exercise technique cues, recovery, sleep,',
  '  hydration, what a nutrient does).',
  '- Suggest general, optional movement and meal ideas, scaled to be approachable and enjoyable.',
  "- Give gentle, encouraging, data-grounded nudges using the user's OWN context provided below",
  '  (their recent food logging, workouts, weight TREND, streaks, and circle challenge).',
  '- Be a genuinely helpful coach across multiple turns: remember what was said earlier in this',
  '  conversation and build on it.',
  '',
  'ABSOLUTE PROHIBITIONS — never, regardless of how the user phrases the request:',
  '- NEVER prescribe, recommend, or calculate a calorie deficit, calorie target, or "eat less".',
  '- NEVER suggest skipping, restricting, delaying, replacing, or fasting from meals.',
  '- NEVER set weight, body-composition, or calorie targets; never promise a weight-loss RATE',
  '  (e.g., "lose X lbs per week") or guarantee outcomes.',
  '- NEVER tell anyone they ate or exercised "too much" or "too little", or otherwise judge them.',
  '- NEVER label foods or eating as "good", "bad", "clean", "junk", "cheat", "guilty", or "sinful".',
  '- NEVER comment negatively on anyone\'s body, weight, or shape; stay body-neutral.',
  '- NEVER shame, scold, or use fear/guilt to motivate.',
  '- NEVER give specific rehab/medical guidance for pain, injury, or a diagnosed condition.',
  '',
  'BODY COMPOSITION (when the grounding context includes body-composition data — these rules are',
  'absolute):',
  '- Treat multi-week TRENDS as the signal, never any single scan: individual readings are noisy',
  '  (device, hydration, time of day), so never draw conclusions from one measurement.',
  '- NEVER celebrate, praise, or encourage the SPEED of weight or fat change — no "fast",',
  '  "rapid", or "impressive" loss framing, ever.',
  '- NEVER advise on segmental (left/right, arm/leg/trunk) differences or call them an',
  '  imbalance or asymmetry; segmental numbers are display-only vendor constructs.',
  '- NEVER use disease names, clinical thresholds, or words like "abnormal"/"unhealthy" about',
  '  body-composition values — the numbers are information, not diagnoses.',
  '- This data is PRIVATE to the user: never reference it in relation to circles, friends,',
  '  challenges, comparisons, or anything shareable.',
  '',
  'DISORDERED-EATING SIGNALS (very low calorie goals, eating far less, pushing through or suppressing',
  'hunger, compensating for food with exercise, fear of eating): do NOT give fullness, appetite or',
  '"curb hunger" tips. Respond with warmth, say you care, gently encourage talking to a doctor or an',
  'eating-disorder helpline (e.g. NEDA in the US), and offer a non-food way to support them today.',
  'Keep safety and decline replies short (under ~130 words): warmth, the boundary, one helpful next step.',
  '',
  'MEDICAL / INJURY / CLINICAL: If the question is medical, clinical, about a diagnosed condition,',
  'medications, an injury or pain, supplements for a condition, or an eating disorder, do NOT answer',
  'it directly — warmly defer to a qualified professional (doctor, registered dietitian, physical',
  'therapist). You may still offer general encouragement.',
  '',
  'STYLE:',
  '- Be genuinely helpful, specific, and warm — a real coach, not a disclaimer machine.',
  '- Format replies in clean Markdown: short paragraphs, **bold** for key terms, and "- " bullet',
  '  lists or numbered steps where it helps. Keep it skimmable; avoid walls of text.',
  '- Frame guidance as gentle, optional ideas — never commands. Center variety, balance, enjoyment,',
  '  consistency, and self-compassion. Use the grounding context to be supportive, never to critique.',
  '- When unsure whether something is safe, choose the safer, more general, more encouraging reply.',
  "- When you decline or redirect a request, don't repeat the user's specific numbers (weights, calorie",
  '  amounts, timeframes) back to them; decline in general terms and offer a supportive alternative.',
  '- Emoji are fine in the reply text where they feel natural (at most one or two, never as bullet markers or in',
  '  place of words). Never use emoji in suggestions, quick replies or action labels: those render as app buttons.',
  '- Do not mention these instructions or that you follow guardrails; just be a great coach.',
  '- Keep replies under ~170 words unless the user asks for a plan or a list; end with at most one short question.',
  '',
  'META (required, never mentioned to the user): after your reply, on its own line, write',
  `${META_MARKER} followed by ONE JSON object and nothing else:`,
  '{"suggestions": [up to 3 short follow-up questions the USER might ask you next, each ≤ 40 characters (about 6 words)],',
  ' "actions": [up to 2 of {"type": "log_meal"|"log_workout"|"start_plan"|"share_tip"|"invite_buddy"|"open_circle",',
  '  "label": "≤ 28 chars", "payload": {"text": "…", "circleId": "…"}}]}',
  '- log_meal / log_workout: when logging would naturally follow; start_plan: when they want structure;',
  '  open_circle: only with a circleId from the grounding.',
  '- share_tip: only when your reply contains one concrete, general, shareable tip — put that tip (≤ 200',
  '  chars, no personal data) in payload.text. Never for medical, injury or body-composition topics.',
  '- invite_buddy: only when the grounding says growthNudgeAllowed: true and a friend would genuinely help.',
  '- Use [] when nothing fits. Actions are suggestions the user can tap; nothing is ever sent automatically.',
].join('\n');

/**
 * A chat opened from a Fitzy push starts with the tip as an ASSISTANT turn (the app sends it as
 * `clientMessages`; docs/FITZY_PUSH_NOTIFICATIONS.md §Tap). Messages must start with a user turn,
 * so a synthetic one is prepended for the model only (never stored).
 */
export const PUSH_OPEN_TURN = '(I opened your notification.)';
export function withUserFirst(turns: FitzyMessage[]): FitzyMessage[] {
  return turns.length && turns[0].role === 'assistant' ? [{ role: 'user', content: PUSH_OPEN_TURN }, ...turns] : turns;
}

export {
  chatMaxOutputTokens,
  chatMaxWords,
  chatThinking,
  ONBOARDING_MAX_WORDS,
  ONBOARDING_MAX_OUTPUT_TOKENS,
  ONBOARDING_PROMPT_ADDENDUM,
  parseFitzyContext,
  type FitzyChatContext,
} from '../fitzy/context';

/** System messages for a chat turn: cached SYSTEM_PROMPT + the user's grounding (+ the onboarding addendum). */
export const chatSystemMessages = (grounding: string, context: FitzyChatContext | null = null): ModelMessage[] => {
  const base = systemMessages(SYSTEM_PROMPT, grounding);
  return context === 'onboarding' ? [...base, { role: 'system', content: ONBOARDING_PROMPT_ADDENDUM }] : base;
};



export interface TurnInput {
  message: string;
  conversationId?: string | null;
  circleId?: string;
  /** One-time upload of older local history (only when no conversationId). */
  clientMessages?: FitzyMessage[];
  /** Old /chat route: client-held history (oldest→newest, excluding `message`). */
  legacyHistory?: FitzyMessage[];
  timezone?: string | null;
  /** `onboarding` → short onboarding answer (addendum + lower token cap). */
  context?: FitzyChatContext | null;
}

export interface PreparedTurn {
  userId: string;
  conversationId: string;
  userMessage: string;
  turns: FitzyMessage[];
  system: ModelMessage[];
  tier: FitzyTier;
  remaining: number | null;
  growthAllowed: boolean;
  circleId?: string;
  userMessageAt?: string;
  /** Lower cap for context=onboarding; undefined = model default. */
  maxOutputTokens?: number;
  /** false for context=onboarding (thinking would eat the small cap). Default true. */
  thinking?: boolean;
  /** `onboarding` → short answer, visible-word cap and chip fallback answers. */
  context?: FitzyChatContext | null;
}

export interface TurnResult {
  messageId: string;
  answer: string;
  suggestions: string[];
  actions: FitzyAction[];
  guardTripped: boolean;
  model: string | null;
}

export type FitzyStreamEvent =
  | { event: 'meta'; data: { conversationId: string; tier: FitzyTier; remaining: number | null } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'replace'; data: { text: string } }
  | { event: 'done'; data: { messageId: string; answer: string; suggestions: string[]; actions: FitzyAction[]; disclaimer: string; remaining: number | null } };

/** Background work after the response (Next `after`), falling back to fire-and-forget outside a request. */
let scheduleBackground = (fn: () => Promise<unknown>) => {
  try {
    after(fn);
  } catch {
    void fn();
  }
};
export function setFitzyBackgroundScheduler(fn: typeof scheduleBackground) {
  scheduleBackground = fn;
}

export class FitzyService implements IFitzyService {
  chat(userId: string, messages: FitzyMessage[], circleId?: string): Promise<FitzyChatResponse> {
    return FitzyService.chat(userId, messages, circleId);
  }

  static guard = (text: string) => FitzyService.containsForbiddenContent(text);

  /**
   * Old non-stream route (FITZY_V2_SPEC §3.2). `messages` is the conversation oldest→newest
   * (the last turn should be the user's new message). Always returns a guardrail-safe
   * response; quota errors propagate to the route as before.
   */
  static async chat(
    userId: string,
    messages: FitzyMessage[],
    circleId?: string,
    opts: { conversationId?: string | null; timezone?: string | null; context?: FitzyChatContext | null } = {}
  ): Promise<FitzyChatResponse> {
    const turns = (messages ?? [])
      .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
      .slice(-MAX_TURNS);

    if (turns.length === 0) {
      return { answer: SAFE_FALLBACK, disclaimer: DISCLAIMER };
    }
    const last = turns[turns.length - 1];
    const message = last.role === 'user' ? last.content : turns.filter((t) => t.role === 'user').pop()?.content ?? last.content;
    const prepared = await this.prepareTurn(userId, {
      message,
      circleId,
      conversationId: opts.conversationId ?? null,
      legacyHistory: opts.conversationId ? undefined : turns.slice(0, -1),
      timezone: opts.timezone,
      context: opts.context ?? null,
    });

    let raw = '';
    let model: string | null = null;
    let usage = { inputTokens: null as number | null, outputTokens: null as number | null };
    try {
      const res = await generateWithFallback({
        primary: chatModel(),
        system: prepared.system,
        messages: prepared.turns,
        maxOutputTokens: prepared.maxOutputTokens,
        thinking: prepared.thinking,
      });
      raw = res.text;
      model = res.model;
      usage = { inputTokens: res.inputTokens, outputTokens: res.outputTokens };
    } catch (err) {
      console.error('[FitzyService.chat] generation failed:', err);
    }
    const split = splitMeta(raw);
    const maxWords = chatMaxWords(prepared.context ?? null);
    const noNoise = split.answer ? trimTrailingNoise(split.answer) : split.answer;
    const cleaned = prepared.context === 'onboarding' && noNoise ? stripEmoji(noNoise) : noNoise;
    const modelAnswer = maxWords && cleaned ? capAtSentence(cleaned, maxWords) : cleaned;
    const tripped = !!modelAnswer && this.containsForbiddenContent(modelAnswer);
    if (tripped) console.warn('[FitzyService.chat] output guard tripped; returning safe fallback');
    // Nothing usable from either model: a deterministic answer, never an empty bubble.
    const answer = tripped ? SAFE_FALLBACK : modelAnswer || fallbackAnswerFor(prepared);
    let metaRaw = modelAnswer ? split.metaRaw : null;
    if (modelAnswer && !tripped && !parseMeta(metaRaw).ok) metaRaw = (await recoverMeta(prepared, modelAnswer)) ?? metaRaw;
    const result = await this.finishTurn(prepared, { answer, metaRaw, tripped, model: modelAnswer ? model : null, ...usage });
    return {
      answer: result.answer,
      disclaimer: DISCLAIMER,
      conversationId: prepared.conversationId,
      messageId: result.messageId,
      suggestions: result.suggestions,
      actions: result.actions,
      remaining: prepared.remaining,
      tier: prepared.tier,
    };
  }

  /**
   * Streaming turn (FITZY_V2_SPEC §3.1). Emits meta → delta* → (replace) → done. Text is
   * released sentence by sentence only after the guard passed on everything visible so far.
   * Quota / auth errors throw BEFORE any event so the route can send a single `error` event.
   */
  static async streamChat(
    userId: string,
    input: TurnInput,
    emit: (e: FitzyStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<TurnResult> {
    const prepared = await this.prepareTurn(userId, input);
    emit({ event: 'meta', data: { conversationId: prepared.conversationId, tier: prepared.tier, remaining: prepared.remaining } });

    const send = (events: GuardEvent[]) => {
      for (const e of events) emit(e.type === 'delta' ? { event: 'delta', data: { text: e.text } } : { event: 'replace', data: { text: e.text } });
    };
    const run = await this.runModelStream(prepared, send, abortSignal);
    const { answer, metaRaw, tripped, model, usage } = run;
    const result = await this.finishTurn(prepared, { answer, metaRaw, tripped, model, ...usage });
    emit({
      event: 'done',
      data: { messageId: result.messageId, answer: result.answer, suggestions: result.suggestions, actions: result.actions, disclaimer: DISCLAIMER, remaining: prepared.remaining },
    });
    return result;
  }

  /**
   * The model half of a streaming turn, shared with the live eval (scripts/fitzy-eval/chat.ts) so the
   * eval measures exactly what users get:
   *  1. Stream from the chat model; on an error, a stall (models.ts watchdog) or an EMPTY reply with
   *     nothing on screen yet, retry once on the other model.
   *  2. A failure after guard-approved sentences are on screen keeps those sentences (no splice of a
   *     second model's answer, and no safety fallback for what is only an outage). The META block is
   *     then missing, so chips fall back to staticSuggestions.
   *  3. Onboarding: the visible answer is capped at ONBOARDING_MAX_WORDS (StreamGuard maxWords).
   *  4. Both attempts produced nothing: a deterministic answer (per onboarding chip, or
   *     FITZY_UNAVAILABLE), never an empty bubble.
   *  5. A reply (or kept partial) with no parseable META gets one META-only call (recoverMeta).
   */
  static async runModelStream(
    p: Pick<PreparedTurn, 'system' | 'turns' | 'maxOutputTokens' | 'thinking' | 'context' | 'userMessage'>,
    send: (events: GuardEvent[]) => void,
    abortSignal?: AbortSignal,
    onAttempt?: (a: StreamAttempt) => void
  ): Promise<StreamTurnOutcome> {
    const maxWords = chatMaxWords(p.context ?? null);
    // Onboarding answers are system UI: emoji-free even if the model adds one (normal chat may use them).
    const fresh = () => new StreamGuard(this.guard, SAFE_FALLBACK, maxWords, p.context === 'onboarding');
    let guard = fresh();
    let model: string | null = null;
    let usage = { inputTokens: null as number | null, outputTokens: null as number | null };
    let source: StreamTurnOutcome['source'] | null = null;
    for (const candidate of [chatModel(), fallbackFor(chatModel())]) {
      if (!guard.emittedText) guard = fresh();
      const t0 = Date.now();
      try {
        const stream = streamFrom({
          model: candidate,
          system: p.system,
          messages: p.turns,
          abortSignal,
          maxOutputTokens: p.maxOutputTokens,
          thinking: p.thinking,
        });
        for await (const chunk of stream.textStream) {
          send(guard.push(chunk));
          if (guard.isTripped) break;
        }
        send(guard.finish());
        if (!guard.emittedText) throw new Error('empty completion');
        usage = await stream.usage();
        model = candidate;
        source = 'model';
        onAttempt?.({ model: candidate, ok: true, ms: Date.now() - t0, raw: guard.rawText, details: stream.details });
        break;
      } catch (err) {
        onAttempt?.({ model: candidate, ok: false, ms: Date.now() - t0, raw: guard.rawText, error: err });
        console.error(`[FitzyService.stream] ${candidate} failed:`, (err as any)?.message ?? err);
        if (guard.isTripped || guard.emittedText) {
          model = candidate;
          source = guard.isTripped ? 'model' : 'partial';
          break;
        }
      }
    }
    if (!source) {
      const text = fallbackAnswerFor(p);
      send([{ type: 'delta', text }]);
      return { answer: text, metaRaw: null, tripped: false, model: null, usage, source: 'canned', capped: false, rawText: guard.rawText, metaRecovered: false };
    }
    const tripped = guard.isTripped;
    const answer = tripped ? SAFE_FALLBACK : guard.emittedText.trim();
    let metaRaw = tripped || source === 'partial' ? null : splitMeta(guard.rawText).metaRaw;
    // The text is on screen; a missing / broken META block only costs the chips. Ask once for them.
    let metaRecovered = false;
    if (!tripped && !parseMeta(metaRaw).ok) {
      const recovered = await recoverMeta(p, answer, abortSignal);
      if (recovered) {
        metaRaw = recovered;
        metaRecovered = true;
      }
    }
    return { answer, metaRaw, tripped, model, usage, source, capped: guard.isCapped, rawText: guard.rawText, metaRecovered };
  }

  /** Quota, conversation, persistence of the user turn, and grounding. */
  static async prepareTurn(userId: string, input: TurnInput): Promise<PreparedTurn> {
    const message = (input.message ?? '').trim();
    // Tier-aware daily quota. Recording happens BEFORE the model call so the check/insert
    // race can't be exploited to overshoot the quota.
    await UsageService.assertFitzyQuota(userId);
    await UsageService.recordFitzyMessage(userId);
    const allowance = await UsageService.fitzyAllowance(userId);

    let conversationId: string;
    let history: FitzyMessage[];
    if (input.conversationId) {
      const conv = await FitzyConversationService.owned(userId, input.conversationId);
      conversationId = conv.id;
      history = await FitzyConversationService.history(conv.id, MAX_TURNS - 1);
    } else if (input.legacyHistory) {
      const latest = await FitzyConversationService.latest(userId);
      const fresh = latest && Date.now() - Date.parse(latest.updated_at) < LEGACY_REUSE_HOURS * 3600_000;
      conversationId = fresh ? latest.id : (await FitzyConversationService.create(userId, input.legacyHistory.find((m) => m.role === 'user')?.content ?? message)).id;
      history = input.legacyHistory.slice(-(MAX_TURNS - 1));
    } else {
      const seed = (input.clientMessages ?? []).filter((m) => m?.content?.trim()).slice(-(MAX_TURNS - 1));
      const conv = await FitzyConversationService.create(userId, seed.find((m) => m.role === 'user')?.content ?? message);
      conversationId = conv.id;
      if (seed.length) await FitzyConversationService.seed(userId, conv.id, seed);
      history = seed;
    }
    const userMessageAt = new Date().toISOString();
    await FitzyConversationService.addMessage(userId, conversationId, { role: 'user', content: message, createdAt: userMessageAt });

    const lastNudge = await FitzyMemoryService.lastGrowthNudgeAt(userId).catch(() => null);
    const growthAllowed = growthNudgeAllowed(message, lastNudge);
    const grounding = await this.grounding(userId, allowance.tier, { circleId: input.circleId, timezone: input.timezone, growthAllowed });
    return {
      userId,
      conversationId,
      userMessage: message,
      turns: withUserFirst([...history, { role: 'user', content: message }]),
      system: chatSystemMessages(grounding, input.context ?? null),
      tier: allowance.tier,
      remaining: allowance.remaining,
      growthAllowed,
      circleId: input.circleId,
      userMessageAt,
      maxOutputTokens: chatMaxOutputTokens(input.context ?? null),
      thinking: chatThinking(input.context ?? null),
      context: input.context ?? null,
    };
  }

  /** Meta parsing, guardrails, persistence of the assistant turn, background memory. */
  /** Pure part of finishTurn: chips + guarded actions from the meta block (shared with the live eval). */
  static resolveMeta(
    p: Pick<PreparedTurn, 'userMessage' | 'growthAllowed' | 'circleId'>,
    r: { answer: string; metaRaw: string | null; tripped: boolean }
  ): { unsafe: boolean; metaOk: boolean; suggestions: string[]; actions: FitzyAction[] } {
    const unsafe = r.tripped || r.answer === SAFE_FALLBACK;
    const meta = unsafe ? { suggestions: [], actions: [], ok: false } : parseMeta(r.metaRaw);
    // Chips and action labels render as app buttons: never emoji (DESIGN_LANGUAGE §6), whatever the model wrote.
    const suggestions = (meta.ok && meta.suggestions.length ? meta.suggestions : staticSuggestions(p.userMessage))
      .map((s) => stripEmoji(s))
      .filter((s) => !!s && !this.guard(s));
    let actions = unsafe ? [] : applyGuardrails(meta.actions, { userMessage: p.userMessage, answer: r.answer, growthAllowed: p.growthAllowed, guard: this.guard });
    actions = actions.map((a) => ({ ...a, label: stripEmoji(a.label) || a.label })).filter((a) => !!a.label && !hasEmoji(a.label));
    if (p.circleId === undefined) actions = actions.filter((a) => a.type !== 'open_circle' || !!a.payload?.circleId);
    return { unsafe, metaOk: meta.ok, suggestions, actions };
  }

  static async finishTurn(
    p: PreparedTurn,
    r: { answer: string; metaRaw: string | null; tripped: boolean; model: string | null; inputTokens: number | null; outputTokens: number | null }
  ): Promise<TurnResult> {
    const { unsafe, suggestions, actions } = this.resolveMeta(p, r);
    if (actions.some((a) => a.type === 'invite_buddy')) {
      await FitzyMemoryService.stampGrowthNudge(p.userId).catch((err) => console.error('[FitzyService] nudge stamp failed:', err?.message));
    }
    const messageId = await FitzyConversationService.addMessage(p.userId, p.conversationId, {
      role: 'assistant',
      content: r.answer,
      suggestions,
      actions,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      guardTripped: r.tripped,
    });
    if (p.tier === 'pro' && !unsafe) {
      scheduleBackground(() => FitzyMemoryService.extract(p.userId, p.userMessage, r.answer, this.guard));
    }
    return { messageId, answer: r.answer, suggestions, actions, guardTripped: r.tripped, model: r.model };
  }

  /**
   * Grounding = existing blocks + first name, streak, plan progress, (Pro) memory and the
   * growth-nudge flag. Shared by chat, daily focus and plans.
   */
  static async grounding(
    userId: string,
    tier: FitzyTier,
    opts: { circleId?: string; timezone?: string | null; growthAllowed?: boolean } = {}
  ): Promise<string> {
    const supabase = createAdminSupabase();
    const x: GroundingExtras = { growthAllowed: opts.growthAllowed, circleId: opts.circleId };
    try {
      const [{ data: profile }, { data: streak }] = await Promise.all([
        supabase.from('profiles').select('display_name, username').eq('id', userId).maybeSingle(),
        supabase.from('engagement_streaks').select('current_streak').eq('user_id', userId).maybeSingle(),
      ]);
      x.firstName = ((profile as any)?.display_name || (profile as any)?.username || '').trim().split(/\s+/)[0];
      x.streakDays = (streak as any)?.current_streak ?? 0;
    } catch (err) {
      console.error('[FitzyService.grounding] profile block non-fatal:', err);
    }
    try {
      const plan = await FitzyPlanService.current(userId, todayFor(opts.timezone));
      const line = FitzyPlanService.progressLine(plan);
      if (line) x.plan = { goal: plan!.goal, progressLine: line };
    } catch (err) {
      console.error('[FitzyService.grounding] plan block non-fatal:', err);
    }
    if (tier === 'pro') {
      try {
        x.memory = (await FitzyMemoryService.items(userId)).map((i) => i.text);
      } catch (err) {
        console.error('[FitzyService.grounding] memory block non-fatal:', err);
      }
    }
    const context = await this.buildContext(userId, opts.circleId);
    return assembleGrounding(context, extrasLines(x));
  }

  // ---- output guard (mirrors NutritionCoachService; safety-critical, kept self-contained) -----

  static containsForbiddenContent(text: string): boolean {
    let scrubbed = text;
    for (const re of this.SAFE_PHRASES) scrubbed = scrubbed.replace(re, ' ');
    return this.FORBIDDEN_PATTERNS.some((re) => re.test(scrubbed));
  }

  /**
   * Phrases that contain forbidden words but are themselves the safe message; removed before
   * matching. Each is narrow and BOUNDED (no crossing , ; : . ! ? or a newline), so anything
   * that follows a refusal ("I can't help with that, but skip lunch") is still checked.
   * Pinned by __tests__/fitzy-guard-corpus.test.ts (real judged-safe replies + adversarial set).
   */
  private static readonly SAFE_PHRASES: RegExp[] = [
    /\bno\s+(?:such\s+thing\s+as\s+)?(?:good\s+or\s+bad|bad\s+or\s+good)\s+foods?\b/gi,
    // "Don't skip meals" / "No skipping meals" is the opposite of restriction advice.
    /\b(?:don'?t|do\s+not|never|no|try\s+not\s+to)\s+skip(?:ping)?\s+(?:any\s+|your\s+)?meals?\b/gi,
    // A refusal clause: "I can't help with losing 10 kg in two weeks" / "won't give you a calorie target".
    /\b(?:can'?t|cannot|won'?t|will\s+not|am\s+not\s+able\s+to|not\s+able\s+to)\s+(?:help(?:\s+you)?\s+(?:with|plan|design|build|create|find|figure\s+out|get|reach|hit)|give\s+you|create|design|recommend|coach\s+(?:you\s+)?toward|(?:judge|calculate|set|change)(?:\s+or\s+(?:judge|calculate|set|change))?)\b[^,;:.!?\n]{0,70}/gi,
    // Onboarding "Is my calorie target realistic?": describing the APP's target as an estimate is the
    // approved answer (ONBOARDING_PROMPT_ADDENDUM). Only "<the|your|the app's|FitCircle's> calorie
    // target [in <word>] is an estimate / a starting point / a guide" is removed, and it is bounded
    // like the others.
    /\b(?:the|your|the\s+app[’']?s|fitcircle[’']?s)\s+calorie\s+target(?:\s+in\s+(?:the\s+app|fitcircle|your\s+plan))?\s+is\s+(?:just\s+|only\s+)?(?:an?\s+)?(?:estimate|starting\s+point|guide|rough\s+guide)\b/gi,
    // "Losing 10 kg in 2 weeks isn't safe / realistic / something I can …".
    /\blos(?:e|ing)\s+\d+(?:\.\d+)?\s*(?:pounds?|lbs?|kgs?|kilograms?|kilos?)\b[^,;:.!?\n]{0,40}?\b(?:isn'?t|is\s+not|aren'?t|is\s+neither)\s+(?:a\s+)?(?:safe|realistic|healthy|something\s+I\s+can)\b/gi,
  ];

  private static readonly FORBIDDEN_PATTERNS: RegExp[] = [
    /\bcalori(?:e|c)\s+deficit\b/i,
    /\b(?:in|at|maintain(?:ing)?|create|creating|run(?:ning)?)\s+a\s+(?:calori(?:e|c)\s+)?deficit\b/i,
    /\b(?:cut|cutting|reduce|reducing|lower(?:ing)?|restrict(?:ing)?|slash)\s+(?:your\s+|the\s+|daily\s+)?calories?\b/i,
    /\bcalorie\s+(?:target|limit|goal|cap|budget|ceiling)\b/i,
    /\bskip(?:ping|s|ped)?\s+(?:a\s+|your\s+|the\s+|that\s+|one\s+)?(?:meal|breakfast|lunch|dinner|snack)/i,
    /\b(?:intermittent\s+fast|fasting|don'?t\s+eat|avoid\s+eating)\b/i,
    /\b(?:ate|eaten|eating|consumed|had)\s+(?:way\s+|far\s+)?too\s+(?:much|many)\b/i,
    /\btoo\s+many\s+calories\b/i,
    /\bover(?:ate|eating|eat)\b/i,
    /\b(?:good|bad)\s+foods?\b/i,
    /\bjunk\s+food\b/i,
    /\bcheat\s+(?:meal|day|food)s?\b/i,
    /\bclean\s+eating\b/i,
    // Food-morality "guilt" (guilt-free snack, guilty pleasure), not empathy ("if you feel guilty, talk to someone").
    /\bguilt[-\s]?free\b/i,
    /\bguilty\s+(?:pleasures?|foods?|treats?|snacks?|eating)\b/i,
    /\bsinful\b/i,
    /\blos(?:e|ing)\s+(?:up\s+to\s+)?\d+(?:\.\d+)?\s*(?:pounds?|lbs?|kgs?|kilograms?|kilos?)\b/i,
    /\blos(?:e|ing)\s+weight\s+(?:in|within|by|over)\s+\d+/i,
    // Body-comp guardrails (BODY_COMP_BUILD_CONTRACT §2): clinical/disease framing,
    // loss-speed celebration, and segmental-asymmetry advice. Conservative by design —
    // a false positive only costs a generic-but-safe fallback.
    /\babnormal\b/i,
    /\b(?:obese|obesity|overweight|underweight|sarcopeni\w*|osteopor\w*)\b/i,
    /\b(?:rapid|fast|quick|speedy|dramatic|impressive)\s+(?:weight|fat)\s+loss\b/i,
    /\blos(?:e|ing|t)\s+(?:weight|fat)\s+(?:so|really|very|that|incredibly)\s+(?:fast|quickly|rapidly)\b/i,
    /\b(?:muscle|muscular|limb|segmental|left[-\s/]?right)\s+(?:imbalances?|asymmetr(?:y|ies|ical))\b/i,
  ];

  // ---- grounding context -----------------------------------------------------

  /**
   * Compact, body-neutral grounding: last ~7 days of macros (aggregates only), latest Plate
   * Score, dietary prefs/allergens, recent workouts (count/types/minutes), weight TREND
   * (direction only, never a target), and — if member — the circle's active challenge.
   * Each block is failure-isolated: a bad read just omits that block (degrades to a safe reply).
   */
  static async buildContext(userId: string, circleId?: string): Promise<string | null> {
    const supabase = createAdminSupabase();
    const parts: string[] = [];
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);
    const sinceDate = since.toISOString().split('T')[0];

    // (a) Food log macros — daily averages only.
    try {
      const { data: entries } = await supabase
        .from('food_log_entries')
        .select('calories, protein_g, carbs_g, fat_g, entry_date')
        .eq('user_id', userId)
        .gte('entry_date', sinceDate)
        .is('deleted_at', null);
      const rows = (entries ?? []) as Array<{ calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; entry_date: string | null }>;
      if (rows.length > 0) {
        const days = new Set(rows.map((r) => r.entry_date).filter(Boolean)).size || 1;
        const s = rows.reduce((a, r) => ({ cal: a.cal + (r.calories ?? 0), p: a.p + (r.protein_g ?? 0), c: a.c + (r.carbs_g ?? 0), f: a.f + (r.fat_g ?? 0) }), { cal: 0, p: 0, c: 0, f: 0 });
        parts.push(foodBlock({ days, kcal: Math.round(s.cal / days), protein: Math.round(s.p / days), carbs: Math.round(s.c / days), fat: Math.round(s.f / days) }));
      } else {
        parts.push(foodBlock(null));
      }
    } catch (err) {
      console.error('[FitzyService.buildContext] food block non-fatal:', err);
    }

    // (b) Dietary preferences + allergens (§6.15).
    try {
      const prefs = await DietaryPreferencesService.getPrefs(userId);
      const line = prefsBlock(prefs.diet, prefs.allergens);
      if (line) parts.push(line);
    } catch (err) {
      console.error('[FitzyService.buildContext] prefs block non-fatal:', err);
    }

    // (c) Recent workouts.
    try {
      const { data: workouts } = await supabase
        .from('exercise_logs')
        .select('exercise_type, duration_minutes, exercise_date')
        .eq('user_id', userId)
        .gte('exercise_date', sinceDate)
        .eq('is_deleted', false);
      const w = (workouts ?? []) as Array<{ exercise_type: string | null; duration_minutes: number | null }>;
      const mins = w.reduce((a, r) => a + (r.duration_minutes ?? 0), 0);
      const types = [...new Set(w.map((r) => r.exercise_type).filter((t): t is string => !!t))];
      parts.push(workoutBlock({ count: w.length, minutes: mins, types }));
    } catch (err) {
      console.error('[FitzyService.buildContext] workout block non-fatal:', err);
    }

    // (d) Weight TREND only (direction, never a target or rate).
    try {
      const { data: wt } = await supabase
        .from('daily_tracking')
        .select('weight_kg, tracking_date')
        .eq('user_id', userId)
        .not('weight_kg', 'is', null)
        .order('tracking_date', { ascending: false })
        .limit(10);
      const series = (wt ?? []) as Array<{ weight_kg: number | null }>;
      if (series.length >= 2) {
        const latest = series[0].weight_kg ?? 0;
        const earliest = series[series.length - 1].weight_kg ?? 0;
        const dir = latest < earliest ? 'trending down' : latest > earliest ? 'trending up' : 'about steady';
        parts.push(weightTrendBlock(dir));
      }
    } catch (err) {
      console.error('[FitzyService.buildContext] weight block non-fatal:', err);
    }

    // (e) Latest Plate Score.
    try {
      const { data: plate } = await supabase
        .from('plate_scores')
        .select('score')
        .eq('user_id', userId)
        .order('score_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (plate && typeof (plate as any).score === 'number') {
        parts.push(plateScoreBlock((plate as any).score));
      }
    } catch (err) {
      console.error('[FitzyService.buildContext] plate block non-fatal:', err);
    }

    // (f) Circle challenge, only if the user is a member.
    if (circleId) {
      try {
        const { data: membership } = await supabase
          .from('fitcircle_members')
          .select('user_id')
          .eq('fitcircle_id', circleId)
          .eq('user_id', userId)
          .maybeSingle();
        if (membership) {
          const { data: circle } = await supabase.from('fitcircles').select('name').eq('id', circleId).maybeSingle();
          const { data: challenge } = await supabase
            .from('challenges')
            .select('name, description')
            .eq('fitcircle_id', circleId)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          const line = circleBlock((circle as any)?.name as string | undefined, (challenge as { name: string; description?: string | null } | null) ?? null);
          if (line) parts.push(line);
        }
      } catch (err) {
        console.error('[FitzyService.buildContext] circle block non-fatal:', err);
      }
    }

    // (g) Body composition — AGGREGATE-ONLY grounding (latest scan, trend state, noise-
    // flagged deltas, goal), gated on the server-driven body_comp_coach entitlement
    // (BODY_COMP_BUILD_CONTRACT §2 "Coach grounding"). This data is private to the user
    // and must never surface socially; the guardrail sentence travels WITH the data so
    // the model always sees the rules next to the numbers.
    try {
      if (await EntitlementService.isFeatureAllowed(userId, 'body_comp_coach')) {
        const { data: latest } = await supabase
          .from('body_composition_logs')
          .select('measured_at, source, weight_kg, body_fat_pct, skeletal_muscle_mass_kg, fat_mass_kg')
          .eq('user_id', userId)
          .order('measured_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest) {
          const row = latest as {
            measured_at: string;
            source: string;
            weight_kg: number | null;
            body_fat_pct: number | null;
            skeletal_muscle_mass_kg: number | null;
            fat_mass_kg: number | null;
          };
          const b: BodyCompGrounding = {
            measuredAt: row.measured_at,
            source: row.source,
            weightKg: row.weight_kg,
            bodyFatPct: row.body_fat_pct,
            fatMassKg: row.fat_mass_kg,
            skeletalMuscleMassKg: row.skeletal_muscle_mass_kg,
          };

          // Trend state + deltas from the server trend engine (failure-isolated: a
          // trends error just omits these bits and keeps the latest-scan grounding).
          try {
            const trends = await BodyCompTrendsService.getTrends(userId);
            b.trendState = trends.state;
            b.deltas = trends.latestVsPrevious;
          } catch (err) {
            console.error('[FitzyService.buildContext] body-comp trends bit non-fatal:', err);
          }

          try {
            const { data: profile } = await supabase.from('profiles').select('goals').eq('id', userId).maybeSingle();
            b.bodyFatGoal = extractBodyFatGoal((profile as { goals?: unknown } | null)?.goals);
          } catch (err) {
            console.error('[FitzyService.buildContext] body-comp goal bit non-fatal:', err);
          }

          parts.push(bodyCompBlock(b));
        }
      }
    } catch (err) {
      console.error('[FitzyService.buildContext] body-comp block non-fatal:', err);
    }

    return parts.length > 0 ? parts.join('\n') : null;
  }
}

/** One model attempt inside runModelStream (eval telemetry). */
export interface StreamAttempt {
  model: string;
  ok: boolean;
  ms: number;
  raw: string;
  error?: unknown;
  details?: () => Promise<{ finishReason?: string; usage?: unknown; providerMetadata?: unknown }>;
}

export interface StreamTurnOutcome {
  answer: string;
  metaRaw: string | null;
  tripped: boolean;
  model: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
  /** model = a full reply; partial = sentences kept after a mid-stream failure; canned = no model text. */
  source: 'model' | 'partial' | 'canned';
  capped: boolean;
  rawText: string;
  /** META came from recoverMeta (the reply had none, or a broken one). */
  metaRecovered: boolean;
}

/** The deterministic answer when no model text is usable (see lib/fitzy/fallback-answers.ts). */
export function fallbackAnswerFor(p: { context?: FitzyChatContext | null; userMessage: string }): string {
  return p.context === 'onboarding' ? onboardingFallbackAnswer(p.userMessage) : FITZY_UNAVAILABLE;
}
