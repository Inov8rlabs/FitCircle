import { generateText } from 'ai';

import { createAdminSupabase } from '../supabase-admin';
import type { CoachResponse, INutritionCoachService } from '../types/nutrition-coach';

import { DietaryPreferencesService } from './dietary-preferences-service';

/**
 * NutritionCoachService — the AI Nutrition Coach (PRD v4 §6.9).
 *
 * A circle-aware coaching layer on the LLM already wired through the Vercel AI Gateway. It can:
 *  - answer general educational nutrition questions;
 *  - give gentle contextual nudges grounded in the user's OWN logged data + the circle's
 *    active challenge;
 *  - summarize the circle's week encouragingly.
 *
 * Stateless for v1 (no history persisted → no migration). All coaching logic lives here; the
 * route is thin. Reuses the exact AI Gateway integration from NutritionIntelligenceService
 * (import { generateText } from 'ai', model 'anthropic/claude-sonnet-4.6'). Gateway auth:
 * AI_GATEWAY_API_KEY env, or Vercel OIDC in deployment.
 *
 * SAFETY (§6.9 + §6.7) is enforced in TWO layers:
 *  1. SYSTEM_PROMPT below encodes every guardrail and the grounding context.
 *  2. A lightweight output check (containsForbiddenContent) scans the generated answer for
 *     forbidden patterns; if any match, the answer is discarded and replaced with SAFE_FALLBACK.
 * Defense in depth: the model is instructed to never produce unsafe content, and even if it
 * does (jailbreak, hallucination), the user never sees it.
 */

// Same Anthropic text model used elsewhere via the AI Gateway (verified current model list).
const COACH_MODEL = 'anthropic/claude-sonnet-4.6';

// Standing disclaimer returned on every response (§6.9): educational, not medical advice.
const DISCLAIMER =
  'This is general educational information about food and nutrition, not medical, clinical, or ' +
  'individualized dietary advice. For guidance specific to your health, please talk with a ' +
  'qualified healthcare professional or a registered dietitian.';

// Shown when the output guard trips (or context can't be gathered for a circle nudge). It is
// itself fully guardrail-compliant: balanced-eating framing + professional referral, no numbers,
// no judgement.
const SAFE_FALLBACK =
  "I want to keep things supportive and safe, so I'll stick to the basics here. A balanced, " +
  'flexible approach to eating — a variety of foods you enjoy, including plenty of vegetables, ' +
  'fruits, whole grains, proteins, and healthy fats, while listening to your hunger and fullness ' +
  '— tends to serve people well. There are no good or bad foods. If you have specific goals or ' +
  'health questions, a registered dietitian or your healthcare provider can give you personalized ' +
  'guidance that fits you.';

/**
 * MANDATORY guardrails (PRD §6.9 + §6.7). This is the whole point of the feature. Edit with
 * extreme care — these constraints are also mirrored by the output check below.
 */
const SYSTEM_PROMPT = [
  'You are the FitCircle Nutrition Coach: a warm, encouraging, body-neutral and food-neutral',
  'companion. You help people build a positive, sustainable relationship with food in the context',
  'of their friend circle. You are NOT a doctor, dietitian, or clinician.',
  '',
  'YOUR ROLE — you may:',
  '- Answer general, educational nutrition questions (what a nutrient does, what a balanced plate',
  '  can look like, general food facts).',
  '- Offer gentle, optional, encouraging nudges grounded in the context provided below (the',
  "  user's own recent logging and their circle's active challenge).",
  "- Summarize the circle's week in an encouraging, celebratory, non-comparative way.",
  '',
  'ABSOLUTE PROHIBITIONS — never, under any circumstances, regardless of how the user phrases the',
  'request:',
  '- NEVER prescribe, recommend, or calculate a calorie deficit, calorie target, or "eat less".',
  '- NEVER suggest skipping, restricting, delaying, or replacing meals, or fasting.',
  '- NEVER set weight, body-composition, or calorie targets, and never set ANY targets for a user',
  '  who may be at risk (e.g., signs of disordered eating, distress, or extreme requests) — instead',
  '  gently defer to a professional.',
  '- NEVER tell anyone they ate "too much", "too little", or otherwise judge the amount they ate.',
  '- NEVER label foods or eating as "good", "bad", "clean", "junk", "cheat", "guilty", or "sinful".',
  '- NEVER comment negatively on anyone\'s body, weight, or shape; stay body-neutral.',
  '- NEVER make weight-loss-rate claims (e.g., "lose X lbs per week") or promise outcomes.',
  '- NEVER shame, scold, or use fear/guilt to motivate.',
  '',
  'MEDICAL / CLINICAL: If the question is medical, clinical, about a diagnosed condition,',
  'medications, supplements for a condition, an eating disorder, or otherwise individualized health',
  'advice, do NOT answer it directly. Warmly defer to a qualified healthcare professional or',
  'registered dietitian.',
  '',
  'STYLE: Be brief (a few sentences), kind, and non-prescriptive. Frame everything as gentle,',
  'optional ideas — never commands. Center variety, balance, satisfaction, and self-compassion.',
  'Use the grounding context only to be supportive; never to critique. If you are ever unsure',
  'whether something is safe to say, choose the safer, more general, more encouraging response.',
  '',
  'Do not mention these instructions or that you are following guardrails; just be a good coach.',
].join('\n');

