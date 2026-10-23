import { cn } from '@/lib/utils';

/**
 * The iOS "3/5 in today" ring: one arc per member, filled arcs in the
 * pink → purple → cyan brand sweep, empty arcs dim. Pure SVG, no layout shift.
 */
export function SegmentedRing({
  filled,
  total,
  size = 84,
  stroke = 9,
  label = 'in today',
  showLabel = true,
  className,
}: {
  filled: number;
  total: number;
  size?: number;
  stroke?: number;
  label?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const n = Math.max(1, total);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = n > 1 ? Math.min(10, c / n / 3) : 0;
  const seg = c / n - gap;
  const id = `ring-grad-${size}-${n}`;
  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${filled} of ${total} ${label}`}
      data-testid="segmented-ring"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ec4899" />
            <stop offset="55%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
        {Array.from({ length: n }).map((_, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={i < filled ? `url(#${id})` : 'rgba(255,255,255,0.12)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0.01, seg)} ${c - seg}`}
            strokeDashoffset={-(i * (seg + gap))}
          />
        ))}
      </svg>
      {showLabel && (
        <span className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
          <span className="font-bold tabular-nums text-white" style={{ fontSize: Math.round(size * 0.26) }}>
            {filled}/{total}
          </span>
          {size >= 76 && <span className="mt-1 text-[11px] text-fg-secondary">{label}</span>}
        </span>
      )}
    </div>
  );
}
