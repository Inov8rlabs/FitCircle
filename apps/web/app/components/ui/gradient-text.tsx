import { cn } from '@/lib/utils';

/**
 * Gradient title text. `sunset` is the iOS screen-title gradient
 * (AppTheme.Gradients.multiColor: orange → pink → purple); `brand` is
 * AppTheme.Gradients.purple (purple → pink); `indigo` is section headers.
 */
export function GradientText({
  as: Tag = 'span',
  tone = 'sunset',
  className,
  children,
}: {
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
  tone?: 'sunset' | 'brand' | 'indigo';
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    sunset: 'bg-gradient-sunset',
    brand: 'bg-gradient-brand',
    indigo: 'bg-gradient-indigo',
  } as const;
  // Block tags shrink to their text so a short title still shows the whole
  // gradient (a full-width h1 would only show the orange end).
  const block = Tag !== 'span' && 'w-fit max-w-full';
  return <Tag className={cn(tones[tone], 'bg-clip-text text-transparent', block, className)}>{children}</Tag>;
}
