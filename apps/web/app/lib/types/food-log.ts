/**
 * Food Log Types
 * Type definitions for food, water, and supplement logging feature
 */

export type EntryType = 'food' | 'water' | 'supplement';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
export type Visibility = 'private' | 'shared' | 'circle';
export type Source = 'manual' | 'import' | 'api';

export interface NutritionData {
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  sugar_g?: number;
  sodium_mg?: number;
  [key: string]: number | undefined;
}

export interface FoodLogEntry {
  id: string;
  user_id: string;
  entry_type: EntryType;
  logged_at: string;
  entry_date: string;
  meal_type?: MealType;
  title?: string;
  description?: string;
  notes?: string;
  nutrition_data?: NutritionData;
  water_ml?: number;
  supplement_name?: string;
  supplement_dosage?: string;
  is_private: boolean;
  visibility: Visibility;
  has_images: boolean;
  image_count: number;
  tags: string[];
  location?: { lat: number; lng: number; name?: string };
  ai_analyzed: boolean;
  ai_analysis?: any;
  ai_analyzed_at?: string;
  source: Source;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface FoodLogImage {
  id: string;
  food_log_entry_id: string;
  user_id: string;
  storage_path: string;
  storage_bucket: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  width?: number;
  height?: number;
  thumbnail_path?: string;
  display_order: number;
  ai_analyzed: boolean;
  ai_tags: string[];
  ai_detected_foods: string[];
  ai_analysis?: any;
  upload_ip?: string;
  upload_user_agent?: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  // API URLs (added by backend, not stored in DB)
  url?: string; // Medium size URL
  original_url?: string;
  thumbnail_url?: string;
}

export interface FoodLogShare {
  id: string;
  food_log_entry_id: string;
  owner_id: string;
  shared_with_user_id?: string;
  shared_with_circle_id?: string;
  can_view: boolean;
  can_comment: boolean;
  share_message?: string;
  expires_at?: string;
  viewed_at?: string;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface FoodLogStats {
  total_entries: number;
  by_type: Record<EntryType, number>;
  by_meal: Record<MealType, number>;
  total_water_ml: number;
  total_calories: number;
  avg_daily_entries: number;
  streak_days: number;
}

export interface CreateFoodLogEntryInput {
  entry_type: EntryType;
  logged_at?: string;
  entry_date?: string;
  meal_type?: MealType;
  title?: string;
  description?: string;
  notes?: string;
  nutrition_data?: NutritionData;
  water_ml?: number;
  supplement_name?: string;
  supplement_dosage?: string;
  is_private?: boolean;
  visibility?: Visibility;
  tags?: string[];
}

export interface UpdateFoodLogEntryInput {
  meal_type?: MealType;
  title?: string;
  description?: string;
  notes?: string;
  nutrition_data?: NutritionData;
  water_ml?: number;
  supplement_name?: string;
  supplement_dosage?: string;
  is_private?: boolean;
  visibility?: Visibility;
  tags?: string[];
}

export interface ShareFoodLogInput {
  share_with: 'user' | 'circle';
  user_ids?: string[];
  circle_id?: string;
  can_comment?: boolean;
  expires_at?: string;
  message?: string;
}

export interface FeatureFlagResult {
  enabled: boolean;
  reason: 'tier' | 'explicit' | 'rollout' | 'disabled';
  access_level: 'full' | 'read_only' | 'none';
}

export interface FoodLogListResponse {
  data: FoodLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export interface FoodLogDetailResponse {
  data: FoodLogEntry;
  images: FoodLogImage[];
  canEdit: boolean;
  canShare: boolean;
}
