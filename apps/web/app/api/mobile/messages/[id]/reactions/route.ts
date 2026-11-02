import { type NextRequest } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleChatService } from '@/lib/services/circle-chat-service';
import { parseLenient } from '@/lib/validation/lenient-parse';

import { mapChatReactionError, ok, reactionBodySchema } from './reaction-route-helpers';

// Circle Chat Reactions v2 — docs/CHAT_REACTIONS_V2.md. One reaction per person
// per message; `reaction` is a named kind or a single emoji.

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/mobile/messages/[id]/reactions  { reaction }
 * Set the viewer's reaction (replaces any previous one).
 * → { success, data: { reactions: ReactionSummary[] }, error, meta }
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const { reaction } = parseLenient(reactionBodySchema, await request.json());
    const reactions = await CircleChatService.setReaction(id, user.id, reaction);
    return ok({ reactions }, startTime);
  } catch (error: any) {
    return mapChatReactionError(error, 'Set reaction');
  }
}

/**
 * POST /api/mobile/messages/[id]/reactions  { reaction }
 * Legacy (shipped clients). Same replace semantics as PUT.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const { reaction } = parseLenient(reactionBodySchema, await request.json());
    const reactions = await CircleChatService.addReaction(id, user.id, reaction);
    return ok({ reactions }, startTime);
  } catch (error: any) {
    return mapChatReactionError(error, 'Add reaction');
  }
}

/**
 * DELETE /api/mobile/messages/[id]/reactions
 * Clear the viewer's reaction (idempotent). Same response as PUT.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const reactions = await CircleChatService.clearReaction(id, user.id);
    return ok({ reactions }, startTime);
  } catch (error: any) {
    return mapChatReactionError(error, 'Clear reaction');
  }
}

/**
 * GET /api/mobile/messages/[id]/reactions
 * Who reacted with what — circle members only.
 * → { success, data: { reactors: [{ user_id, display_name, avatar_url, reaction, emoji, reacted_at }] } }
 *   viewer first, then newest.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const reactors = await CircleChatService.listReactors(id, user.id);
    return ok({ reactors }, startTime);
  } catch (error: any) {
    return mapChatReactionError(error, 'List reactors');
  }
}
