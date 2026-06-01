// Deterministic REPLAY EVAL for the Circle Chat system-post engine.
//
// This is the engine's safety net (Build Spec §8 gate conditions). It drives the
// PURE methods SystemPostEngine.plan() and .renderCopy() with a scripted day of
// signals + explicit stats/nowISO/quiet-hours/eventEnabled, and asserts the exact
// dispositions and copy. It NEVER touches ingest() (which hits the DB) — the whole
// point is that plan/renderCopy are pure so this eval is deterministic and blocks
// merges if post behavior drifts.

import { describe, it, expect } from 'vitest';

import { SystemPostEngine } from '../system-post-engine';
import { NOTIFICATION_TEMPLATES } from '../notification-orchestrator';
import {
  DEFAULT_ENGINE_CONFIG,
  type EnginePlanInput,
  type PlannedPost,
} from '../../types/circle-chat-engine';
import {
  buildPlanInput,
  signalByRef,
  asRecentSameType,
  scriptedDaySignals,
  pinnedCopyCases,
  allEventTypeCopyInputs,
  CIRCLE_ID,
  MIKE,
  SARAH,
  PRIYA,
} from './fixtures/scripted-day';

// One engine instance with the frozen defaults — the eval pins the default config.
const engine = new SystemPostEngine();

const planOne = (input: EnginePlanInput): PlannedPost => {
  const planned = engine.plan(input);
  expect(planned).toHaveLength(1);
  return planned[0];
};

