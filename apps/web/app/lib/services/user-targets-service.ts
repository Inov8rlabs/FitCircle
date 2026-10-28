/**
 * UserTargetsService — the user's daily calorie / macro / water / steps targets
 * (docs/USER_TARGETS_CONTRACT.md). Storage and rules: lib/targets/user-targets.ts.
 *
 *  GET       /api/mobile/targets → get
 *  PUT|PATCH /api/mobile/targets → update
 */
import { createAdminSupabase } from '../supabase-admin';
import { applyTargetsPatch, targetsView, type TargetsPatch, type UserTargetsView } from '../targets/user-targets';

export class UserTargetsService {
  static async get(userId: string, profile?: { preferences?: unknown; goals?: unknown } | null): Promise<UserTargetsView> {
    // The auth profile is `profiles.*`; reuse it when it carries both columns.
    if (profile && 'preferences' in profile && 'goals' in profile) return targetsView(profile);
    const { data, error } = await createAdminSupabase().from('profiles').select('preferences, goals').eq('id', userId).maybeSingle();
    if (error) throw error;
    return targetsView(data);
  }

  /** Merge `patch` into profiles.preferences / goals (read-modify-write, like VitalsService.updateGoals). */
  static async update(userId: string, patch: TargetsPatch, now: Date = new Date()): Promise<UserTargetsView> {
    const supabase = createAdminSupabase();
    const { data: profile, error } = await supabase.from('profiles').select('preferences, goals').eq('id', userId).single();
    if (error) throw error;
    const next = applyTargetsPatch(profile, patch, now);
    const { data, error: updateError } = await supabase
      .from('profiles')
      .update({ preferences: next.preferences, goals: next.goals, updated_at: now.toISOString() })
      .eq('id', userId)
      .select('preferences, goals')
      .single();
    if (updateError) throw updateError;
    return targetsView(data ?? next);
  }
}
