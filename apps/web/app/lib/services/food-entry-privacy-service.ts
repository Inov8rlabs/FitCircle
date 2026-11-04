// Food entry privacy — server-side operations (docs/FOOD_ENTRY_PRIVACY_SPEC.md):
// the "Share new meals with my circles" default and the bulk "make all my past
// meals private". The pure rules live in ./food-entry-privacy.

import { createAdminSupabase } from '../supabase-admin';

import { CircleMealPostService } from './circle-meal-post-service';
import { shareMealsByDefault } from './food-entry-privacy';

/** Rows updated per UPDATE … IN (…) when making past meals private. */
const BULK_CHUNK = 200;

export interface MakeAllPrivateResult {
  /** Entries that were shared and are now private. */
  entries_made_private: number;
  /** Live meal cards removed from circle chats. */
  posts_removed: number;
}

export class FoodEntryPrivacyService {
  /** The saved default (false when unset or unreadable — new meals are private). */
  static async getShareDefault(userId: string): Promise<boolean> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('profiles').select('preferences').eq('id', userId).maybeSingle();
    if (error) throw error;
    return shareMealsByDefault((data as { preferences?: unknown } | null)?.preferences);
  }

  /**
   * Save the default under preferences.privacy.share_meals_with_circles,
   * keeping every other stored preference. Returns the saved value.
   */
  static async setShareDefault(userId: string, share: boolean): Promise<boolean> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('profiles').select('preferences').eq('id', userId).maybeSingle();
    if (error) throw error;
    const current: Record<string, unknown> = (data as { preferences?: Record<string, unknown> } | null)?.preferences ?? {};
    const privacy = (current.privacy && typeof current.privacy === 'object' ? current.privacy : {}) as Record<string, unknown>;
    const preferences = { ...current, privacy: { ...privacy, share_meals_with_circles: share } };
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ preferences, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (updateError) throw updateError;
    return share;
  }

  /**
   * Make every past entry of the user private and pull their meal cards from
   * every circle chat. Idempotent: a second run changes nothing and returns
   * zeros. Throws on failure (safe to retry).
   *
   * Also sweeps cards of entries that are ALREADY private (e.g. an earlier
   * retraction that failed half-way), so the result is "nothing of mine is in
   * any chat" regardless of history.
   */
  static async makeAllPrivate(userId: string): Promise<MakeAllPrivateResult> {
    const supabase = createAdminSupabase();

    // Every live entry id + current privacy (water/supplements included: they
    // are never shared, normalising them is harmless and keeps the rule simple).
    const { data: rows, error } = await supabase
      .from('food_log_entries')
      .select('id, is_private, visibility')
      .eq('user_id', userId)
      .is('deleted_at', null);
    if (error) throw error;

    const all = (rows ?? []) as Array<{ id: string; is_private: boolean | null; visibility: string | null }>;
    const toFlip = all.filter((r) => r.is_private !== true || r.visibility !== 'private').map((r) => r.id);

    const now = new Date().toISOString();
    for (let i = 0; i < toFlip.length; i += BULK_CHUNK) {
      const chunk = toFlip.slice(i, i + BULK_CHUNK);
      const { error: updateError } = await supabase
        .from('food_log_entries')
        .update({ is_private: true, visibility: 'private', updated_at: now })
        .eq('user_id', userId)
        .in('id', chunk);
      if (updateError) throw updateError;
    }

    const postsRemoved = await CircleMealPostService.retractMeals(all.map((r) => r.id));
    return { entries_made_private: toFlip.length, posts_removed: postsRemoved };
  }
}
