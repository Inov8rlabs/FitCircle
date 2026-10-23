'use client';

import { cn } from '@/lib/utils';

/**
 * Filter pill (iOS Food Log / Exercise Log filter row). Selected = solid brand
 * fill, unselected = raised surface. Renders a toggle button with aria-pressed.
 */
export function Chip({
  selected = false,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-subhead font-medium transition duration-200 ease-ios',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-purple focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        selected
          ? 'bg-brand-indigo text-white shadow-ios-sm'
          : 'bg-surface-raised/80 text-fg-secondary hover:bg-surface-raised hover:text-white',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** Horizontally scrolling chip row that bleeds to the screen edge on phones. */
export function ChipRow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0', className)}>
      {children}
    </div>
  );
}
