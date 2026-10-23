/**
 * Pure helpers behind the iOS-style Food Log feed (FoodLogView.swift):
 * filter chips, newest-first day groups, one folded water card per day, and the
 * meal card's macro + item lines. No React so it is unit-testable.
 */

export type FoodLogFilter = 'all' | 'today' | 'week' | 'month' | 'meals' | 'water';

export const FOOD_LOG_FILTERS: { id: FoodLogFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'meals', label: 'Meals Only' },
  { id: 'water', label: 'Water' },
];

/** Loose row shape: food_log_entries and beverage_logs rows as the page loads them. */
export type FeedEntry = Record<string, any> & { id: string };

export type EntryKind = 'food' | 'water' | 'beverage';

/**
 * food_log_entries rows carry `entry_type` (food | water | supplement);
 * beverage_logs rows carry `category` instead (water | coffee | tea | …).
 */
export function entryKind(e: FeedEntry): EntryKind {
  if (e.entry_type === 'water') return 'water';
  if (e.entry_type) return 'food';
  if (e.category === 'water') return 'water';
  if (e.category) return 'beverage';
  return 'food';
}

export function entryTime(e: FeedEntry): Date {
  return new Date(e.logged_at ?? e.created_at ?? e.entry_date);
}

/** YYYY-MM-DD the entry belongs to (entry_date when present, else local date of logged_at). */
export function entryDay(e: FeedEntry): string {
  if (typeof e.entry_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.entry_date)) return e.entry_date.slice(0, 10);
  const d = entryTime(e);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight for a YYYY-MM-DD key (avoids the UTC shift of `new Date('2026-10-22')`). */
export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function waterMl(e: FeedEntry): number {
  const v = Number(e.water_ml ?? e.volume_ml ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function applyFilter(entries: FeedEntry[], filter: FoodLogFilter, now: Date = new Date()): FeedEntry[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(startOfToday);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const monthAgo = new Date(startOfToday);
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  return entries.filter((e) => {
    const kind = entryKind(e);
    const day = dayKeyToDate(entryDay(e));
    switch (filter) {
      case 'all':
        return true;
      case 'today':
        return day.getTime() === startOfToday.getTime();
      case 'week':
        return day >= weekAgo;
      case 'month':
        return day >= monthAgo;
      case 'meals':
        return kind === 'food';
      case 'water':
        return kind === 'water';
    }
  });
}

export interface DayGroup {
  key: string;
  date: Date;
  /** Meals, snacks, supplements and non-water drinks, newest first. */
  rows: FeedEntry[];
  /** All of the day's water logs (folded into one card), newest first. */
  water: FeedEntry[];
  waterTotalMl: number;
}

/** Newest day first; inside a day newest first, so the meal just logged lands on top. */
export function groupByDay(entries: FeedEntry[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const e of entries) {
    const key = entryDay(e);
    let g = map.get(key);
    if (!g) {
      g = { key, date: dayKeyToDate(key), rows: [], water: [], waterTotalMl: 0 };
      map.set(key, g);
    }
    if (entryKind(e) === 'water') {
      g.water.push(e);
      g.waterTotalMl += waterMl(e);
    } else {
      g.rows.push(e);
    }
  }
  const byTimeDesc = (a: FeedEntry, b: FeedEntry) => entryTime(b).getTime() - entryTime(a).getTime();
  const groups = [...map.values()];
  for (const g of groups) {
    g.rows.sort(byTimeDesc);
    g.water.sort(byTimeDesc);
  }
  return groups.sort((a, b) => b.key.localeCompare(a.key));
}

/** "250 ml" under a litre, else litres without trailing zeros ("1.75 L", "2 L"), like WaterDayCard.format. */
export function formatWater(ml: number): string {
  const v = Math.round(ml);
  if (v < 1000) return `${v} ml`;
  return `${(v / 1000).toFixed(2).replace(/\.?0+$/, '')} L`;
}

export interface Macros {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Macros from `nutrition_data` (current rows) with top-level fallbacks (legacy / beverage rows). */
export function entryMacros(e: FeedEntry): Macros {
  const nd = (e.nutrition_data ?? {}) as Record<string, unknown>;
  return {
    kcal: num(nd.calories) ?? num(e.calories),
    protein: num(nd.protein_g) ?? num(e.protein_g),
    carbs: num(nd.carbs_g) ?? num(e.carbs_g),
    fat: num(nd.fat_g) ?? num(e.fat_g),
  };
}

const UNICODE_FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾', '0.33': '⅓', '0.67': '⅔' };

function quantityText(q: unknown): string {
  const n = num(q);
  if (n === null || n <= 0) return '';
  const whole = Math.floor(n);
  const frac = UNICODE_FRACTIONS[(n - whole).toFixed(2)] ?? '';
  if (frac) return whole > 0 ? `${whole}${frac}` : frac;
  return n === Math.round(n) ? String(n) : n.toFixed(1);
}

/** "¾ cup Veg tofu pad Thai (195 kcal)" lines from the AI item breakdown. */
export function itemLines(e: FeedEntry, max = 2): { lines: string[]; more: number } {
  const items = Array.isArray(e.nutrition_data?.items) ? (e.nutrition_data.items as Record<string, unknown>[]) : [];
  const lines = items
    .filter((it) => typeof it.name === 'string' && it.name.trim())
    .map((it) => {
      const qty = quantityText(it.quantity);
      const unit = typeof it.serving_unit === 'string' && it.serving_unit && it.serving_unit !== 'serving' ? it.serving_unit : '';
      const kcal = num(it.calories);
      const amount = [qty, unit].filter(Boolean).join(' ');
      return `${amount ? `${amount} ` : ''}${String(it.name).trim()}${kcal !== null ? ` (${Math.round(kcal)} kcal)` : ''}`;
    });
  return { lines: lines.slice(0, max), more: Math.max(0, lines.length - max) };
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  supplement: 'Supplement',
};

function titleCase(s: string): string {
  return s
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** iOS meal card title is the meal type ("Dinner"); the dish becomes the first line. */
export function cardTitle(e: FeedEntry): { title: string; detail: string | null } {
  const kind = entryKind(e);
  if (kind === 'beverage') return { title: titleCase(String(e.beverage_type || e.category || 'Drink')), detail: null };
  if (e.entry_type === 'supplement') return { title: 'Supplement', detail: e.supplement_name ?? e.title ?? null };
  const meal = typeof e.meal_type === 'string' ? MEAL_LABELS[e.meal_type] ?? titleCase(e.meal_type) : null;
  const dish = (typeof e.title === 'string' && e.title.trim()) || (typeof e.description === 'string' && e.description.trim()) || null;
  if (meal) return { title: meal, detail: dish && dish.toLowerCase() !== meal.toLowerCase() ? dish : null };
  return { title: dish ? titleCase(dish) : 'Meal', detail: null };
}

export function imageUrls(e: FeedEntry): string[] {
  if (Array.isArray(e.image_urls)) return e.image_urls.filter((u: unknown): u is string => typeof u === 'string');
  if (Array.isArray(e.images)) {
    return e.images
      .map((i: { thumbnail_url?: string; url?: string }) => i?.thumbnail_url || i?.url)
      .filter((u: unknown): u is string => typeof u === 'string' && u.length > 0);
  }
  return [];
}