describe('SystemPostEngine replay eval — dispositions (Build Spec §8)', () => {
  it('1. bundling: 3rd same-type workout in window -> post_bundled with all 3 actors + friendly copy', () => {
    // Mike + Sarah already posted within the window; Priya's workout is the 3rd.
    const mike = signalByRef('wo-mike-am');
    const sarah = signalByRef('wo-sarah-am');
    const priya = signalByRef('wo-priya-am');

    const post = planOne(
      buildPlanInput(priya, {
        stats: { recentSameTypeInWindow: asRecentSameType(mike, sarah) },
      })
    );

    expect(post.disposition).toBe('post_bundled');
    expect(post.eventType).toBe('workout_done');
    expect(post.priority).toBe('p2');
    // All three actors, current signal first.
    expect(post.actorUserIds).toEqual([PRIYA.id, MIKE.id, SARAH.id]);
    expect(post.actorUserIds).toHaveLength(3);
    // Friendly bundled copy — current actor (Priya) leads since plan() puts the
    // incoming signal's actor first.
    expect(post.body).toBe('Priya, Mike & Sarah all got moving today 🔥');
    // Spec-pinned ordering example: Mike, Sarah & Priya — assert renderCopy directly.
    expect(
      engine.renderCopy({
        eventType: 'workout_done',
        actors: [{ name: MIKE.name }, { name: SARAH.name }, { name: PRIYA.name }],
      })
    ).toBe('Mike, Sarah & Priya all got moving today 🔥');
    expect(post.bundleOfRefIds).toEqual(['wo-priya-am', 'wo-mike-am', 'wo-sarah-am']);
  });

  it('2. per-member cap: cappable event at/over the cap -> drop_to_summary (no live post)', () => {
    const priyaMidday = signalByRef('wo-priya-midday');

    const post = planOne(
      buildPlanInput(priyaMidday, {
        // No bundling candidates so we exercise the cap branch.
        stats: {
          perMemberRoutineToday: { [PRIYA.id]: DEFAULT_ENGINE_CONFIG.perMemberDailyRoutineCap },
        },
      })
    );

    expect(post.disposition).toBe('drop_to_summary');
    expect(post.eventType).toBe('workout_done');
    // A drop is NOT a live post — no body / actor list emitted.
    expect(post.body).toBeUndefined();
    expect(post.actorUserIds).toBeUndefined();
  });

  it('3. hourly ceiling: p1/p2 event at/over the ceiling -> drop_to_summary', () => {
    // member_joined is p1, ceiling-bound, NOT cappable — isolates the ceiling branch.
    const memberJoined = scriptedDaySignals.find((s) => s.eventType === 'member_joined')!;

    const post = planOne(
      buildPlanInput(memberJoined, {
        stats: { circlePostsThisHour: DEFAULT_ENGINE_CONFIG.circleHourlyCeiling },
      })
    );

    expect(post.disposition).toBe('drop_to_summary');
    expect(post.priority).toBe('p1');
    expect(post.body).toBeUndefined();
  });

  it('4a. P0 bypass: streak_milestone posts even when cap AND ceiling exceeded', () => {
    const streak = signalByRef('streak-priya-14');

    const post = planOne(
      buildPlanInput(streak, {
        stats: {
          perMemberRoutineToday: { [PRIYA.id]: 99 },
          circlePostsThisHour: 99,
        },
      })
    );

    expect(post.disposition).toBe('post');
    expect(post.eventType).toBe('streak_milestone');
    expect(post.priority).toBe('p0');
    expect(post.body).toBe("Priya's on a 14-day streak — nice 🔥");
  });

  it('4b. P0 bypass: challenge_resolved posts even over all limits', () => {
    const post = planOne(
      buildPlanInput(
        {
          fitcircleId: CIRCLE_ID,
          actorUserId: MIKE.id,
          actorName: MIKE.name,
          eventType: 'challenge_resolved',
          refId: 'chal-spring-cut',
          occurredAt: '2026-06-01T20:30:00.000Z',
          payload: { challengeName: 'Spring Cut' },
        },
        {
          stats: { perMemberRoutineToday: { [MIKE.id]: 99 }, circlePostsThisHour: 99 },
        }
      )
    );

    expect(post.disposition).toBe('post');
    expect(post.priority).toBe('p0');
    expect(post.body).toBe("That's a wrap on the Spring Cut! Tap to see how it went 🏆");
  });

  it('4c. P0 in quiet hours -> queued_quiet (row written, push deferred), still not dropped', () => {
    const streak = signalByRef('streak-priya-14');

    const post = planOne(
      buildPlanInput(streak, {
        isQuietHours: true,
        stats: { perMemberRoutineToday: { [PRIYA.id]: 99 }, circlePostsThisHour: 99 },
      })
    );

    expect(post.disposition).toBe('queued_quiet');
    expect(post.priority).toBe('p0');
    expect(post.body).toBe("Priya's on a 14-day streak — nice 🔥");
  });

  it('5. hard exclusion: a weight signal -> suppressed, NEVER posts', () => {
    const weigh = signalByRef('weigh-mike-eve');

    const planned = engine.plan(
      buildPlanInput(weigh, {
        // Even wide-open conditions must not produce a post.
        stats: {},
      })
    );

    expect(planned).toHaveLength(1);
    expect(planned[0].disposition).toBe('suppressed');
    // Assert NO planned post leaks: nothing writable.
    expect(planned[0].body).toBeUndefined();
    expect(planned[0].actorUserIds).toBeUndefined();
    expect(planned.some((p) => p.disposition === 'post' || p.disposition === 'post_bundled' || p.disposition === 'queued_quiet')).toBe(false);
  });

  it('6. config-gated: notable_meal with eventEnabled=false -> suppressed', () => {
    const post = planOne(
      buildPlanInput(
        {
          fitcircleId: CIRCLE_ID,
          actorUserId: PRIYA.id,
          actorName: PRIYA.name,
          eventType: 'notable_meal',
          refId: 'meal-priya',
          occurredAt: '2026-06-01T13:00:00.000Z',
          payload: { mealDescriptor: 'high-protein lunch' },
        },
        { eventEnabled: false }
      )
    );

    expect(post.disposition).toBe('suppressed');
    expect(post.body).toBeUndefined();
  });

  it('7. quiet hours: non-p0 event with isQuietHours=true -> queued_quiet', () => {
    const memberJoined = scriptedDaySignals.find((s) => s.eventType === 'member_joined')!;

    const post = planOne(
      buildPlanInput(memberJoined, { isQuietHours: true })
    );

    expect(post.disposition).toBe('queued_quiet');
    expect(post.priority).toBe('p1');
    expect(post.body).toBe('Sarah just joined — say hi 👋');
  });

  it('baseline: a clean non-p0 workout with no limits hit -> post', () => {
    const mike = signalByRef('wo-mike-am');
    const post = planOne(buildPlanInput(mike));
    expect(post.disposition).toBe('post');
    expect(post.eventType).toBe('workout_done');
    expect(post.body).toBe('Mike just logged a workout 💪');
  });
});

