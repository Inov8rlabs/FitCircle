'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

/** Gradient that stands in for missing art (CAMPAIGNS_SPEC §3: clients must look finished without art). */
export function paletteGradient(palette: readonly string[], angle = 135): string {
  const [a = '#8b5cf6', b = '#22d3ee', c = '#ec4899'] = palette;
  return `linear-gradient(${angle}deg, ${a} 0%, ${c} 55%, ${b} 100%)`;
}

export function paletteBackdrop(palette: readonly string[]): string {
  const [a = '#8b5cf6', b = '#22d3ee', c = '#ec4899'] = palette;
  return `radial-gradient(120% 90% at 15% 0%, ${a}66 0%, transparent 55%), radial-gradient(100% 80% at 90% 10%, ${b}55 0%, transparent 55%), radial-gradient(90% 80% at 50% 110%, ${c}40 0%, transparent 60%), #0b0f2a`;
}

interface CampaignHeroProps {
  art?: string | null;
  palette: readonly string[];
  emoji: string;
  title?: string;
  className?: string;
  /** Emoji size for the fallback. */
  size?: 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
}

/** Campaign art, or a palette gradient with a big emoji inside a neon ring when there is none. */
export function CampaignHero({ art, palette, emoji, title, className, size = 'md', children }: CampaignHeroProps) {
  const [broken, setBroken] = useState(false);
  const showArt = Boolean(art) && !broken;
  const emojiSize = size === 'sm' ? 'text-2xl' : size === 'lg' ? 'text-7xl' : 'text-5xl';
  const ring = size === 'sm' ? 'h-10 w-10 border-2' : size === 'lg' ? 'h-36 w-36 border-[6px]' : 'h-24 w-24 border-4';
  return (
    <div className={cn('relative overflow-hidden', className)} style={showArt ? undefined : { background: paletteBackdrop(palette) }}>
      {showArt ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art!} alt={title ?? ''} className="absolute inset-0 h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <div
            className={cn('flex items-center justify-center rounded-full', ring)}
            style={{ borderColor: 'transparent', backgroundImage: `linear-gradient(#0b0f2a, #0b0f2a), ${paletteGradient(palette)}`, backgroundOrigin: 'border-box', backgroundClip: 'padding-box, border-box', boxShadow: `0 0 32px ${palette[0] ?? '#8b5cf6'}80` }}
          >
            <span className={emojiSize}>{emoji}</span>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
