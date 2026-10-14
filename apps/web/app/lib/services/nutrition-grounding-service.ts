/**
 * Nutrition grounding — Phase 1 of docs/FOOD-AI-ACCURACY-PLAN-2026-10-13.md.
 *
 * The vision model says WHAT is on the plate and HOW MUCH (grams); this service replaces its
 * guessed nutrient density with a reference row when, and only when, a reference row clearly IS
 * that food. Three changes versus the legacy Dice-floor grounding in NutritionIntelligenceService:
 *
 *   1. Candidates come from the generic USDA layer only (FNDDS / SR Legacy / Foundation, 098)
 *      plus the user's own foods — never branded products ("fresh banana" → "FRESH BANANA NUT
 *      MUFFIN" was the typical failure; only 37–50% of grounded items were within ±20% of the
 *      true density in the §3a eval).
 *   2. A cheap text model picks the row — or says "none" — for the whole plate in one call,
 *      seeing each item's name, unit, grams and the candidates' names, categories and
 *      densities. Lexical overlap is only the fallback when that call fails.
 *   3. USDA household-measure weights (food_portions) act as portion priors: when the model
 *      says "1 cup" of a food and USDA knows a cup of it weighs 158 g, a wildly different
 *      gramsPerUnit is corrected; the same weights feed the client's unit picker.
 *
 * Failure-isolated end to end: any error leaves the item on the model's own numbers.
 */
import { generateText, Output } from 'ai';
import { z } from 'zod';

import type { FoodDTO, FoodPortionDTO } from '../types/foods';
import type { NutritionDraftItem, ParsedFoodItem, UnitOption } from '../types/nutrition';

import { FoodsService } from './foods-service';

export type GroundingMode = 'generic' | 'legacy' | 'off';

export const DEFAULT_PICKER_MODEL = 'anthropic/claude-haiku-5.5';
const PICKER_TIMEOUT_MS = 8_000;
const CANDIDATES_PER_ITEM = 8;
/** Fallback (no picker): accept a candidate only on a strict token Dice. */
const FALLBACK_DICE_FLOOR = 0.75;
/** Portion prior: correct the model's gramsPerUnit when it is outside [1/PRIOR_RATIO, PRIOR_RATIO] × USDA
 *  (a cup of cooked rice is 158 g; models habitually say 240 g = the water-cup weight).
 *  OFF by default: on the paired 2026-10-14 ablation it cost 6 pts of kcal±40% on Nutrition5k
 *  (USDA "cup"/"slice" weights are too ambiguous for mixed dishes). NUTRITION_PORTION_PRIOR=true enables. */
const PRIOR_RATIO = 1.5;
/**
 * Density clamp: the model's own macros are kept unless its kcal/100 g is more than CLAMP_RATIO×
 * off the matched reference row, in which case the reference density replaces them. Paired
 * ablation 2026-10-14 (same model outputs): replacing density unconditionally cost 1–6 pts of
 * kcal±40% (FNDDS rows assume added fat the plate may not have), while the clamp matched
 * model-only accuracy and still fixed the hallucinated densities (mean item density error 144%
 * on unmatched items). The reference row still supplies sodium (when the model gave none),
 * provenance (matchedFoodId) and the unit picker weights.
 */
const CLAMP_RATIO = 2;

const pickSchema = z.object({
  picks: z.array(
    z.object({
      item: z.number().int().describe('0-based index of the plate item'),
      candidate: z.number().int().nullable().describe('0-based index into that item\'s candidate list, or null when none is the same food in the same state'),
    }),
  ),
});

export interface GroundingOptions {
  mode?: GroundingMode;
  pickerModel?: string;
  /** Test seam / eval: replace the model call. */
  pick?: (items: ParsedFoodItem[], candidates: FoodDTO[][]) => Promise<Array<number | null>>;
}