describe('SystemPostEngine replay eval — copy correctness (contract §4 pinned examples)', () => {
  for (const c of pinnedCopyCases) {
    it(`renderCopy: ${c.label} -> exact pinned string`, () => {
      const out = engine.renderCopy({
        eventType: c.eventType,
        actors: c.actors,
        payload: c.payload,
      });
      expect(out).toBe(c.expected);
    });
  }
});

describe('SystemPostEngine replay eval — safety guardrail (Build Spec §7)', () => {
  // Forbidden patterns: body/food-shaming, calorie/weight numbers, restriction ranking.
  const forbiddenPatterns: { name: string; re: RegExp }[] = [
    { name: 'digits adjacent to cal/calorie', re: /\d\s*(cal|calorie|kcal)/i },
    { name: 'cal/calorie adjacent to digits', re: /(cal|calorie|kcal)\w*\s*\d/i },
    { name: 'weight units (lbs/kg/pounds)', re: /\d\s*(lbs?|kg|pounds?)\b/i },
    { name: 'weight units adjacent', re: /\b(lbs?|kg|pounds?)\s*\d/i },
    { name: 'cheat', re: /\bcheat\b/i },
    { name: 'guilt', re: /\bguilt(y)?\b/i },
    { name: 'bad food', re: /\bbad\s+food\b/i },
    { name: 'shame', re: /\bshame(ful)?\b/i },
    { name: 'restriction ranking (least/most restrictive)', re: /\b(least|most)\s+restrictive\b/i },
    { name: 'fattest/skinniest ranking', re: /\b(fattest|skinniest|heaviest|lightest)\b/i },
  ];

  it('no rendered copy contains any forbidden substring across all event types', () => {
    const offenders: { input: string; output: string; pattern: string }[] = [];

    for (const input of allEventTypeCopyInputs) {
      const output = engine.renderCopy({
        eventType: input.eventType,
        actors: input.actors,
        payload: input.payload,
      });
      for (const { name, re } of forbiddenPatterns) {
        if (re.test(output)) {
          offenders.push({ input: `${input.eventType}`, output, pattern: name });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('notable_meal copy carries the descriptor but NO number', () => {
    const out = engine.renderCopy({
      eventType: 'notable_meal',
      actors: [{ name: 'Priya' }],
      payload: { mealDescriptor: 'high-protein lunch' },
    });
    expect(out).toBe('Priya logged a high-protein lunch 🍽️');
    expect(/\d/.test(out)).toBe(false);
  });

  // Audit gap A/D (CIRCLE_CHAT_HEALTHY_ENGAGEMENT_AUDIT.md): extend the forbidden-substring
  // scan to the chat notification templates' STATIC chrome (titles + fallback bodies).
  // The interpolated friendName/circleName/preview are member-typed content (assessed
  // acceptable — §6.7 governs system copy, not member speech), so we scan the templates
  // with neutral inputs to assert the wording the SYSTEM controls is body/food-neutral.
  it('chat notification template chrome contains no forbidden substring', () => {
    const neutral = { friendName: 'Sam', circleName: 'Squad', preview: 'hey', body: 'nice work' };
    const offenders: { type: string; output: string; pattern: string }[] = [];
    for (const type of ['chat_message', 'chat_mention', 'chat_rally'] as const) {
      const c = NOTIFICATION_TEMPLATES[type](neutral);
      const output = `${c.title} ${c.body}`;
      for (const { name, re } of forbiddenPatterns) {
        if (re.test(output)) offenders.push({ type, output, pattern: name });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('chat_rally carries the engine-rendered system body (a P0 rally post) cleanly', () => {
    // chat_rally.body relays system-post copy from the engine — confirm a real P0 body
    // (e.g. challenge_resolved) passes the same neutrality scan end-to-end.
    const rallyBody = engine.renderCopy({
      eventType: 'challenge_resolved',
      actors: [{ name: 'Squad' }],
      payload: { challengeName: 'Spring Cut' },
    });
    const c = NOTIFICATION_TEMPLATES.chat_rally({ circleName: 'Squad', body: rallyBody });
    const output = `${c.title} ${c.body}`;
    for (const { re } of forbiddenPatterns) expect(re.test(output)).toBe(false);
  });
});
