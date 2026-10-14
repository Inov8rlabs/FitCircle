/**
 * Pure helpers for reconciling an AI nutrition DRAFT with the food-log entry the user
 * actually saved. No I/O — NutritionTrainingService does the reads/writes.
 *
 * Draft items are the server's NutritionDraftItem shape (camelCase: proteinG, servingUnit…);
 * final items are whatever the client echoed in `nutrition_data.items` (iOS SavedFoodItem /
 * Android SavedFoodItemData: snake_case protein_g, serving_unit…). Both are normalised here.
 */

/** Same rule as the eval harness (FUZZY_MATCH_THRESHOLD in types/nutrition-eval.ts). */
export const DRAFT_MATCH_THRESHOLD = 0.6;
/** A plate-level calorie change smaller than this counts as "accepted as-is". */
export const EDIT_KCAL_PCT_THRESHOLD = 2;

export interface NormalizedItem {
  name: string;
  grams: number | null;
  calories: number | null;
}

export interface Totals {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface DraftDiff {
  itemsMatched: number;
  itemsAdded: number;
  itemsRemoved: number;
  itemsRenamed: number;
  /** (final − draft) / draft × 100, null when either side is unknown or draft is 0. */
  kcalDeltaPct: number | null;
  /** Mean |final − draft| / draft × 100 over matched items that carry grams on both sides. */
  gramsDeltaPct: number | null;
  wasEdited: boolean;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] != null) return o[k];
  return null;
};

/** Accepts either the draft (camelCase) or the client (snake_case) item shape. */
export function normalizeItem(raw: unknown): NormalizedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) return null;
  return {
    name,
    grams: num(pick(o, 'grams', 'gramsTotal', 'grams_total')),
    calories: num(pick(o, 'calories', 'kcal')),
  };
}

export function normalizeItems(raw: unknown): NormalizedItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeItem).filter((i): i is NormalizedItem => i !== null);
}

/** Totals from a draft (`totals.proteinG`) or an entry (`protein_g` columns / nutrition_data). */
export function normalizeTotals(raw: unknown): Totals {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    calories: num(pick(o, 'calories')),
    protein_g: num(pick(o, 'protein_g', 'proteinG')),
    carbs_g: num(pick(o, 'carbs_g', 'carbsG')),
    fat_g: num(pick(o, 'fat_g', 'fatG')),
  };
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

/** Token Sørensen–Dice similarity in 0..1 (mirrors nutrition-eval's nameSimilarity). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

const canon = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Greedy one-to-one matching: each draft item takes the best still-unmatched final item
 * with similarity ≥ threshold. Unmatched draft items were removed; unmatched final items
 * were added; matched items whose names still differ (after case/space folding) were
 * renamed (e.g. "eggplant" → "stuffed bitter gourd" never matches, so a true rename shows
 * up as one removed + one added — that is the honest reading).
 */
export function diffDraftAndFinal(
  draftItems: NormalizedItem[],
  finalItems: NormalizedItem[],
  draftTotals: Totals,
  finalTotals: Totals,
): DraftDiff {
  const used = new Set<number>();
  let matched = 0;
  let renamed = 0;
  const gramsDeltas: number[] = [];

  for (const d of draftItems) {
    let bestIdx = -1;
    let best = 0;
    finalItems.forEach((f, idx) => {
      if (used.has(idx)) return;
      const s = nameSimilarity(d.name, f.name);
      if (s > best) {
        best = s;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0 && best >= DRAFT_MATCH_THRESHOLD) {
      used.add(bestIdx);
      matched++;
      const f = finalItems[bestIdx];
      if (canon(f.name) !== canon(d.name)) renamed++;
      if (d.grams != null && d.grams > 0 && f.grams != null) {
        gramsDeltas.push((Math.abs(f.grams - d.grams) / d.grams) * 100);
      }
    }
  }

  const itemsRemoved = draftItems.length - matched;
  const itemsAdded = finalItems.length - used.size;

  let kcalDeltaPct: number | null = null;
  if (draftTotals.calories != null && draftTotals.calories > 0 && finalTotals.calories != null) {
    kcalDeltaPct = ((finalTotals.calories - draftTotals.calories) / draftTotals.calories) * 100;
  }
  const gramsDeltaPct =
    gramsDeltas.length > 0 ? gramsDeltas.reduce((a, b) => a + b, 0) / gramsDeltas.length : null;

  const wasEdited =
    itemsAdded > 0 ||
    itemsRemoved > 0 ||
    renamed > 0 ||
    (gramsDeltaPct != null && gramsDeltaPct > EDIT_KCAL_PCT_THRESHOLD) ||
    (kcalDeltaPct != null && Math.abs(kcalDeltaPct) > EDIT_KCAL_PCT_THRESHOLD);

  return {
    itemsMatched: matched,
    itemsAdded,
    itemsRemoved,
    itemsRenamed: renamed,
    kcalDeltaPct: kcalDeltaPct == null ? null : Math.round(kcalDeltaPct * 10) / 10,
    gramsDeltaPct: gramsDeltaPct == null ? null : Math.round(gramsDeltaPct * 10) / 10,
    wasEdited,
  };
}
