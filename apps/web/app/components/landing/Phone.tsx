import Image from 'next/image';

import { cn } from '@/lib/utils';

export interface Shot {
  src: string;
  w: number;
  h: number;
  alt: string;
}

/**
 * Minimal iPhone frame drawn in CSS around a real screen capture (the captures
 * are cropped to the screen only). The screen fades out at the bottom so tall
 * captures never need a home indicator.
 */
export function Phone({
  shot,
  width,
  priority = false,
  sizes,
  className,
  fade = true,
}: {
  shot: Shot;
  /** CSS width of the device, e.g. 'clamp(200px, 60vw, 300px)'. */
  width: string;
  priority?: boolean;
  sizes: string;
  className?: string;
  fade?: boolean;
}) {
  return (
    <div
      className={cn('relative rounded-[46px] border border-white/15 bg-[#0b0d16] p-[9px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]', className)}
      style={{ width }}
    >
      <div className="relative overflow-hidden rounded-[38px] bg-canvas" style={{ aspectRatio: '9 / 18.2' }}>
        <Image
          src={shot.src}
          alt={shot.alt}
          width={shot.w}
          height={shot.h}
          sizes={sizes}
          priority={priority}
          fetchPriority={priority ? 'high' : undefined}
          className="absolute inset-x-0 top-0 h-auto w-full"
        />
        {fade && <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/5 bg-gradient-to-t from-[#0b0d16] to-transparent" />}
      </div>
    </div>
  );
}

/** Rounded image tile (widgets, watch faces, notifications) with an iOS shadow. */
export function Tile({
  shot,
  className,
  sizes,
  round = false,
  priority = false,
}: {
  shot: Shot;
  className?: string;
  sizes: string;
  round?: boolean;
  priority?: boolean;
}) {
  return (
    <Image
      src={shot.src}
      alt={shot.alt}
      width={shot.w}
      height={shot.h}
      sizes={sizes}
      priority={priority}
      className={cn('h-auto drop-shadow-[0_18px_40px_rgba(0,0,0,0.55)]', round ? 'rounded-full' : '', className)}
    />
  );
}
