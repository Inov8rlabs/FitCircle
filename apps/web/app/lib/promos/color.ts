/**
 * Colour maths for promo creatives (pure): #RRGGBB parsing, WCAG 2.x relative
 * luminance + contrast ratio, and CIE76 ΔE (perceptual distance in Lab) for
 * "does this button stand out from the card" checks.
 */
export const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX_RE.test(v);

function rgb(hexColor: string): [number, number, number] {
  const n = parseInt(hexColor.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const linear = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance (0 black … 1 white). */
export function luminance(hexColor: string): number {
  const [r, g, b] = rgb(hexColor).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1 … 21). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** sRGB → CIE Lab (D65). */
function lab(hexColor: string): [number, number, number] {
  const [r, g, b] = rgb(hexColor).map(linear);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference: < ~10 looks the same at a glance, > ~40 clearly different. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Average of two hex colours (per channel, rounded). */
export function mixHex(a: string, b: string): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
