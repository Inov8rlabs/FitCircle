/**
 * Parametric "neon ring" campaign art (CAMPAIGNS_SPEC §9.4).
 *
 * A pure, dependency-free SVG string builder: the same ring system the launch
 * campaigns (Hold the Line, Advent, Fresh Start) were drawn with — aurora,
 * stars, hills, gradient ring, a day dial (line ticks or numbered doors),
 * mark emoji, a neon centre glyph, friends on the ring with check badges,
 * snow/confetti and a bottom fade. Layout adapts to the slot: portrait
 * (1080×1920), landscape 16:9 (1920×1080, 1200×675) and wide banners
 * (1200×480, ring right of centre).
 *
 * `rasterize()` (browser only) turns the SVG into a PNG Blob at an exact size.
 */

import type { CampaignGlyph } from '../types';

export type RingTickStyle = 'line' | 'door';
export type RingParticles = 'snow' | 'confetti' | 'none';

export interface RingArtMark {
  /** 0-based day index on the dial. */
  index: number;
  emoji: string;
}

export interface RingArtOptions {
  width: number;
  height: number;
  /** Three aurora colours (#rrggbb). */
  palette: readonly [string, string, string] | readonly string[];
  glyph: CampaignGlyph;
  /** Days on the dial (1–62). */
  days: number;
  /** Days drawn lit (default: all for lines, 7 for doors). For doors the last lit one is "today" (gold). */
  lit?: number;
  tick?: RingTickStyle;
  marks?: readonly RingArtMark[];
  /** e.g. "NOV 15 – DEC 15". Empty → no date line. */
  dateLine?: string;
  /** Rendered by the `year` glyph. */
  year?: string | number;
  particles?: RingParticles;
  /** Fireworks around the ring (default: on for the `year` glyph). */
  fireworks?: boolean;
  /** Friends on the ring (0–6, default 6). */
  friends?: number;
  /** PRNG seed for stars/particles (any integer). */
  seed?: number;
}

export interface RingLayout {
  kind: 'portrait' | 'landscape' | 'wide';
  /** Scale relative to the 1920×1080 / 1080×1920 reference. */
  k: number;
  cx: number;
  cy: number;
  R: number;
}

// ---------------------------------------------------------------------------
// Glyph colours
// ---------------------------------------------------------------------------

export const GLYPH_COLORS: Record<CampaignGlyph, { color: string; core: string }> = {
  snowflake: { color: '#7dd3fc', core: '#e0f2fe' },
  gift: { color: '#fbbf24', core: '#fff7d6' },
  year: { color: '#c4b5fd', core: '#ffffff' },
  sun: { color: '#fb923c', core: '#fff1dc' },
  moon: { color: '#fde68a', core: '#fffbeb' },
  flame: { color: '#fb7185', core: '#ffe4e6' },
  leaf: { color: '#6ee7b7', core: '#ecfdf5' },
  heart: { color: '#f472b6', core: '#fdf2f8' },
  star: { color: '#fde047', core: '#fefce8' },
  bolt: { color: '#facc15', core: '#fefce8' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEX_RE = /^#[0-9a-f]{6}$/i;

function safeHex(c: unknown, fallback: string): string {
  return typeof c === 'string' && HEX_RE.test(c) ? c.toLowerCase() : fallback;
}

/** Fixed-point number for SVG attributes; never emits NaN/Infinity. */
function n(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const x = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, x));
}

