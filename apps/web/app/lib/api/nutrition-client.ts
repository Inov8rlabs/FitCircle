import { useAuthStore } from '@/stores/auth-store';

// ---------------------------------------------------------------------------
// Nutrition client — typed wrappers over the frozen mobile nutrition routes.
// Built against docs/NUTRITION_CLIENT_API_CONTRACT.md. Mirrors the existing
// circle-chat-client / quest-boost-client authedFetch pattern: Bearer JWT from
// useAuthStore, standard envelope { success, data, error, meta } unwrapped to
// `data`. Clients are thin renderers — never re-derive nutrition logic.
// ---------------------------------------------------------------------------

/** Below this confidence, default to manual entry rather than a shaky guess (§12). */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

// --- DTO shapes (camelCase JSON from the contract) -------------------------

export interface UnitOption {
  label: string;
  gramsPerUnit: number;
}

export interface NutritionDraftItem {
  name: string;
  quantity: number;
  quantityRange: { min: number; max: number } | null;
  servingUnit: string;
  grams?: number;
  gramsPerUnit?: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
  confidence: number;
  matchedFoodId?: string | null;
  itemSource?: string;
  unitOptions?: UnitOption[];
}

export interface NutritionTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
}

export interface NutritionDraft {
  items: NutritionDraftItem[];
  overallConfidence: number;
  notes: string | null;
  inputMethod: 'photo' | 'voice';
  nutritionSource: 'llm_vision' | 'llm_voice';
  model: string;
  cached: boolean;
  totals: NutritionTotals;
  healthScore?: number | null;
}

export interface FoodPer100g {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
}

export interface Food {
  id: string;
  source: 'off' | 'usda' | 'custom' | 'recipe';
  name: string;
  brand: string | null;
  barcode: string | null;
  servingSizeG: number | null;
  servingUnit: string | null;
  per100g: FoodPer100g;
  locale: string | null;
  isCustom: boolean;
}

export interface CreateCustomFood {
  name: string;
  brand?: string;
  servingSizeG?: number;
  servingUnit?: string;
  per100g: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number;
    sugarG?: number;
  };
  recipeIngredients?: Array<{ name: string; grams: number; foodId?: string }>;
  recipeServings?: number;
}

export interface PlateScore {
  score: number; // 0..100
  date: string;
  components: { adherence: number; balance: number; goalFit: number };
  breakdown: Record<string, unknown>;
}

export type ReactionKind = 'flame' | 'clap' | 'eyes' | 'same' | 'heart' | 'laugh';

export interface FoodReactionSummary {
  reaction: ReactionKind;
  count: number;
  reactedByMe: boolean;
}

export interface FoodFeedCard {
  id: string;
  owner: { id: string; name: string; avatarUrl: string | null };
  foodName: string;
  loggedAt: string;
  photoUrl: string | null;
  macros: NutritionTotals | null; // null when privacy hides them
  reactions: FoodReactionSummary[];
}

export interface FoodFeedResult {
  cards: FoodFeedCard[];
  hasMore: boolean;
  nextBefore: string | null;
}

export type PrivacyTier = 'full' | 'summary' | 'private';

export interface NutritionLeaderboardRow {
  userId: string;
  name: string;
  adherencePct: number;
  calorieGoalHitRatePct: number;
  nutritionLogStreak: number;
}

// --- Nutrition-driven challenge (§6.5) -------------------------------------
// Shapes mirror app/lib/types/nutrition-challenge.ts (the server DTOs).

export type NutritionMetricType =
  | 'calorie_target'
  | 'protein_target'
  | 'carb_target'
  | 'veg_days'
  | 'sober_days'
  | 'standard';

export const NUTRITION_METRIC_TYPES: readonly NutritionMetricType[] = [
  'calorie_target',
  'protein_target',
  'carb_target',
  'veg_days',
  'sober_days',
  'standard',
] as const;

/** Metric types that require a numeric daily target_value to be meaningful. */
export const TARGET_REQUIRED_METRICS: readonly NutritionMetricType[] = [
  'calorie_target',
  'protein_target',
  'carb_target',
] as const;

