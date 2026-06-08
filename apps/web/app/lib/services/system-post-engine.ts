// Circle Chat — System-Post Engine (Build Spec v1.2 §3/§4/§7).
//
// Turns activity SIGNALS from across the product into system posts in the
// circle_messages timeline — filtered, bundled, rate-limited, and rendered with
// friendly "update" copy. Implements the FROZEN contract in
// ../types/circle-chat-engine.ts.
//
// Architecture:
//   * plan() and renderCopy() are PURE — no DB, no clock, no randomness. The
//     replay eval drives them deterministically (nowISO + stats are injected).
//   * ingest() is the side-effectful entrypoint hooks call. It is failure-isolated
//     (try/catch that logs and swallows — never throws back into the source write,
//     mirroring how BoostService is invoked fire-and-forget).

import { createAdminSupabase } from '../supabase-admin';
import type { SystemEventType } from '../types/circle-chat';
import {
  EVENT_TAXONOMY,
  HARD_EXCLUDED_SOURCES,
  DEFAULT_ENGINE_CONFIG,
  type ActivitySignal,
  type CopyContext,
  type EngineConfig,
  type EnginePlanInput,
  type EventPolicy,
  type PlannedPost,
  type RecentPostStats,
} from '../types/circle-chat-engine';

import { ChatNotificationService } from './chat-notification-service';
import { CircleChatService } from './circle-chat-service';


export class SystemPostEngine {
  private readonly config: EngineConfig;

