/**
 * Username rules shared by every registration path (mobile + web).
 *
 * A username is 3–30 characters of letters, digits, underscores and periods,
 * and may not start or end with a period. Clients that don't collect a
 * username (iOS derives one from the email) should omit it and let the server
 * derive a valid, unique one — never send the raw email local part, which
 * commonly contains "." and "+" tags.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_PATTERN = /^(?!\.)[A-Za-z0-9_.]{3,30}(?<!\.)$/;
export const USERNAME_RULES_MESSAGE =
  'Username must be 3–30 characters using letters, numbers, underscores or periods, and cannot start or end with a period';

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

/**
 * Turn an email (or any free text) into a valid username base. Strips a Gmail
 * style "+tag", lowercases, replaces disallowed runs with "_", trims periods
 * and underscores from the ends, pads to the minimum, and caps the length.
 */
export function deriveUsernameBase(email: string): string {
  const local = (email.split('@')[0] ?? '').split('+')[0].toLowerCase();
  let base = local.replace(/[^a-z0-9_.]+/g, '_').replace(/[._]{2,}/g, '_').replace(/^[._]+|[._]+$/g, '');
  if (base.length < USERNAME_MIN) base = (base + '_user').slice(0, USERNAME_MAX);
  return base.slice(0, USERNAME_MAX);
}

/**
 * Find a username that no profile uses yet, starting from `base` and appending
 * a numeric suffix (base, base2, base3…) while keeping within USERNAME_MAX.
 * `exists` is injected so this stays a pure function for tests.
 */
export async function ensureUniqueUsername(
  base: string,
  exists: (candidate: string) => Promise<boolean>
): Promise<string> {
  if (!(await exists(base))) return base;
  for (let n = 2; n < 10_000; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, USERNAME_MAX - suffix.length) + suffix;
    if (!(await exists(candidate))) return candidate;
  }
  // Astronomically unlikely; fall back to something random but valid.
  return (base.slice(0, USERNAME_MAX - 6) + Math.random().toString(36).slice(2, 8)).slice(0, USERNAME_MAX);
}
