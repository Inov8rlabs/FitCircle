/**
 * Web food-log delete (cookie session). The web Food Log list and feed used to call
 * FoodLogService.deleteEntry directly from client components, which pulled server-only
 * modules (notifications, remote config → next/headers) into the client bundle.
 * Deleting through this route keeps that code on the server and runs the same side
 * effects as the mobile route (audit row, circle chat tombstone).
 */
import { type NextRequest, NextResponse } from 'next/server';

import { FoodLogService } from '@/lib/services/food-log-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { createServerSupabase } from '@/lib/supabase-server';
import { runAfterResponse } from '@/lib/utils/after-response';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const result = await FoodLogService.deleteEntry(id, user.id, createAdminSupabase(), {
    defer: (task) => runAfterResponse(task, 'web food-log delete side effect'),
  });

  if (!result.success) {
    if (result.notFound) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    return NextResponse.json({ error: 'Could not delete the entry' }, { status: 500 });
  }
  return NextResponse.json({ success: true, deleted: result.deleted === true });
}
