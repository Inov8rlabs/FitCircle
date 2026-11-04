/**
 * Email address validation + typo correction for addresses a member types for
 * SOMEONE ELSE (invite a friend, circle invites). Bounced invites hurt the
 * sending domain's reputation (real one: `r.celeste1957@yahoo.comr`), so a
 * likely typo of a big provider is rejected WITH a suggestion instead of sent.
 *
 * Pure and dependency-free so the web client can use it too. The iOS
 * (`EmailAddressValidator.swift`) and Android (`EmailAddressValidator.kt`)
 * ports must behave identically — the shared vectors live in
 * `__fixtures__/email-cases.json`; copy that file into both apps' tests when
 * it changes. The optional DNS check is server-only (lib/email/email-deliverability.ts).
 *
 * Rules, in order:
 *  1. empty      — blank after trimming.
 *  2. syntax     — exactly one @; local part 1–64 chars of the RFC 5322
 *                  dot-atom set (no leading/trailing/double dots); domain ≤253,
 *                  ≥2 labels of [a-z0-9-] (1–63, no edge hyphens); no spaces;
 *                  whole address ≤254. Domain is lower-cased; local part kept.
 *  3. unknown_tld — last label not in the bundled IANA list (`.comr`, `.con`,
 *                  `.c`). Suggests a fix when one is obvious.
 *  4. typo_likely — the TLD is real but the domain is a near-miss of a big
 *                  provider (`gmial.com`, `gmail.co`, `hotmial.com`).
 *  Known providers and every other domain pass untouched (`company.io`,
 *  `uni.ac.uk`, `hotmail.fr`).
 */
import { IANA_TLDS } from './email-tlds.generated';

export type EmailRejectReason = 'empty' | 'syntax' | 'unknown_tld' | 'typo_likely';

export interface EmailValidationResult {
  valid: boolean;
  /** Trimmed, domain lower-cased ('' when empty). */
  normalized: string;
  /** Full corrected address to offer as "Did you mean …?". */
  suggestion?: string;
  reason?: EmailRejectReason;
}

/**
 * Providers we steer typos toward, in priority order (ties go to the earlier
 * entry). Keep in sync with the iOS/Android ports.
 */
export const SUGGESTION_DOMAINS: readonly string[] = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'live.com',
  'aol.com',
  'msn.com',
  'proton.me',
  'protonmail.com',
  'googlemail.com',
  'ymail.com',
  'comcast.net',
  'verizon.net',
  'sbcglobal.net',
  'bellsouth.net',
  'att.net',
  'yahoo.co.uk',
  'hotmail.co.uk',
  'yahoo.ca',
  'yahoo.co.in',
  'rediffmail.com',
];

/** Real domains that must never be "corrected" (beyond SUGGESTION_DOMAINS). */
export const KNOWN_DOMAINS: ReadonlySet<string> = new Set([
  ...SUGGESTION_DOMAINS,
  'email.com',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'web.de',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'pm.me',
  'protonmail.ch',
  'fastmail.com',
  'hey.com',
  'duck.com',
  'tutanota.com',
  'aim.com',
  'cox.net',
  'charter.net',
  'earthlink.net',
  'optonline.net',
  'shaw.ca',
  'rogers.com',
  'btinternet.com',
  'sky.com',
  'qq.com',
  '163.com',
  'naver.com',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'live.co.uk',
  'outlook.de',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.es',
  'yahoo.it',
  'yahoo.com.au',
  'yahoo.co.jp',
  'yahoo.in',
]);

/** Unknown TLDs with an obvious intended TLD. */
export const TLD_FIXES: Readonly<Record<string, string>> = {
  comr: 'com',
  con: 'com',
  cmo: 'com',
  ocm: 'com',
  coom: 'com',
  comm: 'com',
  vom: 'com',
  xom: 'com',
  cim: 'com',
  cpm: 'com',
  copm: 'com',
  c: 'com',
  nett: 'net',
  ner: 'net',
  nte: 'net',
  orgg: 'org',
  ogr: 'org',
  rog: 'org',
};

/** Real TLDs that are almost always a fat-fingered `.com` on a big provider (`gmail.co`). */
const COM_LOOKALIKE_TLDS: ReadonlySet<string> = new Set(['co', 'cm', 'om']);

/** Brands that only exist on their one domain: any other TLD is a typo (`gmail.net`). */
const SINGLE_DOMAIN_BRANDS: ReadonlySet<string> = new Set(['gmail', 'googlemail', 'icloud']);

