import React from 'react';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  variant?: 'default' | 'white';
}

export function Logo({ className, size = 'md', showText = true, variant = 'default' }: LogoProps) {
  const sizes = {
    sm: { icon: 'w-8 h-8', text: 'text-lg', fontSize: 'text-xl' },
    md: { icon: 'w-10 h-10', text: 'text-xl', fontSize: 'text-2xl' },
    lg: { icon: 'w-14 h-14', text: 'text-2xl', fontSize: 'text-3xl' },
    xl: { icon: 'w-20 h-20', text: 'text-3xl', fontSize: 'text-5xl' },
  };

  const currentSize = sizes[size];
  const isWhite = variant === 'white';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Logo Icon - Simple circle with cursive f */}
      <div className={cn('relative flex items-center justify-center rounded-full', currentSize.icon,
        isWhite ? 'bg-white' : 'bg-primary'
      )}>
        <span
          className={cn(
            'font-serif italic',
            currentSize.fontSize,
            isWhite ? 'text-primary' : 'text-primary-foreground'
          )}
        >
          f
        </span>
      </div>

      {/* Text */}
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

// Simplified Logo Icon component for use in smaller spaces
export function LogoIcon({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: { icon: 'w-8 h-8', fontSize: 'text-xl' },
    md: { icon: 'w-10 h-10', fontSize: 'text-2xl' },
    lg: { icon: 'w-12 h-12', fontSize: 'text-3xl' },
  };

  const currentSize = sizes[size];

  return (
    <div className={cn('relative flex items-center justify-center rounded-full bg-primary', currentSize.icon, className)}>
      <span className={cn('font-serif italic text-primary-foreground', currentSize.fontSize)}>
        f
      </span>
    </div>
  );
}