export interface GroundingStats {
  mode: GroundingMode;
  candidates: number;
  grounded: number;
  /** Items whose macros were replaced by the reference density (model density implausible). */
  replaced: number;
  pickerUsed: boolean;
  pickerFailed: boolean;
  /** Matched reference kcal/100 g per item (null when unmatched) — for eval ablations. */
  dbKcalPer100g: Array<number | null>;
}

export class NutritionGroundingService {
  static modeFromEnv(): GroundingMode {
    const m = process.env.NUTRITION_GROUNDING_MODE;
    return m === 'legacy' || m === 'off' ? m : 'generic';
  }

  /**
   * Ground a parsed plate against the generic foods layer. Returns draft items (same order).
   */
  static async ground(
    userId: string,
    items: ParsedFoodItem[],
    opts: GroundingOptions = {},
  ): Promise<{ items: NutritionDraftItem[]; stats: GroundingStats }> {
    const mode = opts.mode ?? this.modeFromEnv();
    const stats: GroundingStats = { mode, candidates: 0, grounded: 0, replaced: 0, pickerUsed: false, pickerFailed: false, dbKcalPer100g: items.map(() => null) };
    if (mode === 'off' || items.length === 0) {
      return { items: items.map((it) => this.ungrounded(it)), stats };
    }

    // 1. Candidates per item (parallel; a failed search is just an empty list).
    const candidates = await Promise.all(
      items.map((it) => this.candidatesFor(userId, it)),
    );
    stats.candidates = candidates.reduce((n, c) => n + c.length, 0);
    if (stats.candidates === 0) return { items: items.map((it) => this.ungrounded(it)), stats };

    // 2. Pick one candidate (or none) per item.
    let picks: Array<number | null>;
    try {
      stats.pickerUsed = true;
      picks = await (opts.pick ?? ((i, c) => this.pickWithModel(i, c, opts.pickerModel ?? process.env.NUTRITION_GROUNDING_PICKER_MODEL ?? DEFAULT_PICKER_MODEL)))(items, candidates);
    } catch (err) {
      stats.pickerFailed = true;
      console.warn('[nutrition-grounding] picker failed, using lexical fallback:', (err as Error)?.message);
      picks = this.pickLexically(items, candidates);
    }

    // 3. Portion priors for the matched rows (one query).
    const matched = picks.map((p, i) => (p != null && candidates[i][p] ? candidates[i][p] : null));
    const portions = await FoodsService.portionsFor(matched.filter((m): m is FoodDTO => !!m).map((m) => m.id));

    const out = items.map((it, i) => {
      const food = matched[i];
      if (!food || food.per100g.calories == null) return this.ungrounded(it);
      stats.grounded++;
      stats.dbKcalPer100g[i] = food.per100g.calories;
      const applied = this.apply(it, food, portions.get(food.id) ?? []);
      if (applied.grams > 0 && it.grams > 0 && Math.abs(applied.calories / applied.grams - it.calories / it.grams) > 1e-6 * (it.calories / it.grams || 1)) stats.replaced++;
      return applied;
    });
    return { items: out, stats };
  }

  /**
   * Candidates from the model's database-style name first (e.g. "rice, white, cooked"), then
   * from the display name when that yields too little; de-duplicated, capped.
   */
  private static async candidatesFor(userId: string, it: ParsedFoodItem): Promise<FoodDTO[]> {
    const queries = [it.dbName, it.name].filter((q, i, a): q is string => !!q && a.indexOf(q) === i);
    const out: FoodDTO[] = [];
    for (const q of queries) {
      const found = await FoodsService.searchGeneric(userId, q, CANDIDATES_PER_ITEM).catch(() => [] as FoodDTO[]);
      for (const f of found) if (!out.some((o) => o.id === f.id)) out.push(f);
      if (out.length >= CANDIDATES_PER_ITEM) break;
    }
    return out.slice(0, CANDIDATES_PER_ITEM);
  }

  // MARK: - picking

