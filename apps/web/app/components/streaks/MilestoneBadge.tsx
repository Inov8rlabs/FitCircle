'use client';

/**
 * Streak milestone badge — shared badge spec across web / iOS / Android.
 * Tier list mirrors lib/streaks/streak-config MILESTONES (see
 * docs/STREAKS-SPEC.md §3); keep the three platforms in sync.
 *
 * Achieved badges render the tier gradient with a white glyph, an inset white
 * ring, and a soft glow tinted with the tier's leading color. Locked badges
 * render a dark disc with the glyph tinted in the tier color at low opacity.
 */

import { Crown, Flame, Gem, Medal, Mountain, Star, Trophy, type LucideIcon } from 'lucide-react';

import { MILESTONES } from '@/lib/streaks/streak-config';

interface MilestoneStyle {
  icon: LucideIcon;
  /** Gradient stops, leading color first (also used for locked tint + glow). */
  colors: string[];
}

/** Map streak-config icon hints to lucide glyphs. */
const ICON_FOR_HINT: Record<string, LucideIcon> = {
  flame: Flame,
  medal: Medal,
  trophy: Trophy,
  crown: Crown,
  star: Star,
  gem: Gem,
  mountain: Mountain,
};

/** Per-day gradients (visual-only; day list itself comes from streak-config). */
const COLORS_FOR_DAY: Record<number, string[]> = {
  3:    ['#fbbf24', '#fde047'],
  7:    ['#f97316', '#fbbf24'],
  14:   ['#10b981', '#06b6d4'],
  30:   ['#6366f1', '#06b6d4'],
  60:   ['#8b5cf6', '#d946ef'],
  100:  ['#f59e0b', '#fde047'],
  180:  ['#06b6d4', '#8b5cf6'],
  365:  ['#06b6d4', '#8b5cf6', '#f97316'],
  500:  ['#d946ef', '#8b5cf6'],
  730:  ['#6366f1', '#10b981'],
  1000: ['#f59e0b', '#f97316', '#d946ef'],
};

const MILESTONE_STYLES: Record<number, MilestoneStyle> = Object.fromEntries(
  MILESTONES.map(m => [
    m.days,
    {
      icon: ICON_FOR_HINT[m.icon] ?? Flame,
      colors: COLORS_FOR_DAY[m.days] ?? ['#f97316', '#fbbf24'],
    },
  ])
);

const DEFAULT_STYLE = MILESTONE_STYLES[7];

export function MilestoneBadge({
  days, achieved, size = 48,
}: { days: number; achieved: boolean; size?: number }) {
  const { icon: Icon, colors } = MILESTONE_STYLES[days] ?? DEFAULT_STYLE;
  const iconSize = Math.round(size * 0.45);
  const glowRadius = Math.round(size / 3);

  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 ${achieved ? '' : 'bg-zinc-800 ring-1 ring-white/10'}`}
      style={{
        width: size,
        height: size,
        ...(achieved && {
          background: `linear-gradient(to bottom right, ${colors.join(', ')})`,
          // Inset ring + soft glow tinted with the leading color (~40% alpha).
          boxShadow: `inset 0 0 0 2px rgba(255, 255, 255, 0.35), 0 0 ${glowRadius}px ${colors[0]}66`,
        }),
      }}
    >
      <Icon
        strokeWidth={2}
        style={{
          width: iconSize,
          height: iconSize,
          ...(achieved ? { color: '#ffffff' } : { color: colors[0], opacity: 0.55 }),
        }}
      />
    </div>
  );
}
