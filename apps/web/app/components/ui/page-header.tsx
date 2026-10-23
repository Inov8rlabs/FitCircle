import { cn } from '@/lib/utils';

import { GradientText } from './gradient-text';

/**
 * Screen title in the iOS style: large gradient title, secondary subtitle,
 * optional trailing actions (aligned to the title's first line).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  gradient = true,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  gradient?: boolean;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {gradient ? (
          <GradientText as="h1" className="text-title1 sm:text-large-title">
            {title}
          </GradientText>
        ) : (
          <h1 className="text-title1 text-white sm:text-large-title">{title}</h1>
        )}
        {subtitle && <p className="mt-1 text-callout text-fg-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
    </header>
  );
}

/** Section header used above card groups (iOS "Yesterday" / "Leaderboard" rows). */
export function SectionHeader({
  title,
  icon,
  trailing,
  tone = 'plain',
  className,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  tone?: 'plain' | 'indigo';
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="flex items-center gap-2 text-title3">
        {icon}
        {tone === 'indigo' ? <GradientText tone="indigo">{title}</GradientText> : <span className="text-white">{title}</span>}
      </h2>
      {trailing && <div className="shrink-0 text-subhead text-fg-secondary">{trailing}</div>}
    </div>
  );
}

/** Centered page column with the iOS horizontal margins (16 → 24 → 32). */
export function PageContainer({
  className,
  size = 'default',
  children,
}: {
  className?: string;
  size?: 'narrow' | 'default' | 'wide';
  children: React.ReactNode;
}) {
  const max = { narrow: 'max-w-2xl', default: 'max-w-5xl', wide: 'max-w-7xl' }[size];
  return <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8', max, className)}>{children}</div>;
}
