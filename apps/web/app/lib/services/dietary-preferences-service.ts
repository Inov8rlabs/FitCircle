import { createAdminSupabase } from '../supabase-admin';
import {
  type DietType,
  type DietaryPreferencesDTO,
  type DietaryPreferencesRow,
  type SetDietaryPreferencesInput,
  type UnitSystem,
} from '../types/dietary-prefs';

/**
 * DietaryPreferencesService — per-user dietary pattern, allergens, and unit preference
 * (PRD v4 §6.15) over the dedicated `dietary_preferences` table (migration 063).
 *
 * The table is sparse: a row exists only once a user sets something. getPrefs() centralizes
 * the defaults for a missing/partial row so no caller has to special-case it:
 *   - diet:      'none'
 *   - allergens: []
 *   - units:     inferred from profiles.country_code (CA → metric, US → imperial, else metric)
 *
 * Units are a DISPLAY concern only. The API always stores/returns canonical grams/kcal; the
 * client formats per the unit pref. There is intentionally NO backend unit conversion here.
 *
 * Authorization is explicit in-code (admin client): all reads/writes are scoped to userId.
 */
export class DietaryPreferencesService {
  /**
   * Resolved preferences for a user. Returns sensible defaults when no row exists, with the
   * unit default inferred from the user's profile locale (country_code). Never throws on a
   * missing row.
   */
  static async getPrefs(userId: string): Promise<DietaryPreferencesDTO> {
    const supabase = createAdminSupabase();

    const { data } = await supabase
      .from('dietary_preferences')
      .select('diet, allergens, units')
      .eq('user_id', userId)
      .maybeSingle();

    const row = data as Pick<DietaryPreferencesRow, 'diet' | 'allergens' | 'units'> | null;

    const diet: DietType = row?.diet ?? 'none';
    const allergens = this.normalizeAllergens(row?.allergens ?? []);
    const units: UnitSystem = row?.units ?? (await this.inferUnitsFromLocale(userId));

    return { diet, allergens, units };
  }

  /**
   * Upsert the user's preferences. Partial update: only fields present in `input` are changed;
   * omitted fields are preserved (an absent row starts from the resolved defaults). Returns the
   * fully resolved DTO.
   */
  static async setPrefs(
    userId: string,
    input: SetDietaryPreferencesInput
  ): Promise<DietaryPreferencesDTO> {
    const supabase = createAdminSupabase();

    // Start from current resolved prefs so a partial update preserves untouched fields.
    const current = await this.getPrefs(userId);

    // Only persist the unit choice when it was explicitly provided OR already stored; we never
    // want to "freeze" a locale-inferred default into the row (so a later locale change still
    // takes effect). To know whether a stored unit exists, re-read the raw row's units column.
    const { data: rawRow } = await supabase
      .from('dietary_preferences')
      .select('units')
      .eq('user_id', userId)
      .maybeSingle();
    const storedUnits = (rawRow as { units: UnitSystem | null } | null)?.units ?? null;

    const nextDiet: DietType = input.diet ?? current.diet;
    const nextAllergens = input.allergens
      ? this.normalizeAllergens(input.allergens)
      : current.allergens;
    const nextUnits: UnitSystem | null = input.units ?? storedUnits;

    const { error } = await supabase.from('dietary_preferences').upsert(
      {
        user_id: userId,
        // Store NULL for 'none' to keep the row semantically sparse / matching the CHECK.
        diet: nextDiet === 'none' ? null : nextDiet,
        allergens: nextAllergens,
        units: nextUnits,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error) throw new Error(error.message);

    return this.getPrefs(userId);
  }

  // ---- private --------------------------------------------------------------

  /** Lowercase, trim, dedupe, and drop empties so allergen tokens are stable for matching. */
  private static normalizeAllergens(raw: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of raw) {
      const t = a.trim().toLowerCase();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }

  /**
   * Infer the default unit system from the user's profile locale. Canada → metric, US →
   * imperial; everything else (and unknown) → metric. Failure-isolated: any read error falls
   * back to 'metric'.
   */
  private static async inferUnitsFromLocale(userId: string): Promise<UnitSystem> {
    try {
      const supabase = createAdminSupabase();
      const { data } = await supabase
        .from('profiles')
        .select('country_code')
        .eq('id', userId)
        .maybeSingle();
      const cc = ((data as { country_code: string | null } | null)?.country_code ?? '')
        .trim()
        .toUpperCase();
      return cc === 'US' ? 'imperial' : 'metric';
    } catch {
      return 'metric';
    }
  }
}
