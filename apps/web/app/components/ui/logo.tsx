import Image from 'next/image';
import React from 'react';

import { cn } from '@/lib/utils';

/**
 * Brand mark. The image is the same icon the iOS / Android apps ship with
 * (public/brand/fitcircle-icon-*.png, copied from the app icon set), so the
 * web, the store listings and the home-screen icon all match.
 */

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  variant?: 'default' | 'white';
}

const ICON_SRC = '/brand/fitcircle-icon-512.png';

export function Logo({ className, size = 'md', showText = true, variant = 'default' }: LogoProps) {
  const sizes = {
    sm: { px: 32, text: 'text-lg' },
    md: { px: 40, text: 'text-xl' },
    lg: { px: 56, text: 'text-2xl' },
    xl: { px: 80, text: 'text-3xl' },
  };

  const currentSize = sizes[size];
  const isWhite = variant === 'white';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <LogoIcon px={currentSize.px} />
      {showText && (
        <span className={cn(
          'font-bold tracking-tight',
          currentSize.text,
          isWhite ? 'text-white' : 'text-foreground'
        )}>
          FitCircle
        </span>
      )}
    </div>
  );
}

// Icon-only mark for compact spaces.
export function LogoIcon({
  className,
  size = 'md',
  px,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Explicit pixel size; overrides `size`. */
  px?: number;
}) {
  const sizes = { sm: 32, md: 40, lg: 64, xl: 96 };
  const dimension = px ?? sizes[size];

  return (
    <Image
      src={ICON_SRC}
      alt="FitCircle"
      width={dimension}
      height={dimension}
      priority={dimension >= 64}
      className={cn('rounded-full shrink-0', className)}
    />
  );
}