/** Park–Miller PRNG, same as the reference art (seed 7 reproduces it). */
function makeRng(seed: number) {
  let s = Math.abs(Math.round(seed)) % 2147483647;
  if (s === 0) s = 7;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function ringLayout(width: number, height: number): RingLayout {
  const W = width;
  const H = height;
  const aspect = W / H;
  if (H > W) {
    const k = W / 1080;
    return { kind: 'portrait', k, cx: W / 2, cy: H * 0.36, R: 340 * k };
  }
  if (aspect > 2) {
    // Wide banner (email header): ring right of centre, a little larger than a straight scale-down.
    const k = (H / 1080) * 1.15;
    return { kind: 'wide', k, cx: W * 0.7, cy: H * 0.5, R: 272 * k };
  }
  const k = Math.min(H / 1080, W / 1920);
  return { kind: 'landscape', k, cx: W / 2, cy: H * 0.385, R: 272 * k };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildRingArt(opts: RingArtOptions): string {
  const W = clampInt(opts.width, 16, 8192, 1920);
  const H = clampInt(opts.height, 16, 8192, 1080);
  const L = ringLayout(W, H);
  const { k, cx, cy, R } = L;
  const portrait = L.kind === 'portrait';
  const wide = L.kind === 'wide';
  /** Pick the portrait or landscape constant, scaled. */
  const pk = (p: number, l: number) => (portrait ? p : l) * k;

  const rnd = makeRng(opts.seed ?? 7);
  const DAYS = clampInt(opts.days, 1, 62, 30);
  const tick: RingTickStyle = opts.tick === 'door' ? 'door' : 'line';
  const LIT = clampInt(opts.lit, 0, DAYS, tick === 'door' ? Math.min(7, DAYS) : DAYS);
  const glyph: CampaignGlyph = opts.glyph in GLYPH_COLORS ? opts.glyph : 'star';
  const { color: glyphColor, core: glyphCore } = GLYPH_COLORS[glyph];
  const pal = opts.palette ?? [];
  const a1 = safeHex(pal[0], '#8b5cf6');
  const a2 = safeHex(pal[1], '#22d3ee');
  const a3 = safeHex(pal[2], '#ec4899');
  const bgCore = mixHex('#0b0f2a', a1, 0.22);
  const particles: RingParticles = opts.particles ?? (glyph === 'year' ? 'confetti' : 'snow');
  const fireworks = opts.fireworks ?? glyph === 'year';
  const friends = clampInt(opts.friends, 0, 6, 6);
  const dateText = (opts.dateLine ?? '').trim().toUpperCase();
  const area = (W * H) / (1920 * 1080);

  let defs = `
<linearGradient id="ring" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f472d0"/><stop offset=".5" stop-color="#a855f7"/><stop offset="1" stop-color="#38d9f5"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#f472d0"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
<radialGradient id="bg" cx="${wide ? 62 : 50}%" cy="${portrait ? 30 : 34}%" r="${portrait ? 85 : 75}%"><stop offset="0" stop-color="${bgCore}"/><stop offset=".45" stop-color="#0b0f2a"/><stop offset="1" stop-color="#05081a"/></radialGradient>
<radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${glyphColor}" stop-opacity=".28"/><stop offset=".55" stop-color="#8b5cf6" stop-opacity=".10"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05081a" stop-opacity="0"/><stop offset="1" stop-color="#05081a" stop-opacity="${wide ? '.6' : '.92'}"/></linearGradient>
<linearGradient id="hillA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2350"/><stop offset="1" stop-color="#0a0e26"/></linearGradient>
<linearGradient id="hillB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121a40"/><stop offset="1" stop-color="#060a1c"/></linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(14 * k)}"/></filter>
<filter id="glowS" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(5 * k)}"/></filter>
<filter id="aur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(pk(90, 80))}"/></filter>
<filter id="bokeh"><feGaussianBlur stdDeviation="${n(3.5 * k)}"/></filter>`;
  const avatarColors: Array<[string, string]> = [
    ['#f472b6', '#a855f7'], ['#38bdf8', '#6366f1'], ['#fb923c', '#f43f5e'],
    ['#34d399', '#0ea5e9'], ['#c084fc', '#ec4899'], ['#facc15', '#f97316'],
  ];
  avatarColors.forEach(([a, b], i) => {
    defs += `<linearGradient id="av${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  });

  let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;

  // aurora
  const aur: Array<[number, number, number, number, string, number, number]> = portrait
    ? [[W * 0.2, H * 0.08, 420, 160, a1, 0.55, -18], [W * 0.8, H * 0.12, 460, 150, a2, 0.4, 14], [W * 0.5, H * 0.04, 380, 120, a3, 0.35, 0]]
    : [[W * 0.22, H * 0.12, 520, 150, a1, 0.55, -12], [W * 0.78, H * 0.14, 560, 140, a2, 0.42, 10], [W * 0.5, H * 0.03, 480, 110, a3, 0.32, 0]];
  // Wide banners: stretch the aurora horizontally so it reaches the empty left side.
  const aurX = wide ? W / 1920 / k : 1;
  body += `<g filter="url(#aur)">${aur
    .map(([x, y, rx, ry, c, o, rot]) =>
      `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx * k * aurX)}" ry="${n(ry * k)}" fill="${c}" opacity="${o}" transform="rotate(${rot} ${n(x)} ${n(y)})"/>`)
    .join('')}</g>`;

  // stars
  const starCount = Math.max(50, Math.round((portrait ? 140 : 160) * Math.sqrt(area) * (wide ? 1.3 : 1)));
  for (let i = 0; i < starCount; i++) {
    const x = rnd() * W;
    const y = rnd() * H * 0.62;
    const r = (rnd() * 1.4 + 0.3) * Math.max(0.6, k);
    body += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r, 2)}" fill="#fff" opacity="${n(rnd() * 0.5 + 0.15, 2)}"/>`;
  }

  // fireworks outside the ring
  if (fireworks) {
    const bursts: Array<[number, number, number, string]> = portrait
      ? [[W * 0.18, H * 0.13, 110, '#f472d0'], [W * 0.84, H * 0.09, 90, '#38d9f5'], [W * 0.86, H * 0.58, 70, '#fbbf24'], [W * 0.13, H * 0.55, 80, '#a78bfa']]
      : wide
        ? [[W * 0.12, H * 0.3, 110, '#f472d0'], [W * 0.36, H * 0.22, 90, '#38d9f5'], [W * 0.94, H * 0.24, 80, '#fbbf24'], [W * 0.24, H * 0.72, 70, '#a78bfa']]
        : [[W * 0.17, H * 0.26, 130, '#f472d0'], [W * 0.83, H * 0.2, 115, '#38d9f5'], [W * 0.1, H * 0.62, 80, '#fbbf24'], [W * 0.9, H * 0.6, 90, '#a78bfa']];
    for (const [bx, by, br0, c] of bursts) {
      const br = br0 * k;
      let rays = '';
      const count = 18;
      for (let j = 0; j < count; j++) {
        const ang = (j / count) * Math.PI * 2;
        const r0 = br * 0.28;
        const r1 = br * (0.8 + rnd() * 0.25);
        rays += `<line x1="${n(bx + r0 * Math.cos(ang))}" y1="${n(by + r0 * Math.sin(ang))}" x2="${n(bx + r1 * Math.cos(ang))}" y2="${n(by + r1 * Math.sin(ang))}"/>`;
        rays += `<circle cx="${n(bx + (r1 + 10 * k) * Math.cos(ang))}" cy="${n(by + (r1 + 10 * k) * Math.sin(ang))}" r="${n(3 * k)}" fill="${c}" stroke="none"/>`;
      }
      body += `<g stroke="${c}" stroke-width="${n(7 * k)}" stroke-linecap="round" opacity=".6" filter="url(#glow)">${rays}</g>`;
      body += `<g stroke="${c}" stroke-width="${n(3 * k)}" stroke-linecap="round" opacity=".95">${rays}</g>`;
    }
  }

  body += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 1.55)}" fill="url(#core)"/>`;

  // hills
  const hill = (base: number, amp: number, phase: number, fill: string, rim: string) => {
    let d = `M0 ${H}L0 ${n(base)}`;
    const step = Math.max(8, Math.round(W / 96));
    for (let x = 0; x <= W + step; x += step) {
      const xx = Math.min(x, W);
      const y = base - amp * (Math.sin((xx / W) * Math.PI * 1.6 + phase) * 0.6 + Math.sin((xx / W) * Math.PI * 3.3 + phase * 2) * 0.4);
      d += `L${xx} ${n(y)}`;
      if (xx === W) break;
    }
    d += `L${W} ${H}Z`;
    return `<path d="${d}" fill="${fill}"/><path d="${d}" fill="none" stroke="${rim}" stroke-width="${n(2 * Math.max(0.5, k))}" opacity=".35"/>`;
  };
  const hBase = portrait ? H * 0.7 : wide ? H * 0.86 : H * 0.8;
  body += hill(hBase, pk(60, 50), 0.4, 'url(#hillA)', '#93c5fd');
  body += hill(hBase + pk(90, 70), pk(50, 40), 2.1, 'url(#hillB)', '#7dd3fc');

  // ring
  const P = (ang: number, r: number): [number, number] => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const ringW = pk(16, 14);
  body += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="none" stroke="url(#ring)" stroke-width="${n(ringW * 2.6)}" opacity=".55" filter="url(#glow)"/>`;
  body += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="none" stroke="url(#ring)" stroke-width="${n(ringW)}"/>`;
  body += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="none" stroke="#fff" stroke-width="${n(ringW * 0.25)}" opacity=".55"/>`;

  // centre glyph geometry (needed before the dial so marks can avoid the date line)
  const sf = pk(92, 80);
  const yearFs = pk(150, 128);
  const yearText = escapeXml(String(opts.year ?? new Date().getFullYear()).slice(0, 6));
  const glyphBottomRel: Record<CampaignGlyph, number> = {
    snowflake: 1, gift: 0.8, year: (yearFs * 0.34 + 4 * k) / sf, sun: 0.92, moon: 0.66,
    flame: 0.82, leaf: 0.85, heart: 0.78, star: 0.75, bolt: 1,
  };
  const glyphBottom = cy + sf * glyphBottomRel[glyph];
  const dfs = pk(30, 25);
  const dateY = glyphBottom + pk(64, 54);
  const dateHalfW = (dateText.length * dfs * 0.84) / 2;
  const hitsDate = (x: number, y: number, r: number) =>
    dateText.length > 0 && Math.abs(x - cx) < dateHalfW + r && y + r > dateY - dfs && y - r < dateY + 8 * k;

  // friends' positions (marks pushed outside the ring avoid them)
  const friendAngles = [-150, -90, -30, 30, 90, 150].slice(0, friends).map((d) => (d * Math.PI) / 180);
  const avR = pk(50, 44);
  /** Signed angular offset from the nearest friend when closer than an avatar, else null. */
  const friendClash = (ang: number): number | null => {
    let best: number | null = null;
    for (const fa of friendAngles) {
      const delta = Math.atan2(Math.sin(ang - fa), Math.cos(ang - fa));
      if (Math.abs(delta) < (avR * 1.7) / (R + pk(74, 64)) && (best === null || Math.abs(delta) < Math.abs(best))) best = delta;
    }
    return best;
  };

  // day dial
  const marks = new Map<number, string>();
  for (const m of opts.marks ?? []) {
    if (Number.isInteger(m.index) && m.index >= 0 && m.index < DAYS && m.emoji) marks.set(m.index, m.emoji);
  }
  const tIn = R - pk(70, 60);
  const tOut = R - pk(40, 34);
  const tickGrad = (t: number) => {
    const stops = [[244, 114, 208], [168, 85, 247], [56, 217, 245]];
    const s = t < 0.5 ? 0 : 1;
    const f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    return `rgb(${stops[s].map((v, j) => Math.round(v + (stops[s + 1][j] - v) * f)).join(',')})`;
  };
  // Shrink doors when there are many days so they never overlap.
  const doorR = R - pk(88, 76);
  const doorS = Math.min(pk(34, 28), ((2 * Math.PI * doorR) / DAYS) * 0.72);
  let ticks = '';
  let dim = '';
  let glyphs = '';
  for (let d = 0; d < DAYS; d++) {
    const ang = -Math.PI / 2 + (d / DAYS) * Math.PI * 2 + Math.PI / DAYS;
    const isMark = marks.has(d);
    const lit = d < LIT;
    const col = tickGrad(Math.min(1, Math.max(0, (Math.cos(ang) - Math.sin(ang)) / (2 * Math.SQRT2) + 0.5)));
    if (tick === 'door') {
      const [x, y] = P(ang, doorR);
      const s = doorS;
      const today = d === LIT - 1;
      const rot = (ang * 180) / Math.PI + 90;
      const rect = `<rect x="${n(x - s / 2)}" y="${n(y - s / 2)}" width="${n(s)}" height="${n(s)}" rx="${n(s * 0.22)}" transform="rotate(${n(rot)} ${n(x)} ${n(y)})"`;
      if (lit) ticks += `${rect} fill="${today ? '#fbbf24' : col}"/>`;
      else dim += `${rect} fill="none" stroke="${col}" stroke-width="${n(3 * k)}" opacity=".55"/>`;
      const fs = s * 0.46;
      glyphs += `<text x="${n(x)}" y="${n(y + fs * 0.36)}" font-size="${n(fs)}" font-weight="800" text-anchor="middle" fill="${lit ? '#0b0f2a' : '#c7d2fe'}" opacity="${lit ? 0.85 : 0.7}">${d + 1}</text>`;
    } else {
      const [x1, y1] = P(ang, isMark ? tIn - 8 * k : tIn);
      const [x2, y2] = P(ang, tOut);
      const sw = Math.min(isMark ? 9 : 6, ((2 * Math.PI * tIn) / DAYS) * 0.45 / k) * k;
      ticks += `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${col}" stroke-width="${n(sw)}" stroke-linecap="round" opacity="${lit ? 1 : 0.28}"/>`;
    }
    if (isMark) {
      const fs = pk(46, 40);
      const mr = tick === 'door' ? R - pk(150, 132) : tIn - pk(52, 46);
      let markAng = ang;
      let [gx, gy] = P(markAng, mr);
      if (hitsDate(gx, gy, fs * 0.8)) {
        // Move the mark outside the ring, nudging it off any friend avatar.
        const outR = R + pk(74, 64);
        for (let tries = 0, clash = friendClash(markAng); clash !== null && tries < 16; tries++, clash = friendClash(markAng)) {
          markAng += (clash >= 0 ? 1 : -1) * 0.05;
        }
        [gx, gy] = P(markAng, outR);
      }
      glyphs += `<circle cx="${n(gx)}" cy="${n(gy)}" r="${n(fs * 0.78)}" fill="#0b0f2a" opacity=".75"/>`;
      glyphs += `<text x="${n(gx)}" y="${n(gy + fs * 0.35)}" font-size="${n(fs)}" text-anchor="middle">${escapeXml(marks.get(d)!)}</text>`;
    }
  }
  body += `<g opacity=".9" filter="url(#glowS)">${ticks}</g><g>${dim}${ticks}</g>${glyphs}`;

  // centre glyph
  body += centreGlyph(glyph, { cx, cy, sf, k, portrait, glyphColor, glyphCore, yearFs, yearText });

  if (dateText) {
    body += `<text x="${n(cx)}" y="${n(dateY)}" text-anchor="middle" font-size="${n(dfs)}" font-weight="700" letter-spacing="${n(dfs * 0.22)}" fill="#c7d2fe" opacity=".9">${escapeXml(dateText)}</text>`;
  }

  // friends on the ring
  friendAngles.forEach((ang, i) => {
    const [x, y] = P(ang, R);
    body += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(avR + 16 * k)}" fill="url(#av${i})" opacity=".55" filter="url(#glow)"/>`;
    body += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(avR + 7 * k)}" fill="#0b0f2a"/>`;
    body += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(avR)}" fill="url(#av${i})"/>`;
    body += `<circle cx="${n(x)}" cy="${n(y - avR * 0.18)}" r="${n(avR * 0.3)}" fill="#fff" opacity=".95"/>`;
    body += `<path d="M${n(x - avR * 0.52)} ${n(y + avR * 0.58)} Q${n(x - avR * 0.5)} ${n(y + avR * 0.14)} ${n(x)} ${n(y + avR * 0.14)} Q${n(x + avR * 0.5)} ${n(y + avR * 0.14)} ${n(x + avR * 0.52)} ${n(y + avR * 0.58)} Z" fill="#fff" opacity=".95"/>`;
    const bx = x + avR * 0.72;
    const by = y + avR * 0.72;
    const br = avR * 0.34;
    body += `<circle cx="${n(bx)}" cy="${n(by)}" r="${n(br + 4 * k)}" fill="#0b0f2a"/><circle cx="${n(bx)}" cy="${n(by)}" r="${n(br)}" fill="#10b981"/>`;
    body += `<path d="M${n(bx - br * 0.45)} ${n(by + br * 0.02)} L${n(bx - br * 0.1)} ${n(by + br * 0.38)} L${n(bx + br * 0.5)} ${n(by - br * 0.35)}" fill="none" stroke="#fff" stroke-width="${n(br * 0.28)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });

  // particles
  if (particles !== 'none') {
    const confetti = ['#f472d0', '#a78bfa', '#38d9f5', '#fbbf24', '#34d399'];
    const count = Math.max(60, Math.round((portrait ? 170 : 190) * Math.sqrt(area) * (wide ? 1.3 : 1)));
    for (let i = 0; i < count; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const near = rnd() < 0.14;
      const r = (near ? rnd() * 7 + 5 : rnd() * 2.6 + 0.8) * Math.max(0.55, k);
      const c = confetti[Math.floor(rnd() * confetti.length)];
      const rot = rnd() * 180;
      if (Math.hypot(x - cx, y - cy) < R * 0.78) continue;
      if (particles === 'confetti' && !near) {
        body += `<rect x="${n(x - r)}" y="${n(y - r * 0.45)}" width="${n(r * 2.4)}" height="${n(r * 0.9)}" rx="1" fill="${c}" opacity=".8" transform="rotate(${n(rot, 0)} ${n(x)} ${n(y)})"/>`;
      } else {
        body += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="#e0f2fe" opacity="${near ? n(rnd() * 0.25 + 0.15, 2) : n(rnd() * 0.55 + 0.35, 2)}"${near ? ' filter="url(#bokeh)"' : ''}/>`;
      }
    }
  }

  const shadeTop = portrait ? H * 0.58 : wide ? H * 0.7 : H * 0.56;
  body += `<rect x="0" y="${n(shadeTop)}" width="${W}" height="${n(H - shadeTop)}" fill="url(#fade)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>text{font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}</style><defs>${defs}</defs>${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Centre glyphs
// ---------------------------------------------------------------------------

interface GlyphCtx {
  cx: number;
  cy: number;
  sf: number;
  k: number;
  portrait: boolean;
  glyphColor: string;
  glyphCore: string;
  yearFs: number;
  yearText: string;
}

function centreGlyph(glyph: CampaignGlyph, g: GlyphCtx): string {
  const { cx, cy, sf, k, portrait, glyphColor, glyphCore } = g;
  const sw = (portrait ? 16 : 14) * k;
  const swi = (portrait ? 8 : 7) * k;
  const neon = (shape: string) =>
    `<g stroke="${glyphColor}" stroke-width="${n(sw)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".7" filter="url(#glow)">${shape}</g>` +
    `<g stroke="${glyphCore}" stroke-width="${n(swi)}" stroke-linecap="round" stroke-linejoin="round" fill="none">${shape}</g>`;
  const X = (f: number) => n(cx + sf * f);
  const Y = (f: number) => n(cy + sf * f);
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}"/>`;

  switch (glyph) {
    case 'snowflake': {
      let flake = '';
      for (let i = 0; i < 6; i++) {
        flake += `<g transform="rotate(${i * 60} ${n(cx)} ${n(cy)})">${line(0, 0, 0, -1)}${line(0, -0.55, -0.22, -0.77)}${line(0, -0.55, 0.22, -0.77)}${line(0, -0.28, -0.14, -0.42)}${line(0, -0.28, 0.14, -0.42)}</g>`;
      }
      return neon(flake) + `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n((portrait ? 10 : 9) * k)}" fill="#fff"/>`;
    }
    case 'gift': {
      const bw = 1.5;
      const bh = 1.05;
      const top = -0.25;
      const lid = 0.32;
      const pad = 12 * k;
      const box =
        `<rect x="${X(-bw / 2)}" y="${Y(top)}" width="${n(sf * bw)}" height="${n(sf * bh)}" rx="${n(10 * k)}"/>` +
        `<rect x="${n(cx - (sf * bw) / 2 - pad)}" y="${Y(top - lid)}" width="${n(sf * bw + pad * 2)}" height="${n(sf * lid)}" rx="${n(8 * k)}"/>` +
        line(0, top - lid, 0, top + bh) +
        `<path d="M${X(0)} ${Y(top - lid)} C ${X(-0.7)} ${Y(top - 1.05)}, ${X(-0.95)} ${Y(top - 0.3)}, ${X(0)} ${Y(top - lid)}"/>` +
        `<path d="M${X(0)} ${Y(top - lid)} C ${X(0.7)} ${Y(top - 1.05)}, ${X(0.95)} ${Y(top - 0.3)}, ${X(0)} ${Y(top - lid)}"/>`;
      return neon(box);
    }
    case 'year': {
      const y = n(cy + g.yearFs * 0.34);
      const fs = n(g.yearFs);
      const ls = n(-4 * k);
      return (
        `<text x="${n(cx)}" y="${y}" text-anchor="middle" font-size="${fs}" font-weight="800" letter-spacing="${ls}" fill="${glyphColor}" opacity=".75" filter="url(#glow)">${g.yearText}</text>` +
        `<text x="${n(cx)}" y="${y}" text-anchor="middle" font-size="${fs}" font-weight="800" letter-spacing="${ls}" fill="url(#gold)">${g.yearText}</text>`
      );
    }
    case 'sun': {
      let rays = '';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        rays += line(Math.cos(a) * 0.62, Math.sin(a) * 0.62, Math.cos(a) * (i % 2 ? 0.82 : 0.92), Math.sin(a) * (i % 2 ? 0.82 : 0.92));
      }
      return neon(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(sf * 0.4)}"/>${rays}`);
    }
    case 'moon': {
      const ro = 0.8;
      const th = (50 * Math.PI) / 180;
      const a = Math.cos(th) * ro;
      const b = Math.sin(th) * ro;
      const ri = b * 1.18;
      const ox = -0.12;
      const crescent = `<path d="M${X(a + ox)} ${Y(-b)} A ${n(sf * ro)} ${n(sf * ro)} 0 1 0 ${X(a + ox)} ${Y(b)} A ${n(sf * ri)} ${n(sf * ri)} 0 0 1 ${X(a + ox)} ${Y(-b)} Z"/>`;
      const star = starPath(cx + sf * 0.62, cy - sf * 0.42, sf * 0.2, sf * 0.08, 4);
      return neon(crescent + `<path d="${star}"/>`);
    }
    case 'flame': {
      const outer = `<path d="M${X(0)} ${Y(-1)} C ${X(0.25)} ${Y(-0.55)}, ${X(0.72)} ${Y(-0.35)}, ${X(0.62)} ${Y(0.25)} C ${X(0.55)} ${Y(0.65)}, ${X(0.28)} ${Y(0.82)}, ${X(0)} ${Y(0.82)} C ${X(-0.28)} ${Y(0.82)}, ${X(-0.58)} ${Y(0.62)}, ${X(-0.6)} ${Y(0.22)} C ${X(-0.62)} ${Y(-0.15)}, ${X(-0.35)} ${Y(-0.3)}, ${X(-0.3)} ${Y(-0.55)} C ${X(-0.1)} ${Y(-0.4)}, ${X(-0.05)} ${Y(-0.7)}, ${X(0)} ${Y(-1)} Z"/>`;
      const inner = `<path d="M${X(0.02)} ${Y(-0.1)} C ${X(0.32)} ${Y(0.15)}, ${X(0.32)} ${Y(0.6)}, ${X(0)} ${Y(0.62)} C ${X(-0.3)} ${Y(0.6)}, ${X(-0.3)} ${Y(0.25)}, ${X(-0.12)} ${Y(0.08)} C ${X(-0.06)} ${Y(0.2)}, ${X(0)} ${Y(0.05)}, ${X(0.02)} ${Y(-0.1)} Z"/>`;
      return neon(outer + inner);
    }
    case 'leaf': {
      const outline = `<path d="M${X(-0.7)} ${Y(0.7)} C ${X(-0.85)} ${Y(-0.35)}, ${X(0.15)} ${Y(-0.9)}, ${X(0.82)} ${Y(-0.82)} C ${X(0.9)} ${Y(0.15)}, ${X(0.2)} ${Y(0.82)}, ${X(-0.7)} ${Y(0.7)} Z"/>`;
      const rib = line(-0.85, 0.85, 0.5, -0.5);
      const veins = line(-0.25, 0.25, -0.25, -0.2) + line(-0.25, 0.25, 0.2, 0.25) + line(0.15, -0.15, 0.12, -0.55) + line(0.15, -0.15, 0.55, -0.12);
      return neon(outline + rib + veins);
    }
    case 'heart': {
      return neon(
        `<path d="M${X(0)} ${Y(0.78)} C ${X(-1.05)} ${Y(0.05)}, ${X(-0.8)} ${Y(-0.95)}, ${X(0)} ${Y(-0.42)} C ${X(0.8)} ${Y(-0.95)}, ${X(1.05)} ${Y(0.05)}, ${X(0)} ${Y(0.78)} Z"/>`
      );
    }
    case 'star':
      return neon(`<path d="${starPath(cx, cy + sf * 0.06, sf * 0.92, sf * 0.4, 5)}"/>`);
    case 'bolt':
    default:
      return neon(
        `<path d="M${X(0.18)} ${Y(-1)} L${X(-0.5)} ${Y(0.1)} L${X(-0.04)} ${Y(0.1)} L${X(-0.2)} ${Y(1)} L${X(0.52)} ${Y(-0.16)} L${X(0.06)} ${Y(-0.16)} Z"/>`
      );
  }
}

function starPath(cx: number, cy: number, ro: number, ri: number, points: number): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    d += `${i === 0 ? 'M' : 'L'}${n(cx + r * Math.cos(a))} ${n(cy + r * Math.sin(a))}`;
  }
  return `${d}Z`;
}

// ---------------------------------------------------------------------------
// Browser rasterisation
// ---------------------------------------------------------------------------

/** Renders an SVG string to a PNG Blob of exactly w×h (browser only). */
export async function rasterize(svg: string, w: number, h: number): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('rasterize() needs a browser');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.width = w;
    img.height = h;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not load the generated SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.fillStyle = '#05081a';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png')
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