  constructor(config?: Partial<EngineConfig>) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...(config ?? {}) };
  }

  // ============================================================================
  // PURE DECISION CORE
  // ============================================================================

  /**
   * Decide the post(s) resulting from a signal, given the posts already made
   * today / this hour and the same-type signals in the bundle window. PURE: no
   * DB, no Date.now(), no Math.random(). nowISO + isQuietHours are injected.
   */
  plan(input: EnginePlanInput): PlannedPost[] {
    const { signal, config, stats, isQuietHours, eventEnabled } = input;
    const { eventType, actorUserId, refId } = signal;

    // 1. Allow-list / hard-exclusion / disabled gate -> suppressed.
    const isInTaxonomy = Object.prototype.hasOwnProperty.call(EVENT_TAXONOMY, eventType);
    const isHardExcluded = (HARD_EXCLUDED_SOURCES as readonly string[]).includes(eventType);

    if (!eventEnabled || !isInTaxonomy || isHardExcluded) {
      return [{ disposition: 'suppressed', reason: this.suppressReason(eventEnabled, isInTaxonomy, isHardExcluded) }];
    }

    const policy: EventPolicy = EVENT_TAXONOMY[eventType];
    const isP0 = policy.priority === 'p0';

    // 2. P0 — always post, bypass cap / ceiling / quiet-queue-for-timeline.
    //    Quiet hours still defers PUSH (handled elsewhere) but the row is written.
    if (isP0) {
      if (isQuietHours) {
        return [this.buildPost('queued_quiet', signal, policy, [actorUserId], refId, undefined, 'p0 quiet-hours: row written, push deferred')];
      }
      return [this.buildPost('post', signal, policy, [actorUserId], refId, undefined, 'p0 bypasses limits')];
    }

    // 3. Bundling — collapse with same-type signals in the window.
    if (policy.bundleable && stats.recentSameTypeInWindow.length > 0) {
      const sameType = stats.recentSameTypeInWindow.filter((s) => s.eventType === eventType);
      if (sameType.length > 0) {
        const actorIds = this.uniq([actorUserId, ...sameType.map((s) => s.actorUserId)]);
        const actorNames = this.uniqBy(
          [{ id: actorUserId, name: signal.actorName }, ...sameType.map((s) => ({ id: s.actorUserId, name: s.actorName }))],
          (a) => a.id
        ).map((a) => a.name);
        const bundleOfRefIds = this.uniq(
          [refId, ...sameType.map((s) => s.refId)].filter((r): r is string => !!r)
        );
        return [
          {
            disposition: 'post_bundled',
            eventType,
            priority: policy.priority,
            renderHint: policy.renderHint,
            actorUserIds: actorIds,
            body: this.renderCopy({ eventType, actors: actorNames.map((name) => ({ name })), payload: signal.payload }),
            refId,
            bundleOfRefIds,
            reason: `bundled ${actorIds.length} same-type actors within window`,
          },
        ];
      }
    }

    // 4. Per-member routine cap.
    if (policy.cappable) {
      const already = stats.perMemberRoutineToday[actorUserId] ?? 0;
      if (already >= config.perMemberDailyRoutineCap) {
        return [{ disposition: 'drop_to_summary', eventType, priority: policy.priority, reason: `per-member routine cap (${already} >= ${config.perMemberDailyRoutineCap})` }];
      }
    }

    // 5. Circle hourly ceiling — applies to ceiling-bound (p1/p2, not p0).
    if (stats.circlePostsThisHour >= config.circleHourlyCeiling) {
      return [{ disposition: 'drop_to_summary', eventType, priority: policy.priority, reason: `circle hourly ceiling (${stats.circlePostsThisHour} >= ${config.circleHourlyCeiling})` }];
    }

    // 6. Quiet hours (non-p0) -> queue (row written, push deferred).
    if (isQuietHours) {
      return [this.buildPost('queued_quiet', signal, policy, [actorUserId], refId, undefined, 'quiet hours')];
    }

    // 7. Default -> post.
    return [this.buildPost('post', signal, policy, [actorUserId], refId, undefined, 'default post')];
  }

  /**
   * Friendly "update" voice body string. PURE; eval-asserted exact outputs.
   * Body- & food-NEUTRAL — never ranks/shames, never shows calories/weight.
   */
  renderCopy(ctx: CopyContext): string {
    const { eventType, actors, payload } = ctx;
    const names = actors.map((a) => a.name);

    switch (eventType) {
      case 'workout_done':
        return names.length === 1
          ? `${names[0]} just logged a workout 💪`
          : `${this.joinNames(names)} all got moving today 🔥`;

      case 'streak_milestone':
        return `${this.possessive(names[0])} on a ${payload?.streakDays ?? 0}-day streak — nice 🔥`;

      case 'circle_streak':
        return `The circle's kept it going ${payload?.loggedAtCount ?? payload?.streakDays ?? 0} days strong 🔥`;

      case 'quest_done':
        return `${names[0]} finished the ${payload?.questName ?? 'quest'} 🎉`;

      case 'challenge_milestone':
        return this.renderChallengeMilestone(payload?.challengeMilestone, payload?.challengeName ?? 'challenge');

      case 'challenge_resolved':
        return `That's a wrap on the ${payload?.challengeName ?? 'challenge'}! Tap to see how it went 🏆`;

      case 'daily_summary': {
        const checkedIn = (payload as { checkedIn?: number } | undefined)?.checkedIn ?? 0;
        const total = (payload as { total?: number } | undefined)?.total ?? 0;
        return `Today's circle: ${checkedIn} of ${total} checked in. Nice momentum 👏`;
      }

      case 'member_joined':
        return `${this.joinNames(names)} just joined — say hi 👋`;

      case 'new_challenge':
        return `New challenge just dropped: ${payload?.challengeName ?? 'a new challenge'}. Who's in?`;

      case 'notable_meal':
        return `${names[0]} logged a ${payload?.mealDescriptor ?? 'meal'} 🍽️`;

      default: {
        // Exhaustiveness guard — every SystemEventType handled above.
        const _exhaustive: never = eventType;
        return _exhaustive;
      }
    }
  }

  // ============================================================================
  // SIDE-EFFECTFUL ENTRYPOINT (failure-isolated)
  // ============================================================================

  /**
   * Resolve config + recent-post stats from the DB, run plan(), and write the
   * resulting post(s) via CircleChatService.emitSystemPost(). Never throws —
   * wraps everything in try/catch (mirrors fire-and-forget BoostService calls).
   */
  async ingest(signal: ActivitySignal): Promise<void> {
    try {
      const config = this.config;
      const nowISO = new Date().toISOString();

      const isInTaxonomy = Object.prototype.hasOwnProperty.call(EVENT_TAXONOMY, signal.eventType);
      const eventEnabled = isInTaxonomy && EVENT_TAXONOMY[signal.eventType].enabledByDefault;

      const stats = await this.loadRecentPostStats(signal, config, nowISO);
      const isQuietHours = this.computeQuietHours(config, nowISO);

      const planned = this.plan({ signal, config, stats, nowISO, isQuietHours, eventEnabled });

      for (const post of planned) {
        if (
          post.disposition === 'post' ||
          post.disposition === 'post_bundled' ||
          post.disposition === 'queued_quiet'
        ) {
          const written = await CircleChatService.emitSystemPost({
            fitcircleId: signal.fitcircleId,
            eventType: post.eventType ?? signal.eventType,
            priority: post.priority ?? EVENT_TAXONOMY[signal.eventType].priority,
            renderHint: post.renderHint ?? EVENT_TAXONOMY[signal.eventType].renderHint,
            body: post.body ?? '',
            refId: post.refId ?? signal.refId,
            actorUserIds: post.actorUserIds ?? [signal.actorUserId],
            systemPayload: this.buildSystemPayload(signal, post),
          });

          // P0 "rally" posts earn ONE celebratory push (in-app + push).
          // queued_quiet defers the push (handled by quiet-hours), so only the
          // immediately-posted P0 fires a rally push here. Fire-and-forget.
          const effectivePriority =
            post.priority ?? EVENT_TAXONOMY[signal.eventType].priority;
          if (post.disposition === 'post' && effectivePriority === 'p0') {
            void ChatNotificationService.notifyRallyPost(
              signal.fitcircleId,
              await this.resolveCircleName(signal.fitcircleId),
              written.body ?? post.body ?? '',
              post.eventType ?? signal.eventType
            ).catch(() => {});
          }
        } else {
          // 'drop_to_summary' | 'suppressed' -> no write.
          console.log(
            `[SystemPostEngine.ingest] ${signal.eventType} in circle ${signal.fitcircleId} -> ${post.disposition}${post.reason ? ` (${post.reason})` : ''}`
          );
        }
      }
    } catch (err) {
      // Failure-isolated: log and swallow so the source write never breaks.
      console.error(
        `[SystemPostEngine.ingest] Failed for ${signal.eventType} in circle ${signal.fitcircleId}:`,
        err
      );
    }
  }

  // ============================================================================
  // PRIVATE — DB loaders (ingest only)
  // ============================================================================

  /**
   * Load the counts plan() needs to enforce caps/ceiling + the same-type signals
   * for bundling. Queries circle_messages (kind='system_event') only.
   */
  private async loadRecentPostStats(
    signal: ActivitySignal,
    config: EngineConfig,
    nowISO: string
  ): Promise<RecentPostStats> {
    const supabaseAdmin = createAdminSupabase();
    const now = new Date(nowISO);

    const localMidnightISO = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
    ).toISOString();
    const hourAgoISO = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const bundleWindowStartISO = new Date(
      now.getTime() - config.bundleWindowMinutes * 60 * 1000
    ).toISOString();

    // Cappable system posts by this actor in this circle since local midnight.
    const cappableTypes = this.eventTypesMatching((p) => p.cappable);
    const perMemberRoutineToday: Record<string, number> = {};
    if (cappableTypes.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('circle_messages')
        .select('system_payload')
        .eq('fitcircle_id', signal.fitcircleId)
        .eq('kind', 'system_event')
        .in('system_event_type', cappableTypes)
        .gte('created_at', localMidnightISO);

      if (error) throw error;

      for (const row of data ?? []) {
        const payload = (row.system_payload ?? {}) as { actors?: Array<{ id?: string }> };
        const actors = Array.isArray(payload.actors) ? payload.actors : [];
        for (const a of actors) {
          if (a?.id) perMemberRoutineToday[a.id] = (perMemberRoutineToday[a.id] ?? 0) + 1;
        }
      }
    }

    // Ceiling-bound (p1/p2, not p0) system posts in this circle in the last hour.
    const ceilingTypes = this.eventTypesMatching((p) => p.priority !== 'p0');
    let circlePostsThisHour = 0;
    if (ceilingTypes.length > 0) {
      const { count, error } = await supabaseAdmin
        .from('circle_messages')
        .select('id', { count: 'exact', head: true })
        .eq('fitcircle_id', signal.fitcircleId)
        .eq('kind', 'system_event')
        .in('system_event_type', ceilingTypes)
        .gte('created_at', hourAgoISO);

      if (error) throw error;
      circlePostsThisHour = count ?? 0;
    }

    // Same-type system posts within the bundle window (for bundling).
    const recentSameTypeInWindow: ActivitySignal[] = [];
    {
      const { data, error } = await supabaseAdmin
        .from('circle_messages')
        .select('fitcircle_id, system_event_type, system_event_ref, system_payload, created_at')
        .eq('fitcircle_id', signal.fitcircleId)
        .eq('kind', 'system_event')
        .eq('system_event_type', signal.eventType)
        .gte('created_at', bundleWindowStartISO);

      if (error) throw error;

      for (const row of data ?? []) {
        const payload = (row.system_payload ?? {}) as { actors?: Array<{ id?: string; name?: string }> };
        const actors = Array.isArray(payload.actors) ? payload.actors : [];
        for (const a of actors) {
          if (!a?.id) continue;
          recentSameTypeInWindow.push({
            fitcircleId: row.fitcircle_id as string,
            actorUserId: a.id,
            actorName: a.name ?? '',
            eventType: row.system_event_type as SystemEventType,
            refId: (row.system_event_ref as string | null) ?? null,
            occurredAt: row.created_at as string,
          });
        }
      }
    }

    return { perMemberRoutineToday, circlePostsThisHour, recentSameTypeInWindow };
  }

  /** Best-effort circle display name lookup (for rally push copy). */
  private async resolveCircleName(circleId: string): Promise<string> {
    try {
      const supabaseAdmin = createAdminSupabase();
      const { data } = await supabaseAdmin
        .from('fitcircles')
        .select('name')
        .eq('id', circleId)
        .maybeSingle();
      return (data?.name as string | undefined) ?? 'your circle';
    } catch {
      return 'your circle';
    }
  }

  private computeQuietHours(config: EngineConfig, nowISO: string): boolean {
    if (!config.quietHours) return false;
    const { startHour, endHour } = config.quietHours;
    const hour = new Date(nowISO).getUTCHours();
    if (startHour === endHour) return false;
    if (startHour < endHour) {
      // Same-day window, e.g. 9..17.
      return hour >= startHour && hour < endHour;
    }
    // Overnight window, e.g. 22..7.
    return hour >= startHour || hour < endHour;
  }

  // ============================================================================
  // PRIVATE — helpers
  // ============================================================================

  private buildPost(
    disposition: 'post' | 'queued_quiet',
    signal: ActivitySignal,
    policy: EventPolicy,
    actorUserIds: string[],
    refId: string | null,
    bundleOfRefIds: string[] | undefined,
    reason: string
  ): PlannedPost {
    return {
      disposition,
      eventType: signal.eventType,
      priority: policy.priority,
      renderHint: policy.renderHint,
      actorUserIds,
      body: this.renderCopy({
        eventType: signal.eventType,
        actors: [{ name: signal.actorName }],
        payload: signal.payload,
      }),
      refId,
      bundleOfRefIds,
      reason,
    };
  }

  private buildSystemPayload(signal: ActivitySignal, post: PlannedPost): Record<string, unknown> {
    const payload: Record<string, unknown> = { ...(signal.payload ?? {}) };
    if (post.bundleOfRefIds && post.bundleOfRefIds.length > 0) {
      payload.bundle_of_ref_ids = post.bundleOfRefIds;
    }
    return payload;
  }

  private suppressReason(eventEnabled: boolean, isInTaxonomy: boolean, isHardExcluded: boolean): string {
    if (isHardExcluded) return 'hard-excluded source';
    if (!isInTaxonomy) return 'not in taxonomy';
    if (!eventEnabled) return 'event disabled';
    return 'suppressed';
  }

  private eventTypesMatching(pred: (policy: EventPolicy) => boolean): SystemEventType[] {
    return (Object.keys(EVENT_TAXONOMY) as SystemEventType[]).filter((t) => pred(EVENT_TAXONOMY[t]));
  }

  /** "Mike" -> "Mike's"; "Chris" -> "Chris'". */
  private possessive(name: string): string {
    return name.endsWith('s') ? `${name}'` : `${name}'s`;
  }

  /** ["A"] -> "A"; ["A","B"] -> "A & B"; ["A","B","C"] -> "A, B & C". */
  private joinNames(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    const head = names.slice(0, -1);
    const last = names[names.length - 1];
    return `${head.join(', ')} & ${last}`;
  }

  private renderChallengeMilestone(
    milestone: 'halfway' | 'one_week_left' | 'final_day' | undefined,
    challengeName: string
  ): string {
    switch (milestone) {
      case 'one_week_left':
        return `One week left in the ${challengeName} — here's how everyone's doing`;
      case 'final_day':
        return `Final day of the ${challengeName} — here's how everyone's doing`;
      case 'halfway':
      default:
        return `Halfway through the ${challengeName} — here's how everyone's doing`;
    }
  }

  private uniq<T>(items: T[]): T[] {
    return Array.from(new Set(items));
  }

  private uniqBy<T>(items: T[], key: (item: T) => string): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
      const k = key(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  }
}
