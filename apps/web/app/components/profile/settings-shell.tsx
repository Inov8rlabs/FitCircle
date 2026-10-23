'use client';

/**
 * Shared chrome for Profile and every Settings screen, mirroring the iOS
 * SettingsView: back chevron, gradient large title, inset grouped sections
 * (`ListGroup` from `@/components/ui/ios`), iOS-style toggle rows and
 * footnote explanations.
 */
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Navbar } from '@/components/layout/navbar';
import { GlassCard, Screen, ScreenHeader, ToneDisc, type Tone } from '@/components/ui/ios';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export function SettingsScreen({
  title,
  subtitle,
  backHref = '/settings',
  backLabel = 'Settings',
  fitzy = false,
  actions,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** null hides the back link (top-level tab screens). */
  backHref?: string | null;
  backLabel?: string;
  fitzy?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas bg-hero-glow">
      <Navbar />
      <Screen>
        {backHref && (
          <Link
            href={backHref}
            className="-ml-1.5 mb-2 inline-flex items-center gap-0.5 rounded-full py-1 pl-1 pr-3 text-body text-brand-purple transition-colors hover:bg-white/5"
            data-testid="settings-back"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
            {backLabel}
          </Link>
        )}
        <ScreenHeader title={title} subtitle={subtitle} fitzy={fitzy} actions={actions} />
        {children}
      </Screen>
    </div>
  );
}

/** iOS-style switch: green when on, white thumb. */
export function IosSwitch(props: React.ComponentPropsWithoutRef<typeof Switch>) {
  return (
    <Switch
      {...props}
      className={cn(
        'h-[31px] w-[51px] data-[state=checked]:bg-brand-green data-[state=unchecked]:bg-white/15 [&>span]:h-[27px] [&>span]:w-[27px] [&>span]:bg-white [&>span]:data-[state=checked]:translate-x-5',
        props.className
      )}
    />
  );
}

/** Grouped-list row with a trailing switch; the description wraps (unlike ListRow). */
export function ToggleRow({
  id,
  icon,
  tone = 'purple',
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
  trailingNote,
}: {
  id?: string;
  icon?: LucideIcon;
  tone?: Tone;
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  trailingNote?: React.ReactNode;
}) {
  const labelId = id ? `${id}-label` : undefined;
  return (
    <li className="flex min-h-[56px] items-center gap-3 px-4 py-3" data-testid={id ? `toggle-row-${id}` : undefined}>
      {icon && <ToneDisc icon={icon} tone={tone} size="sm" square />}
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-body text-white">
          {title}
        </p>
        {description && <p className="mt-0.5 text-footnote text-fg-secondary">{description}</p>}
      </div>
      {trailingNote && <span className="shrink-0 text-footnote font-medium text-brand-green">{trailingNote}</span>}
      <IosSwitch
        id={id}
        aria-labelledby={labelId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </li>
  );
}

/** Static grouped-list row whose content wraps (key/value, long explanations, custom controls). */
export function DetailRow({
  icon,
  tone = 'purple',
  title,
  description,
  children,
  className,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <li className={cn('flex gap-3 px-4 py-3', className)}>
      {icon && <ToneDisc icon={icon} tone={tone} size="sm" square />}
      <div className="min-w-0 flex-1">
        {title && <p className="text-body text-white">{title}</p>}
        {description && <p className="mt-0.5 text-footnote text-fg-secondary">{description}</p>}
        {children}
      </div>
    </li>
  );
}

/** Informational card above or between groups. */
export function InfoNote({
  icon: Icon,
  tone = 'indigo',
  children,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <GlassCard className={cn('mb-6 flex items-start gap-3', className)} as="div">
      <ToneDisc icon={Icon} tone={tone} size="sm" />
      <div className="min-w-0 flex-1 pt-1 text-subhead text-fg-secondary">{children}</div>
    </GlassCard>
  );
}

/** Full-width grouped button (Sign out / destructive actions), iOS style. */
export function GroupButton({
  onClick,
  destructive = false,
  disabled,
  icon: Icon,
  children,
  testId,
}: {
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'mb-6 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-glass bg-surface-raised/50 text-body font-semibold transition-colors hover:bg-white/[0.06] disabled:opacity-60',
        destructive ? 'text-brand-red' : 'text-brand-purple'
      )}
    >
      {Icon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </button>
  );
}
