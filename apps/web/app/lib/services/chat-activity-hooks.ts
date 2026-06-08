// Circle Chat — Source-Service Hook layer (Build Spec v1.2 §6).
//
// One thin module the source services import. Each helper builds the right
// ActivitySignal(s) — resolving the user's active circles + display name — and
// fire-and-forgets to the SystemPostEngine. These hooks MUST NEVER throw back
// into the source write: every method wraps its whole body in try/catch that
// logs and swallows, mirroring how BoostService.recalculateAllCirclesForUser is
// invoked fire-and-forget from WorkoutLoggingService.
//
// Implements the FROZEN HOOK API in ../types/circle-chat-engine.ts §6 with
// EXACTLY those static signatures.

import { createAdminSupabase } from '../supabase-admin';
import type { SystemEventType } from '../types/circle-chat';
import type { ActivitySignal, SignalPayload } from '../types/circle-chat-engine';

import { SystemPostEngine } from './system-post-engine';


export class ChatActivityHooks {
  // ==========================================================================
  // PUBLIC HOOK API (frozen signatures — §6)
  // ==========================================================================

  /**
   * A user logged a workout. Emits one workout_done signal per active circle
   * the user belongs to (a user can be in multiple circles).
   */
  static async onWorkoutCompleted(userId: string, workoutRefId: string): Promise<void> {
    try {
      const [circleIds, actorName] = await Promise.all([
        this.activeCircleIds(userId),
        this.actorName(userId),
      ]);
      await this.emitPerCircle(circleIds, (fitcircleId) =>
        this.signal(fitcircleId, userId, actorName, 'workout_done', workoutRefId)
      );
    } catch (err) {
      this.swallow('onWorkoutCompleted', err);
    }
  }

  /**
   * A user hit a streak/momentum milestone. Emits one streak_milestone signal
   * per active circle, carrying the day count for copy.
   */
  static async onStreakMilestone(userId: string, streakDays: number): Promise<void> {
    try {
      const [circleIds, actorName] = await Promise.all([
        this.activeCircleIds(userId),
        this.actorName(userId),
      ]);
      await this.emitPerCircle(circleIds, (fitcircleId) =>
        this.signal(fitcircleId, userId, actorName, 'streak_milestone', null, { streakDays })
      );
    } catch (err) {
      this.swallow('onStreakMilestone', err);
    }
  }

  /**
   * A quest in a known circle was completed. Single circle (already known).
   */
  static async onQuestCompleted(
    fitcircleId: string,
    userId: string,
    questId: string,
    questName: string
  ): Promise<void> {
    try {
      const actorName = await this.actorName(userId);
      await this.ingest(
        this.signal(fitcircleId, userId, actorName, 'quest_done', questId, { questName })
      );
    } catch (err) {
      this.swallow('onQuestCompleted', err);
    }
  }

  /**
   * A challenge crossed a milestone (halfway / one_week_left / final_day). This
   * is a circle-level event, not a single-member action — there is no member
   * "actor". We use the challenge name as the actorName and the circle id as a
   * stand-in actorUserId (the copy template ignores the actor for
   * challenge_milestone, rendering off payload.challengeMilestone/Name instead).
   */
  static async onChallengeMilestone(
    fitcircleId: string,
    milestone: 'halfway' | 'one_week_left' | 'final_day',
    challengeName: string
  ): Promise<void> {
    try {
      await this.ingest(
        this.signal(fitcircleId, fitcircleId, challengeName, 'challenge_milestone', null, {
          challengeMilestone: milestone,
          challengeName,
        })
      );
    } catch (err) {
      this.swallow('onChallengeMilestone', err);
    }
  }

  /**
   * A challenge finished. Circle-level event; actor is the challenge itself
   * (copy renders off payload.challengeName, not the actor).
   */
  static async onChallengeResolved(
    fitcircleId: string,
    challengeId: string,
    challengeName: string
  ): Promise<void> {
    try {
      await this.ingest(
        this.signal(fitcircleId, fitcircleId, challengeName, 'challenge_resolved', challengeId, {
          challengeName,
        })
      );
    } catch (err) {
      this.swallow('onChallengeResolved', err);
    }
  }

  /**
   * A member joined a known circle. Single circle (already known).
   */
  static async onMemberJoined(fitcircleId: string, userId: string): Promise<void> {
    try {
      const actorName = await this.actorName(userId);
      await this.ingest(this.signal(fitcircleId, userId, actorName, 'member_joined', null));
    } catch (err) {
      this.swallow('onMemberJoined', err);
    }
  }

  /**
   * A new challenge was created in a known circle. Circle-level announcement;
   * actor is the challenge itself (copy renders off payload.challengeName).
   */
  static async onNewChallenge(
    fitcircleId: string,
    challengeId: string,
    challengeName: string
  ): Promise<void> {
    try {
      await this.ingest(
        this.signal(fitcircleId, fitcircleId, challengeName, 'new_challenge', challengeId, {
          challengeName,
        })
      );
    } catch (err) {
      this.swallow('onNewChallenge', err);
    }
  }

  // ==========================================================================
  // PRIVATE — signal construction + dispatch
  // ==========================================================================

  /** Build a fully-typed ActivitySignal with a fresh occurredAt timestamp. */
  private static signal(
    fitcircleId: string,
    actorUserId: string,
    actorName: string,
    eventType: SystemEventType,
    refId: string | null,
    payload?: SignalPayload
  ): ActivitySignal {
    return {
      fitcircleId,
      actorUserId,
      actorName,
      eventType,
      refId,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }

  /** Fire one signal at the engine. ingest() is itself failure-isolated. */
  private static async ingest(signal: ActivitySignal): Promise<void> {
    await new SystemPostEngine().ingest(signal);
  }

  /** Emit one signal per circle, isolating per-circle failures. */
  private static async emitPerCircle(
    circleIds: string[],
    build: (fitcircleId: string) => ActivitySignal
  ): Promise<void> {
    await Promise.all(
      circleIds.map(async (fitcircleId) => {
        try {
          await this.ingest(build(fitcircleId));
        } catch (err) {
          this.swallow('emitPerCircle', err);
        }
      })
    );
  }

  // ==========================================================================
  // PRIVATE — resolvers
  // ==========================================================================

  /** Active circles the user belongs to (membership shape from the contract §6). */
  private static async activeCircleIds(userId: string): Promise<string[]> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) throw error;
    return (data ?? [])
      .map((row) => row.fitcircle_id as string)
      .filter((id): id is string => !!id);
  }

  /** Pre-resolved display name so the engine never re-queries for copy. */
  private static async actorName(userId: string): Promise<string> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return (data?.display_name as string | null) ?? 'Someone';
  }

  /** Log and swallow — a chat-post failure must never fail/slow the source write. */
  private static swallow(method: string, err: unknown): void {
    console.error(`[ChatActivityHooks.${method}] swallowed:`, err);
  }
}