  private static async pickWithModel(items: ParsedFoodItem[], candidates: FoodDTO[][], model: string): Promise<Array<number | null>> {
    const withCandidates = items.map((it, i) => ({ it, i, c: candidates[i] })).filter((x) => x.c.length > 0);
    if (withCandidates.length === 0) return items.map(() => null);
    const d = (f: FoodDTO) => `${Math.round(f.per100g.calories ?? 0)} kcal, P${r1(f.per100g.proteinG)} C${r1(f.per100g.carbsG)} F${r1(f.per100g.fatG)} per 100 g`;
    const lines: string[] = [];
    for (const { it, i, c } of withCandidates) {
      const own = it.grams > 0 ? `${Math.round((it.calories / it.grams) * 100)} kcal/100 g` : 'n/a';
      lines.push(`ITEM ${i}: "${it.name}"${it.dbName ? ` (generic: ${it.dbName})` : ''} — ${it.quantity} ${it.servingUnit}, ${Math.round(it.grams)} g, model's own density ${own}`);
      c.forEach((f, j) => lines.push(`  [${j}] ${f.name}${f.category ? ` (${f.category})` : ''}${f.isCustom ? ' (user\'s own food)' : ''} — ${d(f)}`));
    }
    const result = await generateText({
      model,
      output: Output.object({ schema: pickSchema }),
      maxRetries: 0,
      timeout: PICKER_TIMEOUT_MS,
      maxOutputTokens: 600,
      system: [
        'You match foods seen on a plate to reference database rows. For each ITEM pick the candidate index',
        'that is the SAME food in the SAME state (cooked vs raw, fried vs grilled, with vs without added fat/sauce,',
        'whole vs juice, fresh vs dried), or null when no candidate is. A user\'s own food that matches the name',
        'is preferred. Prefer the plainest matching row over a more specific sub-variant you cannot verify.',
        'Never pick a different food that merely shares words (e.g. "banana" vs "banana bread", "cherry tomatoes" vs',
        '"dried tomatoes", "chicken salad" vs "chicken, roasted"). When the candidate density is wildly different',
        'from the item\'s own density AND the names are only loosely related, answer null. Return exactly one pick per ITEM.',
        'USDA naming conventions: "fat not added in cooking" = steamed, boiled, plain or raw-served; "made with oil/butter"',
        '= sautéed, fried, roasted or stir-fried; "NS as to fat" = unknown preparation; "NFS" = unspecified variant.',
        'Pick the fat variant that matches how the item was cooked; for steamed/boiled/plain items never pick an oil/butter row.',
      ].join(' '),
      prompt: lines.join('\n'),
    });
    const picks: Array<number | null> = items.map(() => null);
    const parsed = result.output;
    for (const p of parsed.picks) {
      if (p.item < 0 || p.item >= items.length) continue;
      const c = candidates[p.item];
      picks[p.item] = p.candidate != null && p.candidate >= 0 && p.candidate < c.length ? p.candidate : null;
    }
    return picks;
  }

  /** Fallback when the picker call fails: strict token Dice against candidate names. */
  static pickLexically(items: ParsedFoodItem[], candidates: FoodDTO[][]): Array<number | null> {
    return items.map((it, i) => {
      let best: number | null = null;
      let bestDice = 0;
      candidates[i].forEach((f, j) => {
        const dice = this.dice(it.name, f.name);
        const score = dice + (f.isCustom ? 0.1 : 0);
        if (score > bestDice) { bestDice = score; best = j; }
      });
      return bestDice >= FALLBACK_DICE_FLOOR ? best : null;
    });
  }

  private static dice(a: string, b: string): number {
    const ta = new Set(FoodsService.contentTokens(a));
    const tb = new Set(FoodsService.contentTokens(b));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return (2 * inter) / (ta.size + tb.size);
  }

  // MARK: - applying a match

