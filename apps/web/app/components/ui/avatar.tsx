import * as React from 'react';
import { cn, getInitials } from '@/lib/utils';
import Image from 'next/image';

interface AvatarProps {
  src?: string | null;
  alt?: string;
  fallback?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  badge?: React.ReactNode;
  onClick?: () => void;
}

const sizeClasses = {
  xs: 'h-6 w-6 text-xs',
  sm: 'h-8 w-8 text-sm',
  md: 'h-10 w-10 text-base',
  lg: 'h-12 w-12 text-lg',
  xl: 'h-16 w-16 text-xl',
  '2xl': 'h-20 w-20 text-2xl',
};

export function Avatar({
  src,
  alt = 'Avatar',
  fallback = '?',
  size = 'md',
  className,
  badge,
  onClick
}: AvatarProps) {
  const [error, setError] = React.useState(false);

  return (
    <div
      className={cn('relative inline-block', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={cn(
        'relative flex items-center justify-center rounded-full bg-muted overflow-hidden',
        sizeClasses[size],
        onClick && 'cursor-pointer hover:ring-2 hover:ring-primary hover:ring-offset-2 transition-all'
      )}>
        {src && !error ? (
          <Image
            src={src}
            alt={alt}
            fill
            className="object-cover"
            onError={() => setError(true)}
            sizes={`(max-width: 768px) ${parseInt(sizeClasses[size].split(' ')[0].replace('h-', '')) * 4}px, ${parseInt(sizeClasses[size].split(' ')[0].replace('h-', '')) * 4}px`}
          />
        ) : (
          <span className="font-semibold text-muted-foreground">
            {getInitials(fallback)}
          </span>
        )}
      </div>
      {badge && (
        <div className="absolute -bottom-0.5 -right-0.5">
          {badge}
        </div>
      )}
    </div>
  );
}

interface AvatarGroupProps {
  avatars: Array<{
    src?: string;
    alt?: string;
    fallback?: string;
  }>;
  max?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

export function AvatarGroup({ avatars, max = 3, size = 'md', className }: AvatarGroupProps) {
  const displayAvatars = avatars.slice(0, max);
  const remainingCount = Math.max(0, avatars.length - max);

  return (
    <div className={cn('flex -space-x-2', className)}>
      {displayAvatars.map((avatar, index) => (
        <div key={index} className="relative" style={{ zIndex: max - index }}>
          <Avatar
            {...avatar}
            size={size}
            className="ring-2 ring-background"
          />
        </div>
      ))}
      {remainingCount > 0 && (
        <div
          className={cn(
            'relative flex items-center justify-center rounded-full bg-muted ring-2 ring-background',
            sizeClasses[size]
          )}
          style={{ zIndex: 0 }}
        >
          <span className="text-xs font-semibold text-muted-foreground">
            +{remainingCount}
          </span>
        </div>
      )}
    </div>
  );
}

// Radix UI style exports for compatibility
export const AvatarImage = ({ src, alt, className }: { src?: string; alt?: string; className?: string }) => {
  const [error, setError] = React.useState(false);

  if (!src || error) return null;

  return (
    <Image
      src={src}
      alt={alt || 'Avatar'}
      fill
      className={cn('object-cover', className)}
      onError={() => setError(true)}
      sizes="100px"
    />
  );
};

export const AvatarFallback = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  return (
    <span className={cn('font-semibold text-muted-foreground flex items-center justify-center w-full h-full', className)}>
      {children}
    </span>
  );
};