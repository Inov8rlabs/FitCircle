import { type NextRequest } from 'next/server';

import { fitzyFail, ok } from '@/lib/fitzy/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyMemoryService } from '@/lib/services/fitzy-memory-service';

export const dynamic = 'force-dynamic';

/** DELETE /api/mobile/fitzy/memory/{id} → { items } */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireMobileAuth(request);
    return ok({ items: await FitzyMemoryService.remove(user.id, (await params).id) });
  } catch (error) {
    return fitzyFail(error);
  }
}
