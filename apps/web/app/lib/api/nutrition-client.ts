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

export interface NutritionDraftItem {
  name: string;
  quantity: number;
  quantityRange: { min: number; max: number } | null;
  servingUnit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: number;
}

export interface NutritionTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
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

export interface NutritionChallengeProgressRow {
  userId: string;
  name: string;
  value: number;
  [key: string]: unknown;
}

export interface NutritionChallenge {
  config: Record<string, unknown>;
  progress: NutritionChallengeProgressRow[];
}

export interface CircleStreak {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
}

export interface CoachAnswer {
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

export interface CreateFoodLogEntry {
  entry_type: 'food';
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
  title: string;
  description?: string;
  notes?: string;
  /** macro map e.g. { calories, protein_g, carbs_g, fat_g } */
  nutrition_data?: Record<string, number>;
  logged_at?: string;
  visibility?: 'private' | 'shared' | 'circle';
}

// --- envelope plumbing -----------------------------------------------------

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  meta: unknown;
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
    throw new Error(typeof msg === 'string' ? msg : 'Request failed');
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
    throw new Error(typeof msg === 'string' ? msg : 'Request failed');
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

  // Nutrition-driven challenge
  getNutritionChallenge: (circleId: string) =>
    authedFetch<NutritionChallenge>(`/api/mobile/circles/${circleId}/nutrition-challenge`),

  createNutritionChallenge: (
    circleId: string,
    metricType: string,
    targetValue: number
  ) =>
    authedFetch<NutritionChallenge>(`/api/mobile/circles/${circleId}/nutrition-challenge`, {
      method: 'POST',
      body: JSON.stringify({ metricType, targetValue }),
    }),

  // Circle streak
  getCircleStreak: (circleId: string) =>
    authedFetch<CircleStreak>(`/api/mobile/circles/${circleId}/streak`),

  saveCircleStreak: (circleId: string, coveredUserId: string, date?: string) =>
    authedFetch<CircleStreak>(`/api/mobile/circles/${circleId}/streak/save`, {
      method: 'POST',
      body: JSON.stringify({ coveredUserId, ...(date ? { date } : {}) }),
    }),

  // AI coach
  askCoach: (question: string, circleId?: string) =>
    authedFetch<CoachAnswer>('/api/mobile/nutrition-coach', {
      method: 'POST',
      body: JSON.stringify({ question, ...(circleId ? { circleId } : {}) }),
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
