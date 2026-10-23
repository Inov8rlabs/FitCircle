/**
 * iOS layout primitives shared by the rebuilt signed-in screens. Each maps to a
 * SwiftUI building block in FitCircle-iOS (DesignSystem/Components):
 *
 *   GlassCard      → GlassCard (backgroundCard + glassBorder, 16pt radius)
 *   ScreenHeader   → screen title row (sunset gradient title + Fitzy button)
 *   ListGroup/Row  → inset grouped List rows (icon tile, title, value, chevron)
 *   DayHeader      → Food / Exercise Log day section header ("Wednesday" + count)
 *   Fab            → floating + button above the tab bar
 *   AvatarCircle   → initials avatar with optional check-in ring
 */
import { ChevronRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { FitzyLauncher } from '@/components/nutrition/FitzyLauncher';
import { cn } from '@/lib/utils';

import { GradientText } from './gradient-text';

// --------------------------------------------------------------- GlassCard

export function GlassCard({
  className,
  padded = true,
  as: Tag = 'section',
  ...props
}: React.HTMLAttributes<HTMLElement> & { padded?: boolean; as?: 'section' | 'div' | 'article' | 'li' }) {
  return (
    <Tag
      className={cn(
        'rounded-xl border border-glass bg-surface-raised/50 shadow-ios-sm backdrop-blur-xl',
        padded && 'p-4 sm:p-5',
        className
      )}
      {...props}
    />
  );
}

/** Card title row: tinted icon disc + headline + optional trailing control. */
export function CardTitleRow({
  icon: Icon,
  tone = 'purple',
  title,
  trailing,
  className,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  title: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-center gap-3', className)}>
      {Icon && <ToneDisc icon={Icon} tone={tone} size="md" />}
      <h2 className="min-w-0 flex-1 truncate text-title3 text-white">{title}</h2>
      {trailing}
    </div>
  );
}

// ------------------------------------------------------------------- tones

export const TONE_DISC = {
  purple: 'bg-brand-purple/20 text-brand-purple',
  orange: 'bg-brand-orange/20 text-brand-orange',
  indigo: 'bg-brand-indigo/20 text-brand-indigo',
  green: 'bg-brand-green/20 text-brand-green',
  cyan: 'bg-brand-cyan/20 text-brand-cyan',
  pink: 'bg-brand-pink/20 text-brand-pink',
  yellow: 'bg-brand-yellow/20 text-brand-yellow',
  red: 'bg-brand-red/20 text-brand-red',
  slate: 'bg-white/10 text-fg-secondary',
} as const;
export type Tone = keyof typeof TONE_DISC;

export function ToneDisc({
  icon: Icon,
  tone = 'purple',
  size = 'md',
  square = false,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  /** Rounded-square tile (iOS settings rows / meal icons) instead of a circle. */
  square?: boolean;
  className?: string;
}) {
  const box = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' }[size];
  const glyph = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' }[size];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        square ? 'rounded-[10px]' : 'rounded-full',
        box,
        TONE_DISC[tone],
        className
      )}
    >
      <Icon className={glyph} />
    </span>
  );
}

// ------------------------------------------------------------ ScreenHeader

/** iOS screen title: sunset gradient large title, subtitle, Fitzy sparkle button. */
export function ScreenHeader({
  title,
  subtitle,
  actions,
  fitzy = true,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  fitzy?: boolean;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex items-start justify-between gap-4', className)} data-testid="screen-header">
      <div className="min-w-0">
        <GradientText as="h1" className="text-[30px] font-bold leading-tight sm:text-large-title">
          {title}
        </GradientText>
        {subtitle && <p className="mt-1 text-callout text-fg-secondary">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {actions}
        {fitzy && <FitzyLauncher variant="header" />}
      </div>
    </header>
  );
}

/** Page column: phone-first single column, centered at desktop widths (never stretched). */
export function Screen({
  className,
  size = 'narrow',
  children,
}: {
  className?: string;
  size?: 'narrow' | 'wide';
  children: React.ReactNode;
}) {
  return (
    <main
      className={cn(
        'mx-auto w-full px-4 pb-10 pt-5 sm:px-6 sm:pt-8',
        size === 'narrow' ? 'max-w-2xl' : 'max-w-6xl',
        className
      )}
    >
      {children}
    </main>
  );
}

// ---------------------------------------------------------- grouped lists

export function ListGroup({
  title,
  footer,
  className,
  children,
}: {
  title?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('mb-6', className)}>
      {title && (
        <h2 className="mb-2 px-4 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">{title}</h2>
      )}
      <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-glass bg-surface-raised/50">
        {children}
      </ul>
      {footer && <p className="mt-2 px-4 text-footnote text-fg-tertiary">{footer}</p>}
    </section>
  );
}

type RowBase = {
  icon?: LucideIcon;
  tone?: Tone;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  value?: React.ReactNode;
  trailing?: React.ReactNode;
  destructive?: boolean;
  testId?: string;
};

function RowInner({ icon, tone = 'purple', title, subtitle, value, trailing, destructive, chevron }: RowBase & { chevron: boolean }) {
  return (
    <>
      {icon && <ToneDisc icon={icon} tone={destructive ? 'red' : tone} size="sm" square />}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-body', destructive ? 'text-brand-red' : 'text-white')}>{title}</span>
        {subtitle && <span className="block truncate text-footnote text-fg-secondary">{subtitle}</span>}
      </span>
      {value !== undefined && <span className="shrink-0 text-subhead text-fg-secondary">{value}</span>}
      {trailing}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden />}
    </>
  );
}

