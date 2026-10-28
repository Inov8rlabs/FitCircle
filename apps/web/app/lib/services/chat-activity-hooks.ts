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

import { ChatNotificationService, type SystemPushIntent } from './chat-notification-service';
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

  /** The circle streak reached a milestone (3/7/14/30/50/100). Circle-level post. */
  static async onCircleStreakMilestone(fitcircleId: string, streakDays: number): Promise<void> {
    try {
      await this.ingest(
        // No refId (system_event_ref is a uuid); the event key falls back to d<streakDays>.
        this.signal(fitcircleId, fitcircleId, 'circle', 'circle_streak', null, {
          streakDays,
          loggedAtCount: streakDays,
        })
      );
    } catch (err) {
      this.swallow('onCircleStreakMilestone', err);
    }
  }

  /** A member spent their weekly save covering a friend. */
  static async onCircleStreakSaved(fitcircleId: string, saverUserId: string, coveredUserId: string, saveId: string): Promise<void> {
    try {
      const [saver, covered] = await Promise.all([this.actorName(saverUserId), this.actorName(coveredUserId)]);
      await this.ingest(
        this.signal(fitcircleId, saverUserId, saver, 'circle_streak_saved', saveId, {
          coveredName: covered.split(/\s+/)[0],
          // The covered friend gets the dedicated circle_streak_saved push.
          coveredUserId,
        })
      );
    } catch (err) {
      this.swallow('onCircleStreakSaved', err);
    }
  }

  /** A lobby circle kicked off (crew filled, timer ran out, or the creator started it). */
  static async onCircleKickoff(
    fitcircleId: string,
    circleName: string,
    memberCount: number,
    reason: 'full' | 'timer' | 'manual'
  ): Promise<void> {
    try {
      await this.ingest(
        // refId lands in circle_messages.system_event_ref (uuid): the circle id keys one kickoff per circle.
        this.signal(fitcircleId, fitcircleId, circleName, 'circle_kickoff', fitcircleId, {
          circleName,
          memberCount,
          kickoffReason: reason,
        })
      );
    } catch (err) {
      this.swallow('onCircleKickoff', err);
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

  /**
   * Emit one signal per circle, isolating per-circle failures. The post lands
   * in every circle, but the push is coalesced: every circle's push intent is
   * collected and handed over once, so each recipient gets ONE push for the
   * event however many circles they share with the actor, and the actor none.
   */
  private static async emitPerCircle(
    circleIds: string[],
    build: (fitcircleId: string) => ActivitySignal
  ): Promise<void> {
    const engine = new SystemPostEngine();
    const perCircle = await Promise.all(
      circleIds.map(async (fitcircleId): Promise<SystemPushIntent[]> => {
        try {
          return (await engine.ingest(build(fitcircleId), { push: 'collect' })).intents;
        } catch (err) {
          this.swallow('emitPerCircle', err);
          return [];
        }
      })
    );
    // Keep the user's membership order (deep link → the first circle).
    const intents = perCircle.flat();
    if (intents.length > 0) await ChatNotificationService.notifySystemEvent(intents);
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
