/**
 * Beverage Log Types
 * Type definitions for beverage logging feature
 */

export type BeverageCategory =
  | 'water'
  | 'coffee'
  | 'tea'
  | 'smoothie'
  | 'protein_shake'
  | 'juice'
  | 'soda'
  | 'alcohol'
  | 'energy_drink'
  | 'sports_drink'
  | 'milk'
  | 'other';

export type BeverageSource = 'manual' | 'import' | 'api' | 'ios' | 'android' | 'web';

export type Temperature = 'hot' | 'cold' | 'iced' | 'room_temp';

export type Size = 'small' | 'medium' | 'large' | 'extra_large';

export type MilkType = 'whole' | 'skim' | '2_percent' | 'oat' | 'almond' | 'soy' | 'coconut' | 'none';

/**
 * Flexible customizations for beverages
 * Can include size, temperature, milk type, add-ins, etc.
 */
export interface BeverageCustomizations {
  size?: Size;
  temperature?: Temperature;
  milk_type?: MilkType;
  sweetener?: string; // e.g., "honey", "sugar", "stevia"
  add_ins?: string[]; // e.g., ["cinnamon", "vanilla", "protein powder"]
  ice?: boolean;
  shots?: number; // for espresso drinks
  flavor?: string; // e.g., "vanilla", "caramel"
  [key: string]: any; // Allow for custom properties
}

/**
 * Main beverage log entry
 */
export interface BeverageLogEntry {
  id: string;
  user_id: string;
  category: BeverageCategory;
  beverage_type: string;
  customizations: BeverageCustomizations;
  volume_ml: number;
  calories?: number;
  caffeine_mg?: number;
  sugar_g?: number;
  notes?: string;
  is_favorite: boolean;
  favorite_name?: string;
  is_private: boolean;
  logged_at: string;
  entry_date: string;
  source: BeverageSource;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

/**
 * Input for creating a new beverage log entry
 */
export interface CreateBeverageLogInput {
  category: BeverageCategory;
  beverage_type: string;
  customizations?: BeverageCustomizations;
  volume_ml: number;
  calories?: number;
  caffeine_mg?: number;
  sugar_g?: number;
  notes?: string;
  is_favorite?: boolean;
  favorite_name?: string;
  is_private?: boolean;
  logged_at?: string;
  entry_date?: string;
  source?: BeverageSource;
}

/**
 * Input for updating a beverage log entry
 */
export interface UpdateBeverageLogInput {
  beverage_type?: string;
  customizations?: BeverageCustomizations;
  volume_ml?: number;
  calories?: number;
  caffeine_mg?: number;
  sugar_g?: number;
  notes?: string;
  is_favorite?: boolean;
  favorite_name?: string;
  is_private?: boolean;
}

/**
 * Statistics for beverage consumption
 */
export interface BeverageLogStats {
  total_entries: number;
  by_category: Record<BeverageCategory, number>;
  total_volume_ml: number;
  total_water_ml: number; // Only water category
  total_caffeine_mg: number;
  total_calories: number;
  total_sugar_g: number;
  avg_daily_entries: number;
  avg_daily_water_ml: number;
  streak_days: number; // Consecutive days with at least one beverage logged
  favorite_count: number;
  most_common_beverage?: {
    beverage_type: string;
    category: BeverageCategory;
    count: number;
  };
}

/**
 * Favorite beverage template
 */
export interface FavoriteBeverage {
  id: string;
  favorite_name: string;
  category: BeverageCategory;
  beverage_type: string;
  customizations: BeverageCustomizations;
  volume_ml: number;
  calories?: number;
  caffeine_mg?: number;
  sugar_g?: number;
  last_used_at: string;
}

/**
 * API response for list of beverage entries
 */
export interface BeverageLogListResponse {
  data: BeverageLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

/**
 * API response for single beverage entry
 */
export interface BeverageLogDetailResponse {
  data: BeverageLogEntry;
  canEdit: boolean;
}

/**
 * API response for beverage statistics
 */
export interface BeverageLogStatsResponse {
  data: BeverageLogStats;
  date_range: {
    start_date: string;
    end_date: string;
  };
}

/**
 * Query parameters for fetching beverage logs
 */
export interface BeverageLogQueryParams {
  page?: number;
  limit?: number;
  category?: BeverageCategory | 'all';
  start_date?: string;
  end_date?: string;
  favorites_only?: boolean;
}
