/**
 * Shared parser/formatter for food quantities so users can type decimals
 * (0.5, 0.25) and fractions (1/4, ½) without the field snapping back, and so
 * +/- steppers move in predictable 0.25 increments for count/volume units.
 */

const VULGAR: Record<string, string> = {
  '¼': ' 1/4 ',
  '½': ' 1/2 ',
  '¾': ' 3/4 ',
  '⅓': ' 1/3 ',
  '⅔': ' 2/3 ',
  '⅛': ' 1/8 ',
  '⅜': ' 3/8 ',
  '⅝': ' 5/8 ',
  '⅞': ' 7/8 ',
  '⅕': ' 1/5 ',
  '⅖': ' 2/5 ',
  '⅗': ' 3/5 ',
  '⅘': ' 4/5 ',
  '⅙': ' 1/6 ',
  '⅚': ' 5/6 ',
};

/**
 * +/- increment for a serving unit. Grams/ml stay on a 10-unit step
 * (0.25 g is noise); everything else — serving, piece, cup, oz — is ¼.
 */
export function quantityStepSize(unit?: string | null): number {
  switch ((unit ?? 'g').trim().toLowerCase()) {
    case 'g':
    case 'gm':
    case 'gms':
    case 'gram':
    case 'grams':
    case 'ml':
    case 'milliliter':
    case 'millilitre':
    case 'milliliters':
    case 'millilitres':
      return 10;
    default:
      return 0.25;
  }
}

/**
 * Parse a quantity typed by the user. Returns null for incomplete drafts
 * ("0.", "1/", ".") so the text field can keep them while the user is still
 * typing, and null for anything that isn't a number or fraction.
 */
export function parseQuantity(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  s = expandVulgarFractions(s)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ \//g, '/')
    .replace(/\/ /g, '/');

  if (isIncomplete(s)) return null;

  return s.includes('/') ? parseFractionExpression(s) : parseDecimal(s);
}

/**
 * Canonical string for an editable field: 1, 0.5, 0.25, 1.75. Never 0.3
 * for a quarter, and never a trailing `.00`.
 */
export function formatQuantity(value: number): string {
  const v = Math.round(value * 10_000) / 10_000;
  if (Math.abs(v - Math.round(v)) < 0.00005) return String(Math.round(v));
  return parseFloat(v.toFixed(4)).toString();
}

/** Apply a +/- step and snap to 2 d.p. so 0.25 repeats don't drift. */
export function stepQuantity(current: number, delta: number): number {
  return Math.max(0, Math.round((current + delta) * 100) / 100);
}

/** Meal-level "how many of this plate" — quarter steps, never below ¼. */
export function snapServings(value: number): number {
  return Math.max(0.25, Math.round(value * 4) / 4);
}

function isIncomplete(s: string): boolean {
  return s === '.' || s === ',' || s.endsWith('.') || s.endsWith(',') || s.endsWith('/');
}

function parseDecimal(s: string): number | null {
  let normalized = s.replace(',', '.');
  if (normalized.startsWith('.')) normalized = `0${normalized}`;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** "1/4", "1 1/4", "1-1/4". */
function parseFractionExpression(s: string): number | null {
  const tokens = s.replace(/-/g, ' ').split(' ').filter(Boolean);
  if (tokens.length === 2) {
    const whole = parseDecimal(tokens[0]);
    const frac = parseSimpleFraction(tokens[1]);
    if (whole == null || frac == null) return null;
    return whole + frac;
  }
  if (tokens.length === 1) return parseSimpleFraction(tokens[0]);
  return null;
}

function parseSimpleFraction(s: string): number | null {
  const parts = s.split('/');
  if (parts.length !== 2) return null;
  const num = parseDecimal(parts[0]);
  const den = parseDecimal(parts[1]);
  if (num == null || den == null || den === 0) return null;
  return num / den;
}

function expandVulgarFractions(raw: string): string {
  return raw.replace(/[¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]/g, (ch) => VULGAR[ch] ?? ch);
}
