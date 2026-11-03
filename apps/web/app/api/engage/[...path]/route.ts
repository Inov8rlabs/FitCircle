import { getFitCircleEngage } from '@/lib/engage/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Connector maintenance combines bounded capture/drain/mirror phases.
// Keep platform timeout above their combined worst-case network/SQL budget.
export const maxDuration = 180;
async function handle(request: Request) {
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  try {
    const host = getFitCircleEngage();
    if (!host) return Response.json({ error: { code: 'ENGAGE_DISABLED' } }, { status: 503, headers });
    return await host.handle(request);
  } catch {
    // Never return configuration/SQL/authentication provider details to callers.
    return Response.json({ error: { code: 'ENGAGE_UNAVAILABLE' } }, { status: 503, headers });
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
