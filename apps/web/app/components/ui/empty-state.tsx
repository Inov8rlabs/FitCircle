import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * iOS-style empty state: tinted icon disc, headline, one line of help, and an
 * optional action. Use inside a Card or on the page canvas.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'purple',
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'purple' | 'orange' | 'indigo' | 'green' | 'cyan' | 'pink';
  className?: string;
}) {
  const tones: Record<string, string> = {
    purple: 'bg-brand-purple/15 text-brand-purple',
    orange: 'bg-brand-orange/15 text-brand-orange',
    indigo: 'bg-brand-indigo/15 text-brand-indigo',
    green: 'bg-brand-green/15 text-brand-green',
    cyan: 'bg-brand-cyan/15 text-brand-cyan',
    pink: 'bg-brand-pink/15 text-brand-pink',
  };
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <div className={cn('flex h-14 w-14 items-center justify-center rounded-full', tones[tone])}>
        <Icon className="h-7 w-7" aria-hidden />
      </div>
      <h3 className="mt-4 text-headline text-white">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-subhead text-fg-secondary">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