export interface NutritionChallengeConfig {
  id: string;
  fitcircleId: string;
  metricType: NutritionMetricType;
  targetValue: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NutritionChallengeMember {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface NutritionChallengeMemberProgress {
  member: NutritionChallengeMember;
  successDays: number;
  daysLogged: number;
  challengeDays: number;
  adherencePct: number;
  averageValue: number | null;
  rank: number;
  isCurrentUser: boolean;
}

export interface NutritionChallengeProgress {
  fitcircleId: string;
  metricType: NutritionMetricType;
  targetValue: number | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  challengeDays: number;
  rows: NutritionChallengeMemberProgress[];
}

export interface NutritionChallenge {
  config: NutritionChallengeConfig | null;
  progress: NutritionChallengeProgress | null;
}

// --- Circle streak (§6.13) -------------------------------------------------

export interface CircleStreak {
  fitcircleId: string;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  updatedAt: string | null;
}

export interface CircleStreakSaveResult {
  save: {
    id: string;
    fitcircleId: string;
    saverUserId: string;
    coveredUserId: string;
    saveDate: string;
    createdAt: string;
  };
  created: boolean;
  streak: CircleStreak;
}

// --- Group meals / dining-out (§6.12) --------------------------------------

export type GroupMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
export type GroupMealTagStatus = 'pending' | 'accepted' | 'declined';

export interface GroupMealMacros {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface GroupMealTag {
  id: string;
  groupMealId: string;
  taggedUserId: string;
  status: GroupMealTagStatus;
  acceptedFoodLogEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMeal {
  id: string;
  fitcircleId: string;
  creatorId: string;
  name: string;
  restaurantName: string | null;
  loggedAt: string;
  mealType: GroupMealType;
  macros: GroupMealMacros;
  photoUrl: string | null;
  createdAt: string;
  tags: GroupMealTag[];
}

export interface PendingGroupMealTag {
  tag: GroupMealTag;
  groupMeal: GroupMeal;
}

export interface CreateGroupMealInput {
  fitcircleId: string;
  name: string;
  restaurantName?: string;
  mealType: GroupMealType;
  macros?: { calories: number; proteinG: number; carbsG: number; fatG: number };
  photoUrl?: string;
  taggedUserIds: string[];
}

// --- Dietary preferences / units (§6.15) -----------------------------------

export type DietType =
  | 'none'
  | 'vegetarian'
  | 'vegan'
  | 'pescatarian'
  | 'halal'
  | 'kosher'
  | 'gluten_free';

export const DIET_TYPES: readonly DietType[] = [
  'none',
  'vegetarian',
  'vegan',
  'pescatarian',
  'halal',
  'kosher',
  'gluten_free',
] as const;

export type DietaryUnits = 'metric' | 'imperial';

export interface DietaryPreferences {
  diet: DietType;
  allergens: string[];
  units: DietaryUnits;
}

export interface SetDietaryPreferencesInput {
  diet?: DietType;
  allergens?: string[];
  units?: DietaryUnits;
}

export interface CoachAnswer {
  answer: string;
  disclaimer: string;
}

// --- Fitzy — the FitCircle AI coach (multi-turn; client holds history) ------

export type FitzyRole = 'user' | 'assistant';

export interface FitzyMessage {
  role: FitzyRole;
  content: string;
}

export interface FitzyChatResponse {
  /** Markdown. */
  answer: string;
  disclaimer: string;
}

export interface Insight {
  id: string;
  headline: string;
  detail: string;
  signalA: string;
  signalB: string;
  correlation: number;
  sampleDays: number;
  confidence: 'low' | 'medium';
}

// --- Food-log create (existing endpoint; confirm-then-commit commits here) --

/** One persisted ingredient inside nutrition_data.items (snake_case wire shape). */
export interface SavedFoodItemPayload {
  name: string;
  quantity?: number | null;
  serving_unit?: string | null;
  grams?: number | null;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
}

/** nutrition_data payload: the four core macros (drive the typed columns) plus an
 *  optional rich breakdown the backend stores whole and returns on read. */
export interface NutritionDataPayload {
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  sugar_g?: number;
  sodium_mg?: number;
  health_score?: number | null;
  items?: SavedFoodItemPayload[];
}

export interface CreateFoodLogEntry {
  entry_type: 'food';
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
  title: string;
  description?: string;
  notes?: string;
  nutrition_data?: NutritionDataPayload;
  logged_at?: string;
  visibility?: 'private' | 'shared' | 'circle';
}

// --- envelope plumbing -----------------------------------------------------

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: Record<string, unknown> | null } | null;
  meta: unknown;
}

/**
 * Error that preserves the API envelope's `code` + `details` (plain Error loses them).
 * Lets callers act on e.g. PARSE_FAILED with details.savedEntryId (Option B fallback).
 */
export class ApiError extends Error {
  code: string;
  details: Record<string, unknown> | null;
  constructor(message: string, code: string, details: Record<string, unknown> | null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

function authToken(): string {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  return token;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${authToken()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || json?.success === false) {
    const msg = json?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiError(
      typeof msg === 'string' ? msg : 'Request failed',
      json?.error?.code ?? 'UNKNOWN',
      json?.error?.details ?? null,
    );
  }
  return json.data as T;
}

/** Multipart variant — do NOT set Content-Type (browser sets the boundary). */
async function authedFetchForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken()}` },
    body: form,
    credentials: 'include',
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || json?.success === false) {
    const msg = json?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiError(
      typeof msg === 'string' ? msg : 'Request failed',
      json?.error?.code ?? 'UNKNOWN',
      json?.error?.details ?? null,
    );
  }
  return json.data as T;
}

// --- client ----------------------------------------------------------------

export const nutritionClient = {
  // Photo / voice → draft (confirm-then-commit; do NOT create a log)
  photoParse: (image: File) => {
    const form = new FormData();
    form.append('image', image);
    return authedFetchForm<NutritionDraft>('/api/mobile/food/photo-parse', form);
  },

  voiceParse: (transcript: string) =>
    authedFetch<NutritionDraft>('/api/mobile/food/voice-parse', {
      method: 'POST',
      body: JSON.stringify({ transcript }),
    }),

  // Foods search / barcode / custom
  searchFoods: (q: string, opts?: { limit?: number; locale?: string }) => {
    const qs = new URLSearchParams({ q });
    if (opts?.limit != null) qs.set('limit', String(opts.limit));
    if (opts?.locale) qs.set('locale', opts.locale);
    return authedFetch<Food[]>(`/api/mobile/foods/search?${qs.toString()}`);
  },

  getBarcode: (code: string) =>
    authedFetch<Food>(`/api/mobile/foods/barcode/${encodeURIComponent(code)}`),

  listCustomFoods: () => authedFetch<Food[]>('/api/mobile/foods/custom'),

  createCustomFood: (input: CreateCustomFood) =>
    authedFetch<Food>('/api/mobile/foods/custom', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Plate Score
  getPlateScore: (date?: string) => {
    const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
    return authedFetch<PlateScore>(`/api/mobile/plate-score${suffix}`);
  },

  getPlateScoreRange: (start: string, end: string) =>
    authedFetch<PlateScore[]>(
      `/api/mobile/plate-score/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    ),

  // Social food feed + reactions
  getFoodFeed: (circleId: string, opts?: { before?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.before) qs.set('before', opts.before);
    if (opts?.limit != null) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authedFetch<FoodFeedResult>(`/api/mobile/circles/${circleId}/food-feed${suffix}`);
  },

  addFoodReaction: (foodLogId: string, reaction: ReactionKind) =>
    authedFetch<{ reactions: FoodReactionSummary[] }>(
      `/api/mobile/food-log/${foodLogId}/reactions`,
      { method: 'POST', body: JSON.stringify({ reaction }) }
    ),

  removeFoodReaction: (foodLogId: string, reaction: ReactionKind) =>
    authedFetch<{ reactions: FoodReactionSummary[] }>(
      `/api/mobile/food-log/${foodLogId}/reactions/${reaction}`,
      { method: 'DELETE' }
    ),

  getNutritionLeaderboard: (circleId: string) =>
    authedFetch<NutritionLeaderboardRow[]>(
      `/api/mobile/circles/${circleId}/nutrition-leaderboard`
    ),

  // Privacy tiers
  getFoodPrivacy: (circleId: string) =>
    authedFetch<{ tier: PrivacyTier }>(`/api/mobile/circles/${circleId}/food-privacy`),

  setFoodPrivacy: (circleId: string, tier: PrivacyTier) =>
    authedFetch<{ tier: PrivacyTier }>(`/api/mobile/circles/${circleId}/food-privacy`, {
      method: 'POST',
      body: JSON.stringify({ tier }),
    }),

  // Nutrition-driven challenge (§6.5)
  getNutritionChallenge: (circleId: string) =>
    authedFetch<NutritionChallenge>(`/api/mobile/circles/${circleId}/nutrition-challenge`),

  setNutritionChallenge: (
    circleId: string,
    metricType: NutritionMetricType,
    targetValue: number | null
  ) =>
    authedFetch<{ config: NutritionChallengeConfig }>(
      `/api/mobile/circles/${circleId}/nutrition-challenge`,
      { method: 'POST', body: JSON.stringify({ metricType, targetValue }) }
    ),

  // Circle streak (§6.13)
  getCircleStreak: (circleId: string) =>
    authedFetch<CircleStreak>(`/api/mobile/circles/${circleId}/streak`),

  /** "Cover for a member" — record a pro-social streak save. */
  useStreakSave: (circleId: string, coveredUserId: string, date?: string) =>
    authedFetch<CircleStreakSaveResult>(`/api/mobile/circles/${circleId}/streak/save`, {
      method: 'POST',
      body: JSON.stringify({ coveredUserId, ...(date ? { date } : {}) }),
    }),

  // Group meals / dining-out (§6.12)
  createGroupMeal: (input: CreateGroupMealInput) =>
    authedFetch<GroupMeal>('/api/mobile/group-meals', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getPendingGroupMeals: () =>
    authedFetch<PendingGroupMealTag[]>('/api/mobile/group-meals/pending'),

  acceptGroupMealTag: (tagId: string) =>
    authedFetch<GroupMealTag>(
      `/api/mobile/group-meals/tags/${encodeURIComponent(tagId)}/accept`,
      { method: 'POST' }
    ),

  declineGroupMealTag: (tagId: string) =>
    authedFetch<GroupMealTag>(
      `/api/mobile/group-meals/tags/${encodeURIComponent(tagId)}/decline`,
      { method: 'POST' }
    ),

  getGroupMeal: (id: string) =>
    authedFetch<GroupMeal>(`/api/mobile/group-meals/${encodeURIComponent(id)}`),

  /** Restaurant menu-item lookup (Nutritionix). Empty without server keys → fall back to photo. */
  searchRestaurant: (q: string) =>
    authedFetch<Food[]>(`/api/mobile/foods/restaurant?q=${encodeURIComponent(q)}`),

  // Dietary preferences / units (§6.15)
  getDietaryPreferences: () =>
    authedFetch<DietaryPreferences>('/api/mobile/dietary-preferences'),

  setDietaryPreferences: (input: SetDietaryPreferencesInput) =>
    authedFetch<DietaryPreferences>('/api/mobile/dietary-preferences', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // AI coach (legacy single Q&A — superseded by Fitzy multi-turn chat)
  askCoach: (question: string, circleId?: string) =>
    authedFetch<CoachAnswer>('/api/mobile/nutrition-coach', {
      method: 'POST',
      body: JSON.stringify({ question, ...(circleId ? { circleId } : {}) }),
    }),

  /**
   * Fitzy — multi-turn AI coach. The client owns the conversation: pass the recent
   * turns (oldest→newest, last = the new user message). Backend stays stateless.
   */
  fitzyChat: (messages: FitzyMessage[], circleId?: string) =>
    authedFetch<FitzyChatResponse>('/api/mobile/fitzy/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, ...(circleId ? { circleId } : {}) }),
    }),

  // Cross-signal insights
  getInsights: (lookbackDays?: number) => {
    const suffix = lookbackDays != null ? `?lookbackDays=${lookbackDays}` : '';
    return authedFetch<Insight[]>(`/api/mobile/insights${suffix}`);
  },

  // Confirm-then-commit: commits the reviewed draft via the existing create endpoint.
  createFoodLog: (input: CreateFoodLogEntry) =>
    authedFetch<{ id: string }>('/api/mobile/food-log', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
