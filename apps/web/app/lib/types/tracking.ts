// Types for daily tracking and HealthKit integration

/**
 * Source of step count data
 */
export type StepsSource = 'manual' | 'healthkit' | 'google_fit';

/**
 * Daily tracking entry from database
 */
export interface DailyTrackingEntry {
  id: string;
  user_id: string;
  tracking_date: string;
  weight_kg?: number;
  steps?: number;
  mood_score?: number;
  energy_level?: number;
  notes?: string;
  steps_source: StepsSource;
  steps_synced_at?: string;
  is_override: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Input data for creating/updating daily tracking entry
 */
export interface DailyTrackingInput {
  weight_kg?: number;
  steps?: number;
  mood_score?: number;
  energy_level?: number;
  notes?: string;
  steps_source?: StepsSource;
  steps_synced_at?: string;
  is_override?: boolean;
}

/**
 * Bulk sync entry for historical HealthKit data
 */
export interface BulkSyncEntry {
  date: string; // YYYY-MM-DD format
  steps: number;
}

/**
 * Bulk sync request
 */
export interface BulkSyncRequest {
  steps_data: BulkSyncEntry[];
  source: 'healthkit' | 'google_fit';
}

/**
 * Bulk sync result for a single entry
 */
export interface BulkSyncResult {
  date: string;
  success: boolean;
  action?: 'inserted' | 'updated' | 'skipped';
  reason?: string;
  error?: string;
}

/**
 * Bulk sync response
 */
export interface BulkSyncResponse {
  success: true;
  synced_at: string;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  results: BulkSyncResult[];
}
