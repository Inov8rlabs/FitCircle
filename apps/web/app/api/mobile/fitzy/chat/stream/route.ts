import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { describeFitzyError, readJson } from '@/lib/fitzy/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyService, type FitzyStreamEvent } from '@/lib/services/fitzy-service';
import { safeParseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HEARTBEAT_MS = 10_000;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  circleId: z.string().trim().min(1).max(100).optional(),
  clientMessages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4000) }))
    .max(50)
    .optional(),
});

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * POST /api/mobile/fitzy/chat/stream → text/event-stream (docs/FITZY_V2_SPEC.md §3.1).
 * Events: meta → delta* → (replace) → done, or a single error. `: ping` every 10 s.
 * Text is guarded sentence by sentence before it leaves the server.
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      const close = () => {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      const sendError = (error: unknown) => {
        const d = describeFitzyError(error);
        write(frame('error', { code: d.code, message: d.message, ...(d.paywall ? { paywall: d.paywall } : {}) }));
      };

      try {
        const user = await requireMobileAuth(request);
        const parsed = safeParseLenient(bodySchema, await readJson(request));
        if (!parsed.success) {
          write(frame('error', { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' }));
          return close();
        }
        const body = parsed.data;
        await FitzyService.streamChat(
          user.id,
          {
            message: body.message,
            conversationId: body.conversationId ?? null,
            circleId: body.circleId,
            clientMessages: body.conversationId ? undefined : body.clientMessages,
            timezone: request.headers.get('x-client-timezone'),
          },
          (e: FitzyStreamEvent) => write(frame(e.event, e.data)),
          request.signal
        );
      } catch (error) {
        sendError(error);
      } finally {
        close();
      }
    },
  });

  return new Response(stream, { status: 200, headers });
}
