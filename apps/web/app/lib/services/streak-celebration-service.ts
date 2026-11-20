/**
 * Streak milestone celebrations (docs/ENGAGEMENT_115_SPEC.md §5.4):
 *  - notifyMilestone: the `milestone_achieved` push when the app did not show the celebration
 *    in-app (remote config `streak_milestone_push`, default on). Cap-exempt, held through quiet
 *    hours (deferrable), deduped per milestone + boundary day.
 *  - getPending / ack: the `pending_celebration` stored on the milestone_shield
 *    streak_shields.metadata row (no migration), served by GET /api/mobile/streaks/celebrations.
 */
import { logIgnoredQueryError } from '@/lib/api/route-errors';

import { RemoteConfigService } from '../remote-config/service';
import { milestoneDedupeKey, milestonePushCopy, pendingCelebrationFrom, type PendingCelebrationDto } from '../streaks/celebration';
import { createAdminSupabase } from '../supabase-admin';

import { NotificationOrchestrator } from './notification-orchestrator';

export class StreakCelebrationService {
  static async notifyMilestone(
    userId: string,
    m: { days: number; name: string; shieldsGranted: number; boundaryDay: string }
  ): Promise<{ sent: boolean; reason?: string }> {
    const on = await RemoteConfigService.enumValue('streak_milestone_push', { userId }).catch(() => 'on');
    if (on === 'off') return { sent: false, reason: 'switched_off' };
    const copy = milestonePushCopy(m);
    return NotificationOrchestrator.send(userId, 'milestone_achieved', {
      title: copy.title,
      body: copy.body,
      milestoneName: m.name,
      route: 'streak_milestone',
      milestone: m.days,
      dedupeKey: milestoneDedupeKey(m.days, m.boundaryDay),
    });
  }

  static async getPending(userId: string, now: Date = new Date()): Promise<PendingCelebrationDto | null> {
    const { data, error } = await createAdminSupabase()
      .from('streak_shields')
      .select('metadata')
      .eq('user_id', userId)
      .eq('shield_type', 'milestone_shield')
      .maybeSingle();
    logIgnoredQueryError('StreakCelebrationService.getPending', error);
    return pendingCelebrationFrom(data?.metadata ?? null, now);
  }

  /** Clear the pending celebration for `milestone`. Idempotent (nothing pending → no-op). */
  static async ack(userId: string, milestone: number): Promise<void> {
    const db = createAdminSupabase();
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await db
        .from('streak_shields')
        .select('available_count, metadata')
        .eq('user_id', userId)
        .eq('shield_type', 'milestone_shield')
        .maybeSingle();
      if (error) throw error;
      const metadata = (data?.metadata ?? null) as Record<string, unknown> | null;
      const pending = metadata?.pending_celebration as { days?: number } | undefined;
      if (!data || !metadata || !pending || pending.days !== milestone) return;
      const { pending_celebration: _cleared, ...rest } = metadata;
      void _cleared;
      // Same optimistic guard as the award write, so a concurrent earn is never lost.
      const { data: updated, error: updateError } = await db
        .from('streak_shields')
        .update({ metadata: rest })
        .eq('user_id', userId)
        .eq('shield_type', 'milestone_shield')
        .eq('available_count', data.available_count)
        .select('available_count');
      if (updateError) throw updateError;
      if (updated && updated.length > 0) return;
    }
  }
}