const ROW_CLASS =
  'flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:outline-none';

/** A grouped-list row. Pass `href` for navigation, `onClick` for an action, neither for a static row. */
export function ListRow(props: RowBase & { href?: string; onClick?: () => void; chevron?: boolean }) {
  const { href, onClick, chevron = Boolean(props.href), testId } = props;
  if (href) {
    return (
      <li>
        <Link href={href} className={ROW_CLASS} data-testid={testId}>
          <RowInner {...props} chevron={chevron} />
        </Link>
      </li>
    );
  }
  if (onClick) {
    return (
      <li>
        <button type="button" onClick={onClick} className={ROW_CLASS} data-testid={testId}>
          <RowInner {...props} chevron={chevron} />
        </button>
      </li>
    );
  }
  return (
    <li className={cn(ROW_CLASS, 'hover:bg-transparent')} data-testid={testId}>
      <RowInner {...props} chevron={chevron} />
    </li>
  );
}

// -------------------------------------------------------------- day header

/** "Wednesday / Sep 9, 2026" with a count pill: the Food / Exercise Log section header. */
export function DayHeader({
  date,
  count,
  countIcon: CountIcon,
  className,
}: {
  date: Date;
  count?: number;
  countIcon?: LucideIcon;
  className?: string;
}) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const label = same(date, today)
    ? 'Today'
    : same(date, yesterday)
      ? 'Yesterday'
      : date.toLocaleDateString('en-US', { weekday: 'long' });
  return (
    <div className={cn('mb-3 mt-7 flex items-end justify-between border-b border-brand-indigo/20 pb-2 first:mt-0', className)}>
      <div>
        <h2 className="text-title3 text-brand-indigo">{label}</h2>
        <p className="text-footnote text-fg-tertiary">
          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>
      {count !== undefined && (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-indigo/15 px-2.5 py-1 text-footnote font-semibold text-brand-indigo">
          {CountIcon && <CountIcon className="h-3.5 w-3.5" aria-hidden />}
          {count}
        </span>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- fab

/** Floating + button, lifted above the phone tab bar; bottom-right on desktop. */
export function Fab({
  href,
  onClick,
  label,
  icon: Icon,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  icon: LucideIcon;
}) {
  const cls =
    'fixed right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-brand text-white shadow-glow transition duration-200 ease-ios hover:brightness-110 active:scale-95 md:bottom-8 md:right-8';
  const style = { bottom: 'calc(92px + env(safe-area-inset-bottom))' } as const;
  const inner = <Icon className="h-6 w-6" aria-hidden />;
  return href ? (
    <Link href={href} aria-label={label} className={cls} style={style} data-testid="fab">
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} className={cls} style={style} data-testid="fab">
      {inner}
    </button>
  );
}

// ----------------------------------------------------------------- avatars

const AVATAR_GRADIENTS = [
  'from-brand-purple to-brand-pink',
  'from-brand-indigo to-brand-purple',
  'from-brand-orange to-brand-pink',
  'from-brand-green to-brand-cyan',
  'from-brand-cyan to-brand-indigo',
];

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase();
}

function hashIndex(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

/**
 * Initials (or photo) avatar. `state` adds the iOS check-in ring: green when the
 * member is in today, dim when not.
 */
export function AvatarCircle({
  name,
  src,
  size = 36,
  state,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  state?: 'in' | 'out';
  className?: string;
}) {
  const grad = AVATAR_GRADIENTS[hashIndex(name || '?', AVATAR_GRADIENTS.length)];
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br font-semibold text-white',
        grad,
        state === 'in' && 'ring-2 ring-brand-green ring-offset-2 ring-offset-canvas',
        state === 'out' && 'opacity-50 grayscale',
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote avatar URLs from storage
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** Overlapping avatar stack (circle rows), "+N" when more than `max`. */
export function AvatarStack({
  people,
  max = 4,
  size = 28,
}: {
  people: { id: string; name: string; src?: string | null; state?: 'in' | 'out' }[];
  max?: number;
  size?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="flex items-center -space-x-2">
      {shown.map((p) => (
        <AvatarCircle
          key={p.id}
          name={p.name}
          src={p.src}
          size={size}
          state={p.state}
          // The check-in ring (green, offset) must win over the separator ring.
          className={p.state === 'in' ? undefined : 'ring-2 ring-surface'}
        />
      ))}
      {extra > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-white/10 text-caption font-semibold text-fg-secondary ring-2 ring-surface"
          style={{ width: size, height: size }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------- pills/meters

/** Small metric pill (iOS "43min" / "175cal" chips on log rows). */
export function MetricPill({ icon: Icon, tone = 'cyan', children }: { icon?: LucideIcon; tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold', TONE_DISC[tone])}>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}

/** Thin rounded progress bar. */
export function ProgressBar({ value, className, barClassName }: { value: number; className?: string; barClassName?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/10', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full bg-gradient-brand transition-[width] duration-500 ease-ios', barClassName)} style={{ width: `${pct}%` }} />
    </div>
  );
}