const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function validateEmailAddress(raw: string | null | undefined): EmailValidationResult {
  const text = (raw ?? '').trim();
  if (!text) return { valid: false, normalized: '', reason: 'empty' };

  const at = text.indexOf('@');
  if (at < 0 || text.indexOf('@', at + 1) >= 0) return { valid: false, normalized: text, reason: 'syntax' };
  const local = text.slice(0, at);
  const domain = text.slice(at + 1).toLowerCase();
  const normalized = `${local}@${domain}`;
  const reject = (reason: EmailRejectReason, fixedDomain?: string | null): EmailValidationResult =>
    fixedDomain
      ? { valid: false, normalized, reason, suggestion: `${local}@${fixedDomain}` }
      : { valid: false, normalized, reason };

  if (/\s/.test(text) || local.length === 0 || local.length > 64 || !LOCAL_RE.test(local)) return reject('syntax');
  if (domain.length === 0 || domain.length > 253 || normalized.length > 254) return reject('syntax');
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((l) => l.length > 63 || !LABEL_RE.test(l))) return reject('syntax');

  if (KNOWN_DOMAINS.has(domain)) return { valid: true, normalized };
  const tld = labels[labels.length - 1];
  if (!IANA_TLDS.has(tld)) return reject('unknown_tld', suggestForUnknownTld(labels));
  const typo = closestProvider(labels);
  return typo ? reject('typo_likely', typo) : { valid: true, normalized };
}

/** Convenience for callers that only need a yes/no. */
export function isValidEmailAddress(raw: string | null | undefined): boolean {
  return validateEmailAddress(raw).valid;
}

// ---------------------------------------------------------------------------

function suggestForUnknownTld(labels: string[]): string | null {
  const tld = labels[labels.length - 1];
  const fixed = TLD_FIXES[tld];
  if (fixed) {
    const repaired = [...labels.slice(0, -1), fixed];
    const domain = repaired.join('.');
    if (KNOWN_DOMAINS.has(domain)) return domain;
    return closestProvider(repaired) ?? domain; // `gmial.con` → gmail.com; `company.con` → company.com
  }
  // No obvious TLD: match a provider by the whole domain (≤2 edits) or by its brand label.
  const domain = labels.join('.');
  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of SUGGESTION_DOMAINS) {
    const dist = editDistance(domain, candidate);
    const cLabels = candidate.split('.');
    const brandClose = labels.length === cLabels.length && withinBrandThreshold(labels[0], cLabels[0]);
    if ((dist <= 2 || brandClose) && dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/** A provider the (real-TLD) domain is a near-miss of, or null. */
function closestProvider(labels: string[]): string | null {
  const brand = labels[0];
  const suffix = labels.slice(1).join('.');
  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of SUGGESTION_DOMAINS) {
    const cLabels = candidate.split('.');
    const cBrand = cLabels[0];
    const cSuffix = cLabels.slice(1).join('.');
    let dist: number;
    if (brand === cBrand) {
      if (suffix === cSuffix) return null; // exact provider
      const comTypo = labels.length === 2 && COM_LOOKALIKE_TLDS.has(suffix) && cSuffix === 'com';
      const wrongTld = SINGLE_DOMAIN_BRANDS.has(cBrand);
      if (!comTypo && !wrongTld) continue; // e.g. hotmail.fr, yahoo.co.jp are real
      dist = 0.5;
    } else {
      if (suffix !== cSuffix || !withinBrandThreshold(brand, cBrand)) continue;
      dist = editDistance(brand, cBrand);
    }
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * How far a typed brand label may be from a provider's: short brands (me,
 * aol, live) are never fuzzy-matched — too many real look-alikes (love.com);
 * 5–7 letters allow one edit; 8+ allow two.
 */
function withinBrandThreshold(typed: string, brand: string): boolean {
  if (typed === brand) return true;
  const max = brand.length >= 8 ? 2 : brand.length >= 5 ? 1 : 0;
  return max > 0 && typed.length >= 3 && editDistance(typed, brand) <= max;
}

/** Optimal string alignment distance (Levenshtein + adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** User-facing copy shared by web; iOS/Android mirror these strings. */
export const EMAIL_COPY = {
  invalid: "That email doesn't look right.",
  didYouMean: (suggestion: string) => `Did you mean ${suggestion}?`,
} as const;