  /**
   * Attach the reference row to a model item. Model grams stay (unless the portion prior is on
   * and fires); model macros stay unless the model's density is implausible versus the row
   * (see CLAMP_RATIO), in which case the row's per-100 g panel × grams replaces them.
   */
  static apply(
    it: ParsedFoodItem,
    food: FoodDTO,
    portions: FoodPortionDTO[],
    opts: { portionPrior?: boolean } = {},
  ): NutritionDraftItem {
    const usePrior = opts.portionPrior ?? process.env.NUTRITION_PORTION_PRIOR === 'true';
    const { grams, gramsPerUnit, quantity, corrected } = usePrior
      ? this.portionPrior(it, portions)
      : { grams: it.grams > 0 ? it.grams : it.quantity * it.gramsPerUnit, gramsPerUnit: it.gramsPerUnit, quantity: it.quantity, corrected: false };
    const f = grams / 100;
    const r = (n: number | null | undefined) => Math.round(((n ?? 0) * f) * 10) / 10;
    const dbKcal = food.per100g.calories ?? 0;
    const modelKcal = it.grams > 0 ? (it.calories / it.grams) * 100 : 0;
    const ratio = dbKcal > 0 && modelKcal > 0 ? modelKcal / dbKcal : 1;
    const replace = !(ratio >= 1 / CLAMP_RATIO && ratio <= CLAMP_RATIO);
    // Model grams may have been corrected: rescale the model's own macros to the new grams.
    const scale = it.grams > 0 ? grams / it.grams : 1;
    const m = (n: number) => Math.round(n * scale * 10) / 10;
    const sodium = it.sodiumMg > 0 && !replace ? m(it.sodiumMg) : food.per100g.sodiumMg != null ? r(food.per100g.sodiumMg) : m(it.sodiumMg);
    const { dbName: _dbName, ...rest } = it;
    return {
      ...rest,
      grams,
      gramsPerUnit,
      quantity,
      // A corrected portion or replaced density is a real change; show lower confidence on it.
      confidence: corrected || replace ? Math.min(it.confidence, 0.6) : it.confidence,
      calories: replace ? r(food.per100g.calories) : m(it.calories),
      proteinG: replace ? r(food.per100g.proteinG) : m(it.proteinG),
      carbsG: replace ? r(food.per100g.carbsG) : m(it.carbsG),
      fatG: replace ? r(food.per100g.fatG) : m(it.fatG),
      fiberG: replace ? r(food.per100g.fiberG) : m(it.fiberG),
      sugarG: replace ? r(food.per100g.sugarG) : m(it.sugarG),
      sodiumMg: sodium,
      matchedFoodId: food.id,
      itemSource: 'foods_db',
      unitOptions: this.unitOptions(it, gramsPerUnit, portions),
    };
  }

  /**
   * Portion prior. If the model's serving unit is one USDA has a weight for on this food, and the
   * model's gramsPerUnit is more than PRIOR_RATIO× off that weight, trust USDA for the unit weight
   * and keep the model's quantity. Grams-as-truth is preserved otherwise.
   */
  static portionPrior(
    it: ParsedFoodItem,
    portions: FoodPortionDTO[],
  ): { grams: number; gramsPerUnit: number; quantity: number; corrected: boolean } {
    const grams = it.grams > 0 ? it.grams : it.quantity > 0 && it.gramsPerUnit > 0 ? it.quantity * it.gramsPerUnit : 0;
    const base = { grams, gramsPerUnit: it.gramsPerUnit, quantity: it.quantity, corrected: false };
    const unit = this.normalizeUnit(it.servingUnit);
    if (!unit || unit === 'g' || !(it.quantity > 0)) return base;
    // USDA often lists several weights for one unit ("1 slice, thin" 15 g … "1 slice, large" 38 g;
    // cups of chopped vs whole); the median is the unqualified typical weight. (SNAPMe ablation
    // 2026-10-14: taking the first row shrank toast to 15 g and cost 2 pts of kcal±25%.)
    const perUnit = portions
      .filter((p) => p.unit === unit && p.amount > 0 && p.gramWeight > 0)
      .map((p) => p.gramWeight / p.amount)
      .sort((a, b) => a - b);
    if (!perUnit.length) return base;
    const usdaPerUnit = perUnit[Math.floor((perUnit.length - 1) / 2)];
    const modelPerUnit = it.gramsPerUnit > 0 ? it.gramsPerUnit : grams / it.quantity;
    if (!(modelPerUnit > 0)) return base;
    const ratio = modelPerUnit / usdaPerUnit;
    if (ratio >= 1 / PRIOR_RATIO && ratio <= PRIOR_RATIO) return base;
    const corrected = Math.round(it.quantity * usdaPerUnit * 10) / 10;
    return { grams: corrected, gramsPerUnit: Math.round(usdaPerUnit * 10) / 10, quantity: it.quantity, corrected: true };
  }

