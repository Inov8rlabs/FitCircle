/**
 * EU/EEA web sign-up + checkout restriction (docs/PRIVACY_COMPLIANCE_SPEC.md §7; audit §7 option A).
 *
 * WEB_EU_SIGNUP_BLOCK: default ON (owner decision 2026-11-06; set 'false' to reopen). Requests
 * whose Vercel edge country (x-vercel-ip-country) is in the EU, EEA or EFTA cannot open
 * /register or /upgrade, create an account (POST /api/auth/register, /api/mobile/auth/register,
 * or a FIRST Google / Apple sign-in via /api/mobile/auth/google|apple), or start a Stripe
 * checkout. Existing accounts still sign in (email and social), export and delete. The UK is
 * NOT restricted (launch market). Unknown country (no header: local dev, non-Vercel) → not
 * restricted. Reopening plan: docs/EU_COMPLIANCE_PLAN.md. Pure, edge-safe.
 */

/** EU-27 + EEA (IS, LI, NO) + Switzerland (EFTA). ISO 3166-1 alpha-2. */
export const EU_EEA_COUNTRIES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'CH',
]);

export const REGION_NOT_AVAILABLE_CODE = 'REGION_NOT_AVAILABLE';
export const REGION_NOT_AVAILABLE_MESSAGE = "FitCircle isn't available in your region yet.";

type Env = Record<string, string | undefined>;
type HeaderSource = { headers: { get(name: string): string | null } };

/** Default ON (owner decision 2026-11-06): blocked unless WEB_EU_SIGNUP_BLOCK is explicitly false/0/off/no. */
export function euSignupBlockEnabled(env: Env = process.env): boolean {
  return !['false', '0', 'off', 'no'].includes((env.WEB_EU_SIGNUP_BLOCK ?? '').trim().toLowerCase());
}

export function requestCountry(request: HeaderSource): string | null {
  const c = (request.headers.get('x-vercel-ip-country') ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** True when the flag is on and the request comes from an EU/EEA/EFTA country. Unknown country → not blocked. */
export function isRegionRestricted(request: HeaderSource, env: Env = process.env): boolean {
  if (!euSignupBlockEnabled(env)) return false;
  const c = requestCountry(request);
  return !!c && EU_EEA_COUNTRIES.has(c);
}

/** Page paths that start a NEW account or a purchase (gated); everything else stays open. */
export function restrictedPagePath(pathname: string): 'signup' | 'checkout' | null {
  if (pathname === '/register' || pathname.startsWith('/register/')) return 'signup';
  if (pathname === '/upgrade' || pathname.startsWith('/upgrade/')) return 'checkout';
  return null;
}

/** Standard JSON body for gated API routes (HTTP 403). */
export function regionNotAvailableBody() {
  return {
    success: false,
    data: null,
    error: { code: REGION_NOT_AVAILABLE_CODE, message: REGION_NOT_AVAILABLE_MESSAGE, details: {}, timestamp: new Date().toISOString() },
    meta: null,
  };
}
