import { type NextRequest } from 'next/server';

import { canonicalizeChatReaction } from '@/lib/chat/reactions';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleChatService } from '@/lib/services/circle-chat-service';

import { mapChatReactionError, ok } from '../reaction-route-helpers';

/** Path segments arrive decoded on Next 15; tolerate a still-encoded emoji too. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * DELETE /api/mobile/messages/[id]/reactions/[reaction]
 * Legacy (shipped clients): remove one specific reaction. New clients use
 * DELETE /api/mobile/messages/[id]/reactions (clears whatever the viewer set).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reaction: string }> }
) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const { id, reaction } = await params;

    const value = canonicalizeChatReaction(decodeSegment(reaction));
    if (!value) throw new Error('InvalidReaction');

    const reactions = await CircleChatService.removeReaction(id, user.id, value);
    return ok({ reactions }, startTime);
  } catch (error: any) {
    return mapChatReactionError(error, 'Remove reaction');
  }
}
