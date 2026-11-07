type HeaderSource = { headers: { get(name: string): string | null } };

/**
 * Client IP. On Vercel `x-vercel-forwarded-for` / `x-forwarded-for` / `x-real-ip`
 * are set by the edge (client-supplied values are overwritten).
 */
export function getClientIp(request: HeaderSource): string | null {
  const h = request.headers;
  const candidates = [h.get('x-vercel-forwarded-for'), h.get('x-forwarded-for'), h.get('x-real-ip')];
  for (const raw of candidates) {
    const first = raw?.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return null;
}
