/**
 * Icon-key helpers over the generated registry (design/icons.json →
 * icons.generated.ts). Server-driven objects carry `icon: IconKey`; the apps
 * map keys to SF Symbols / Material Symbols / lucide and fall back to
 * ICON_FALLBACK for a key they don't know.
 */
import { EMOJI_TO_ICON, ICONS, ICON_FALLBACK, ICON_KEYS, type IconKey } from './icons.generated';

export { ICON_FALLBACK, ICON_KEYS, ICONS, type IconKey };

const KEY_SET: ReadonlySet<string> = new Set(ICON_KEYS);

export function isIconKey(v: unknown): v is IconKey {
  return typeof v === 'string' && KEY_SET.has(v);
}

/**
 * The key that replaces a legacy emoji, or null. Tries the whole sequence, then
 * without skin-tone / gender modifiers, then the first pictograph.
 */
export function iconKeyForEmoji(emoji: string | null | undefined): IconKey | null {
  if (!emoji) return null;
  const e = emoji.replace(/️/g, '').trim();
  if (!e) return null;
  if (EMOJI_TO_ICON[e]) return EMOJI_TO_ICON[e];
  const base = e.replace(/[\u{1F3FB}-\u{1F3FF}]|‍[♀♂]/gu, '');
  if (EMOJI_TO_ICON[base]) return EMOJI_TO_ICON[base];
  const first = [...base][0];
  return (first && EMOJI_TO_ICON[first]) || null;
}

/** An explicit key if valid, else the key for the legacy emoji, else `fallback`. */
export function resolveIconKey(icon: unknown, emoji?: string | null, fallback: IconKey = ICON_FALLBACK): IconKey {
  if (isIconKey(icon)) return icon;
  return iconKeyForEmoji(emoji) ?? fallback;
}
