// HealthKit / Health Connect nutrition sync — shared contract (FROZEN). PRD v4 §6.2.
// Bidirectional: every FitCircle food log writes back to the platform (done natively on-device);
// imports from the platform (e.g. a user who keeps MyFitnessPal) flow IN via this batch endpoint,
// deduped by (user, source, external id). Single-source-of-truth: dedup + mapping server-side.

import { z } from 'zod';

export type HealthPlatform = 'healthkit' | 'healthconnect' | 'mfp';

export interface HealthNutritionSyncState {
  platform: HealthPlatform;
  enabled: boolean;
  lastSyncAt: string | null;
  lastCursor: string | null;
}

// One imported nutrition record from a platform. Macros are for the entry as consumed.
// externalId is the platform's stable id (HealthKit sample UUID / Health Connect record id / MFP id)
// — the dedup key so re-syncing the same window never double-inserts.
export const importedNutritionItemSchema = z.object({
  externalId: z.string().min(1),
  loggedAt: z.string(),            // ISO8601 when consumed
  name: z.string().min(1).default('Imported meal'),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']).optional(),
  calories: z.number().nonnegative().nullable().optional(),
  proteinG: z.number().nonnegative().nullable().optional(),
  carbsG: z.number().nonnegative().nullable().optional(),
  fatG: z.number().nonnegative().nullable().optional(),
});
export type ImportedNutritionItem = z.infer<typeof importedNutritionItemSchema>;

export const importNutritionRequestSchema = z.object({
  platform: z.enum(['healthkit', 'healthconnect', 'mfp']),
  items: z.array(importedNutritionItemSchema).max(500),
  cursor: z.string().nullable().optional(), // opaque; stored as last_cursor for the next pull
});
export type ImportNutritionRequest = z.infer<typeof importNutritionRequestSchema>;

export interface ImportNutritionResult {
  received: number;
  imported: number;   // newly inserted (deduped)
  skipped: number;    // already present (external id seen before)
  lastSyncAt: string;
}

// The platform nutrition data types a client should request authorization for (§6.2), surfaced
// here so the contract doc and clients agree on scope.
export const HEALTHKIT_NUTRITION_TYPES = [
  'dietaryEnergyConsumed', 'dietaryProtein', 'dietaryCarbohydrates', 'dietaryFatTotal', 'dietaryWater',
] as const;
export const HEALTHCONNECT_NUTRITION_TYPES = ['NutritionRecord', 'HydrationRecord'] as const;

// ============================================================================
// HealthNutritionService API surface (FROZEN)
// ----------------------------------------------------------------------------
// class HealthNutritionService {
//   static async getState(userId): Promise<HealthNutritionSyncState[]>      // all platforms
//   static async setEnabled(userId, platform, enabled): Promise<HealthNutritionSyncState>
//   // Idempotent batch import: insert items not already present (by user+source+externalId),
//   // skip dupes, advance the cursor + last_sync_at. nutrition_source = platform, input_method='imported'.
//   static async importBatch(userId, req: ImportNutritionRequest): Promise<ImportNutritionResult>
// }
// Note: write-BACK (FitCircle log → platform) happens natively on each device using the platform
// SDK; the server doesn't push to the platform. The server owns import dedup + sync cursor state.
// ============================================================================