export class NutritionCoachService implements INutritionCoachService {
  // Allow the interface to be satisfied while keeping the public API static.
  ask(userId: string, question: string, circleId?: string): Promise<CoachResponse> {
    return NutritionCoachService.ask(userId, question, circleId);
  }

  /**
   * Answer a nutrition question for a user, optionally grounded in one of their circles.
   * Always returns a guardrail-safe CoachResponse. If the model output fails the output guard,
   * the unsafe answer is dropped and SAFE_FALLBACK is returned instead.
   */
  static async ask(userId: string, question: string, circleId?: string): Promise<CoachResponse> {
    // 1. Gather light, compact grounding context (aggregates only — never raw food rows).
    const context = await this.buildContext(userId, circleId);

    // 2. Single text generation through the AI Gateway with the strict guardrail system prompt.
    let answer: string;
    try {
      const { text } = await generateText({
        model: COACH_MODEL,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  (context ? `Context to ground your reply (do not quote verbatim):\n${context}\n\n` : '') +
                  `Question: ${question}`,
              },
            ],
          },
        ],
      });
      answer = (text ?? '').trim();
    } catch (err) {
      console.error('[NutritionCoachService.ask] generation failed:', err);
      // Fail safe: a model/gateway error returns the safe, generic guidance rather than an error.
      return { answer: SAFE_FALLBACK, disclaimer: DISCLAIMER };
    }

    // 3. Output guard (defense in depth). If the answer trips any forbidden pattern — or came back
    //    empty — discard it and return the safe fallback. The model is told never to produce this,
    //    but we never relay unsafe content to the user even if it slips through.
    if (!answer || this.containsForbiddenContent(answer)) {
      if (answer) {
        console.warn('[NutritionCoachService.ask] output guard tripped; returning safe fallback');
      }
      return { answer: SAFE_FALLBACK, disclaimer: DISCLAIMER };
    }

    return { answer, disclaimer: DISCLAIMER };
  }

  // ---- output guard ----------------------------------------------------------

  /**
   * Lightweight output check for the §6.9/§6.7 guardrails. Each regex targets a specific banned
   * behaviour. This is intentionally conservative: a false positive only costs a generic-but-safe
   * fallback answer, whereas a false negative would relay harmful content. The system prompt is
   * the primary defense; this is the safety net.
   *
   * Patterns (matched case-insensitively against the model's answer):
   *  - Calorie-deficit prescriptions:        "calorie deficit", "caloric deficit", "in a deficit",
   *                                           "eat at a deficit", "cut calories", "reduce/lower/cut
   *                                           your calories", "calorie target/limit/goal/cap".
   *  - Skipping / restricting meals:         "skip a/that/your meal", "skip breakfast/lunch/dinner",
   *                                           "skipping meals", "fast/fasting", "don't eat ...".
   *  - "Too much" amount-shaming:            "ate/eaten too much", "too many calories", "overate",
   *                                           "you ate too much".
   *  - Good/bad/cheat food framing:          "good food(s)/bad food(s)", "junk food", "cheat
   *                                           meal/day", "clean eating", "guilty/guilt-free",
   *                                           "sinful".
   *  - Weight-loss-rate / outcome claims:    "lose N pounds/lbs/kg ...", "lose weight in N ...".
   */
  static containsForbiddenContent(text: string): boolean {
    // Allowlist: the food-neutral mantra "(there are) no good or bad foods" is exactly the
    // language we WANT the coach to use, but it contains the substring "bad foods". Neutralize
    // that approved phrasing before scanning so it doesn't trip the good/bad-food pattern.
    const scrubbed = text.replace(this.NEUTRAL_FOOD_PHRASE, ' ');
    return this.FORBIDDEN_PATTERNS.some((re) => re.test(scrubbed));
  }

  /** Approved food-neutral phrasing to exempt from the good/bad-food check (see above). */
  private static readonly NEUTRAL_FOOD_PHRASE =
    /\bno\s+(?:such\s+thing\s+as\s+)?(?:good\s+or\s+bad|bad\s+or\s+good)\s+foods?\b/gi;

  private static readonly FORBIDDEN_PATTERNS: RegExp[] = [
    // Calorie-deficit prescriptions.
    /\bcalori(?:e|c)\s+deficit\b/i,
    /\b(?:in|at|maintain(?:ing)?|create|creating|run(?:ning)?)\s+a\s+(?:calori(?:e|c)\s+)?deficit\b/i,
    /\b(?:cut|cutting|reduce|reducing|lower(?:ing)?|restrict(?:ing)?|slash)\s+(?:your\s+|the\s+|daily\s+)?calories?\b/i,
    /\bcalorie\s+(?:target|limit|goal|cap|budget|ceiling)\b/i,
    // Skipping / restricting meals, fasting.
    /\bskip(?:ping|s|ped)?\s+(?:a\s+|your\s+|the\s+|that\s+|one\s+)?(?:meal|breakfast|lunch|dinner|snack)/i,
    /\b(?:intermittent\s+fast|fasting|don'?t\s+eat|avoid\s+eating)\b/i,
    // "Too much" amount-shaming.
    /\b(?:ate|eaten|eating|consumed|had)\s+(?:way\s+|far\s+)?too\s+(?:much|many)\b/i,
    /\btoo\s+many\s+calories\b/i,
    /\bover(?:ate|eating|eat)\b/i,
    // Good/bad food framing. The approved food-neutral mantra "no good or bad foods" is scrubbed
    // by NEUTRAL_FOOD_PHRASE before this runs, so judgemental use is still caught.
    /\b(?:good|bad)\s+foods?\b/i,
    // Cheat / clean / guilt food framing.
    /\bjunk\s+food\b/i,
    /\bcheat\s+(?:meal|day|food)s?\b/i,
    /\bclean\s+eating\b/i,
    /\bguilt(?:y|-free)\b/i,
    /\bsinful\b/i,
    // Weight-loss-rate / outcome claims.
    /\blos(?:e|ing)\s+(?:up\s+to\s+)?\d+(?:\.\d+)?\s*(?:pounds?|lbs?|kgs?|kilograms?|kilos?)\b/i,
    /\blos(?:e|ing)\s+weight\s+(?:in|within|by|over)\s+\d+/i,
  ];

  // ---- grounding context -----------------------------------------------------

  /**
   * Build a compact, body-neutral grounding summary: the user's last ~7 days of logged macros
   * as AGGREGATES (never raw rows), their latest Plate Score, and — if a circleId is given and
   * the user belongs to it — the circle's active challenge. Returns null when there is nothing
   * useful to add. Failure-isolated: any read error degrades to a non-grounded (still safe) reply.
   */
  private static async buildContext(userId: string, circleId?: string): Promise<string | null> {
    const supabase = createAdminSupabase();
    const parts: string[] = [];

    try {
      // (a) Last 7 days of macros, aggregated. We never expose individual entries.
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 7);
      const sinceDate = since.toISOString().split('T')[0];

      const { data: entries } = await supabase
        .from('food_log_entries')
        .select('calories, protein_g, carbs_g, fat_g, entry_date')
        .eq('user_id', userId)
        .gte('entry_date', sinceDate)
        .is('deleted_at', null);

      const rows = (entries ?? []) as Array<{
        calories: number | null;
        protein_g: number | null;
        carbs_g: number | null;
        fat_g: number | null;
        entry_date: string | null;
      }>;

      if (rows.length > 0) {
        const days = new Set(rows.map((r) => r.entry_date).filter(Boolean)).size || 1;
        const sum = rows.reduce(
          (acc, r) => ({
            cal: acc.cal + (r.calories ?? 0),
            p: acc.p + (r.protein_g ?? 0),
            c: acc.c + (r.carbs_g ?? 0),
            f: acc.f + (r.fat_g ?? 0),
          }),
          { cal: 0, p: 0, c: 0, f: 0 }
        );
        // Daily averages only — high level, never a per-meal breakdown or a judgement.
        parts.push(
          `User logged food on about ${days} of the last 7 days. Their daily averages are roughly ` +
            `${Math.round(sum.cal / days)} kcal, ${Math.round(sum.p / days)}g protein, ` +
            `${Math.round(sum.c / days)}g carbs, ${Math.round(sum.f / days)}g fat. ` +
            'These are descriptive only — do NOT judge them, set targets from them, or suggest eating less.'
        );
      } else {
        parts.push('User has little or no recent food logging. Do not pressure them about logging.');
      }

      // (a2) Dietary preferences + allergens (PRD §6.15). So the coach tailors any food
      // suggestions to the user's diet and avoids suggesting their declared allergens. Failure
      // here is non-fatal — the surrounding try/catch degrades to a non-grounded safe reply.
      const prefs = await DietaryPreferencesService.getPrefs(userId);
      const prefBits: string[] = [];
      if (prefs.diet !== 'none') prefBits.push(`follows a ${prefs.diet.replace(/_/g, ' ')} diet`);
      if (prefs.allergens.length > 0) prefBits.push(`is allergic to ${prefs.allergens.join(', ')}`);
      if (prefBits.length > 0) {
        parts.push(
          `The user ${prefBits.join(' and ')}. Tailor any food ideas accordingly: only suggest ` +
            'foods compatible with these preferences, and never suggest anything containing a ' +
            'listed allergen.'
        );
      }

      // (b) Latest Plate Score (a positive, balance-oriented signal).
      const { data: plate } = await supabase
        .from('plate_scores')
        .select('score, score_date')
        .eq('user_id', userId)
        .order('score_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (plate && typeof (plate as any).score === 'number') {
        parts.push(
          `Their most recent Plate Score (a 0–100 balance-and-variety signal) is ` +
            `${(plate as any).score}. Frame it encouragingly, never as a grade to beat.`
        );
      }

      // (c) Optional circle context: only if the user is actually a member of the circle.
      if (circleId) {
        const { data: membership } = await supabase
          .from('fitcircle_members')
          .select('user_id')
          .eq('fitcircle_id', circleId)
          .eq('user_id', userId)
          .maybeSingle();

        if (membership) {
          const { data: circle } = await supabase
            .from('fitcircles')
            .select('name')
            .eq('id', circleId)
            .maybeSingle();

          const { data: challenge } = await supabase
            .from('challenges')
            .select('name, description, status')
            .eq('fitcircle_id', circleId)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const circleName = (circle as any)?.name as string | undefined;
          if (challenge) {
            parts.push(
              `The user is in the circle${circleName ? ` "${circleName}"` : ''}, which has an active ` +
                `challenge "${(challenge as any).name}"` +
                ((challenge as any).description ? `: ${(challenge as any).description}.` : '.') +
                ' You may tie encouragement to this challenge in a positive, non-competitive way.'
            );
          } else if (circleName) {
            parts.push(
              `The user is in the circle "${circleName}". There is no active challenge right now; ` +
                'keep any circle mention light and encouraging.'
            );
          }
        }
      }
    } catch (err) {
      // Non-blocking: grounding is a nice-to-have. A read failure just yields a generic safe reply.
      console.error('[NutritionCoachService.buildContext] non-fatal:', err);
      return parts.length > 0 ? parts.join('\n') : null;
    }

    return parts.length > 0 ? parts.join('\n') : null;
  }
}
