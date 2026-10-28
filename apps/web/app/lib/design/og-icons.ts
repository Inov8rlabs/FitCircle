/**
 * Inline SVG for the OG share-card renderer (api/og/share-card), which can't load
 * fonts or images (CSP: default-src 'none'). Path data from lucide v0.454.0 (ISC
 * license), the web icon set mapped in design/icons.json. Only the keys a share
 * card can show are included; anything else falls back to the card's default.
 */
import type { IconKey } from './icons';

type Node = readonly [tag: string, attrs: Readonly<Record<string, string>>];

const NODES: Partial<Record<IconKey, readonly Node[]>> = {
  // lucide "trophy"
  trophy: [["path",{d: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6"}], ["path",{d: "M18 9h1.5a2.5 2.5 0 0 0 0-5H18"}], ["path",{d: "M4 22h16"}], ["path",{d: "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"}], ["path",{d: "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"}], ["path",{d: "M18 2H6v7a6 6 0 0 0 12 0V2Z"}]],
  // lucide "flame"
  flame: [["path",{d: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"}]],
  // lucide "target"
  target: [["circle",{cx: "12",cy: "12",r: "10"}], ["circle",{cx: "12",cy: "12",r: "6"}], ["circle",{cx: "12",cy: "12",r: "2"}]],
  // lucide "star"
  star: [["path",{d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],
  // lucide "zap"
  bolt: [["path",{d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"}]],
  // lucide "medal"
  medal: [["path",{d: "M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"}], ["path",{d: "M11 12 5.12 2.2"}], ["path",{d: "m13 12 5.88-9.8"}], ["path",{d: "M8 7h8"}], ["circle",{cx: "12",cy: "17",r: "5"}], ["path",{d: "M12 18v-2h-.5"}]],
  // lucide "crown"
  crown: [["path",{d: "M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"}], ["path",{d: "M5 21h14"}]],
  // lucide "gem"
  gem: [["path",{d: "M6 3h12l4 6-10 13L2 9Z"}], ["path",{d: "M11 3 8 9l4 13 4-13-3-6"}], ["path",{d: "M2 9h20"}]],
  // lucide "mountain"
  mountain: [["path",{d: "m8 3 4 8 5-5 5 15H2L8 3z"}]],
  // lucide "dumbbell"
  strength: [["path",{d: "M14.4 14.4 9.6 9.6"}], ["path",{d: "M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"}], ["path",{d: "m21.5 21.5-1.4-1.4"}], ["path",{d: "M3.9 3.9 2.5 2.5"}], ["path",{d: "M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"}]],
  // lucide "sparkles"
  sparkles: [["path",{d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"}], ["path",{d: "M20 3v4"}], ["path",{d: "M22 5h-4"}], ["path",{d: "M4 17v2"}], ["path",{d: "M5 18H3"}]],
  // lucide "shield"
  shield: [["path",{d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}]],
  // lucide "flag"
  milestone: [["path",{d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"}], ["line",{"x1":"4","x2":"4","y1":"22","y2":"15"}]],
  // lucide "heart"
  heart: [["path",{d: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"}]],
  // lucide "circle-check"
  check: [["circle",{cx: "12",cy: "12",r: "10"}], ["path",{d: "m9 12 2 2 4-4"}]],
  // lucide "party-popper"
  celebration: [["path",{d: "M5.8 11.3 2 22l10.7-3.79"}], ["path",{d: "M4 3h.01"}], ["path",{d: "M22 8h.01"}], ["path",{d: "M15 2h.01"}], ["path",{d: "M22 20h.01"}], ["path",{d: "m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"}], ["path",{d: "m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"}], ["path",{d: "m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"}], ["path",{d: "M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"}]],
};

export const OG_ICON_KEYS = Object.keys(NODES) as IconKey[];

const attr = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** An inline <svg> for `key` (stroke = currentColor), or null when the key has no OG artwork. */
export function ogIconSvg(key: IconKey, size = 48): string | null {
  const nodes = NODES[key];
  if (!nodes) return null;
  const body = nodes
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${attr(v)}"`).join(' ')}/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
