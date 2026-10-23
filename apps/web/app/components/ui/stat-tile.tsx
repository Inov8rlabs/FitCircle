import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const TONES = {
  purple: 'bg-brand-purple/20 text-brand-purple',
  orange: 'bg-brand-orange/20 text-brand-orange',
  indigo: 'bg-brand-indigo/20 text-brand-indigo',
  green: 'bg-brand-green/20 text-brand-green',
  cyan: 'bg-brand-cyan/20 text-brand-cyan',
  pink: 'bg-brand-pink/20 text-brand-pink',
  yellow: 'bg-brand-yellow/20 text-brand-yellow',
} as const;

export type Tone = keyof typeof TONES;

/** Tinted icon disc (36pt, AppTheme StatsCard icon). */
export function IconDisc({ icon: Icon, tone = 'purple', className }: { icon: LucideIcon; tone?: Tone; className?: string }) {
  return (
    <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full', TONES[tone], className)}>
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

/** iOS StatsCard: icon disc, caption label, bold value, optional footnote. */
export function StatTile({
  icon,
  label,
  value,
  sub,
  tone = 'purple',
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-xl border border-hairline bg-card p-4', className)}>
      <IconDisc icon={icon} tone={tone} />
      <p className="text-caption text-fg-secondary">{label}</p>
      <p className="text-title2 font-bold tabular-nums text-white">{value}</p>
      {sub && <p className="text-footnote text-fg-tertiary">{sub}</p>}
    </div>
  );
}
