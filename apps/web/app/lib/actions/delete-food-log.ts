'use server';

import { createServerSupabase } from '../supabase-server';
import { FoodLogService } from '../services/food-log-service';
import { runAfterResponse } from '../utils/after-response';

/** Keep notification/provider dependencies on the server and derive ownership from verified auth. */
export async function deleteFoodLogEntry(entryId: string): Promise<{ success: boolean }> {
  if (typeof entryId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(entryId)) return { success: false };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { success: false };
  const result = await FoodLogService.deleteEntry(entryId, data.user.id, supabase, {
    defer: task => runAfterResponse(task, 'food log deletion'),
  });
  return { success: result.success };
}