  private static readonly UNIT_MAP: Record<string, string> = {
    cup: 'cup', cups: 'cup', tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp',
    oz: 'oz', ounce: 'oz', ounces: 'oz', 'fl oz': 'fl oz', slice: 'slice', slices: 'slice', piece: 'piece', pieces: 'piece',
    small: 'small', medium: 'medium', large: 'large', serving: 'serving', g: 'g', gram: 'g', grams: 'g', ml: 'ml',
  };
  static normalizeUnit(unit: string | null | undefined): string | null {
    if (!unit) return null;
    const u = unit.trim().toLowerCase().replace(/\s+/g, ' ');
    if (this.UNIT_MAP[u]) return this.UNIT_MAP[u];
    // "medium banana", "large egg", "slice of bread" → size/word prefix
    const first = u.split(' ')[0];
    return this.UNIT_MAP[first] ?? null;
  }

  private static unitOptions(it: ParsedFoodItem, gramsPerUnit: number, portions: FoodPortionDTO[]): UnitOption[] {
    const out: UnitOption[] = [];
    const push = (label: string, g: number) => {
      const key = label.trim().toLowerCase();
      if (!key || !(g > 0) || out.some((o) => o.label.toLowerCase() === key)) return;
      out.push({ label, gramsPerUnit: Math.round(g * 10) / 10 });
    };
    const natural = it.servingUnit?.trim();
    if (natural && natural.toLowerCase() !== 'g') push(natural, gramsPerUnit > 0 ? gramsPerUnit : it.grams || 1);
    push('g', 1);
    push('oz', 28.3495);
    for (const p of portions.slice(0, 8)) {
      if (p.unit === 'serving' && !p.description) continue;
      const label = p.amount === 1 ? p.unit : `${p.amount} ${p.unit}`;
      push(label, p.gramWeight); // the label already carries the amount, so its weight is the row's
      if (out.length >= 6) break;
    }
    return out;
  }

  private static ungrounded(it: ParsedFoodItem): NutritionDraftItem {
    const grams = it.grams > 0 ? it.grams : it.quantity > 0 && it.gramsPerUnit > 0 ? it.quantity * it.gramsPerUnit : it.grams;
    const out: UnitOption[] = [];
    const natural = it.servingUnit?.trim();
    if (natural && natural.toLowerCase() !== 'g') out.push({ label: natural, gramsPerUnit: it.gramsPerUnit > 0 ? it.gramsPerUnit : grams || 1 });
    out.push({ label: 'g', gramsPerUnit: 1 }, { label: 'oz', gramsPerUnit: 28.3495 });
    const { dbName: _dbName, ...rest } = it;
    return { ...rest, grams, matchedFoodId: null, itemSource: 'llm_vision', unitOptions: out };
  }
}

function r1(n: number | null | undefined): string {
  return n == null ? '–' : (Math.round(n * 10) / 10).toString();
}
