'use client';

/**
 * Web replicas of the native Engage layouts (ENGAGE_SPEC §4). Shared by the
 * admin composer preview and the web app renderer so they always match.
 * Sizes follow the 390 pt phone spec; text uses em units off a base size so the
 * text-size slider (Dynamic Type / font scale) reflows it.
 */

import { ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { pickVariantUrl } from '@/lib/engage/preview/content';
import type { AssetRef, CardLayout, EngageButton, EngagePlatform, InAppLayout, RenderedContent } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

export interface LayoutProps {
  content: RenderedContent;
  platform: EngagePlatform;
  /** 0.85–1.6, maps to Dynamic Type / font scale. */
  textScale?: number;
  onAction?: (buttonIndex: number) => void;
  onDismiss?: () => void;
  className?: string;
}

const FONT: Record<EngagePlatform, string> = {
  ios: '-apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
  android: 'Roboto, "Google Sans", "Noto Sans", system-ui, sans-serif',
  web: 'var(--font-inter), Inter, system-ui, sans-serif',
};

/** Per-platform shape language. */
const SHAPE: Record<EngagePlatform, { card: number; button: number; image: number; buttonCase: 'none' | 'uppercase' }> = {
  ios: { card: 20, button: 12, image: 14, buttonCase: 'none' },
  android: { card: 16, button: 999, image: 12, buttonCase: 'none' },
  web: { card: 16, button: 10, image: 12, buttonCase: 'none' },
};

function baseStyle(content: RenderedContent, platform: EngagePlatform, textScale: number): React.CSSProperties {
  return {
    fontFamily: FONT[platform],
    fontSize: `${16 * textScale}px`,
    color: content.theme.text,
    background: content.theme.background,
    borderRadius: SHAPE[platform].card,
  };
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export function EngageImage({
  image,
  fit = 'cover',
  className,
  style,
  neededPx = 800,
  alt,
}: {
  image: AssetRef | null;
  fit?: 'cover' | 'contain';
  className?: string;
  style?: React.CSSProperties;
  neededPx?: number;
  alt?: string | null;
}) {
  const src = image ? pickVariantUrl(image, neededPx) : null;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  return (
    <div className={cn('relative overflow-hidden', className)} style={{ background: image?.dominantColor ?? 'rgba(255,255,255,0.06)', ...style }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt ?? image?.alt ?? ''}
          onLoad={() => setLoadedSrc(src)}
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0 && loadedSrc !== src) setLoadedSrc(src);
          }}
          className={cn('absolute inset-0 h-full w-full transition-opacity duration-300 motion-reduce:transition-none', fit === 'contain' ? 'object-contain' : 'object-cover', loaded ? 'opacity-100' : 'opacity-0')}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[0.7em] opacity-40">Image</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Badge({ text, content }: { text: string; content: RenderedContent }) {
  return (
    <span className="inline-block rounded-full px-[0.6em] py-[0.2em] text-[0.68em] font-bold uppercase tracking-wide" style={{ background: content.theme.accent, color: content.theme.background }}>
      {text}
    </span>
  );
}

function Buttons({ buttons, content, platform, onAction, stacked, compact }: { buttons: EngageButton[]; content: RenderedContent; platform: EngagePlatform; onAction?: (i: number) => void; stacked?: boolean; compact?: boolean }) {
  if (!buttons.length) return null;
  return (
    <div className={cn('flex gap-[0.5em]', stacked ? 'flex-col' : 'flex-row')}>
      {buttons.slice(0, 2).map((b, i) => {
        const primary = b.style !== 'secondary';
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAction?.(i);
            }}
            className={cn('flex-1 truncate font-semibold transition active:opacity-80', compact ? 'px-[0.9em] py-[0.45em] text-[0.8em]' : 'px-[1em] py-[0.7em] text-[0.9em]')}
            style={{
              borderRadius: SHAPE[platform].button,
              textTransform: SHAPE[platform].buttonCase,
              background: primary ? content.theme.buttonBackground : 'transparent',
              color: primary ? content.theme.buttonText : content.theme.text,
              border: primary ? 'none' : `1.5px solid ${content.theme.text}33`,
            }}
          >
            {b.label || 'Button'}
          </button>
        );
      })}
    </div>
  );
}

function Dismiss({ onDismiss, onImage }: { onDismiss?: () => void; onImage?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={(e) => {
        e.stopPropagation();
        onDismiss?.();
      }}
      className={cn('absolute right-[0.5em] top-[0.5em] z-10 flex h-[1.6em] w-[1.6em] items-center justify-center rounded-full', onImage ? 'bg-black/45 text-white' : 'bg-white/10')}
    >
      <X className="h-[0.9em] w-[0.9em]" />
    </button>
  );
}

const Title = ({ children, size = 'headline' }: { children: React.ReactNode; size?: 'title2' | 'headline' | 'large' | 'subhead' }) => (
  <p
    className={cn(
      'font-bold leading-tight',
      size === 'large' && 'text-[1.9em] tracking-tight',
      size === 'title2' && 'text-[1.35em]',
      size === 'headline' && 'text-[1.05em]',
      size === 'subhead' && 'text-[0.95em]'
    )}
  >
    {children || 'Your title'}
  </p>
);

const Body = ({ children, lines }: { children: React.ReactNode; lines?: number }) => (
  <p className={cn('text-[0.88em] leading-snug opacity-80', lines === 1 && 'line-clamp-1', lines === 2 && 'line-clamp-2', lines === 3 && 'line-clamp-3')}>{children}</p>
);

// ---------------------------------------------------------------------------
// Content cards
// ---------------------------------------------------------------------------

export function ContentCardView({ layout, content, platform, textScale = 1, onAction, onDismiss, className }: LayoutProps & { layout: CardLayout }) {
  const style = baseStyle(content, platform, textScale);
  const tapFirst = () => content.buttons.length && onAction?.(0);
  const shadow = platform === 'android' ? 'shadow-[0_1px_3px_rgba(0,0,0,0.4)]' : platform === 'web' ? 'ring-1 ring-white/10' : '';

  if (layout === 'hero') {
    return (
      <div className={cn('relative overflow-hidden', shadow, className)} style={style} data-layout="hero">
        <div className="relative">
          <EngageImage image={content.image} fit={content.imageFit} className="aspect-[16/9] w-full" alt={content.imageAlt} />
          {content.badge && (
            <div className="absolute left-[0.75em] top-[0.75em]">
              <Badge text={content.badge} content={content} />
            </div>
          )}
        </div>
        {content.dismissible && <Dismiss onDismiss={onDismiss} onImage />}
        <div className="space-y-[0.5em] p-[1em]">
          <Title size="title2">{content.title}</Title>
          {content.body && <Body lines={3}>{content.body}</Body>}
          <div className="pt-[0.25em]">
            <Buttons buttons={content.buttons} content={content} platform={platform} onAction={onAction} />
          </div>
        </div>
      </div>
    );
  }

  if (layout === 'card') {
    return (
      <div className={cn('relative overflow-hidden p-[1em]', shadow, className)} style={style} data-layout="card">
        {content.dismissible && <Dismiss onDismiss={onDismiss} />}
        <div className="flex gap-[0.85em]">
          {content.image && (
            <EngageImage image={content.image} fit={content.imageFit} neededPx={240} className="h-[88px] w-[88px] shrink-0" style={{ borderRadius: SHAPE[platform].image }} alt={content.imageAlt} />
          )}
          <div className="min-w-0 flex-1 space-y-[0.3em] pr-[1.2em]">
            {content.badge && <Badge text={content.badge} content={content} />}
            <Title>{content.title}</Title>
            {content.body && <Body lines={2}>{content.body}</Body>}
          </div>
        </div>
        {content.buttons.length > 0 && (
          <div className="mt-[0.85em]">
            <Buttons buttons={content.buttons} content={content} platform={platform} onAction={onAction} />
          </div>
        )}
      </div>
    );
  }

  if (layout === 'banner') {
    const btn = content.buttons[0];
    return (
      <div
        role={btn ? 'button' : undefined}
        tabIndex={btn ? 0 : undefined}
        onClick={tapFirst}
        className={cn('relative flex min-h-[72px] cursor-pointer items-center gap-[0.75em] overflow-hidden px-[0.85em] py-[0.7em]', shadow, className)}
        style={style}
        data-layout="banner"
      >
        {content.image && <EngageImage image={content.image} fit={content.imageFit} neededPx={120} className="h-[44px] w-[44px] shrink-0" style={{ borderRadius: SHAPE[platform].image - 2 }} alt={content.imageAlt} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[0.4em]">
            {content.badge && <Badge text={content.badge} content={content} />}
            <Title size="subhead">{content.title}</Title>
          </div>
          {content.body && <Body lines={1}>{content.body}</Body>}
        </div>
        {content.buttons.length > 1 || (btn && btn.style === 'primary' && btn.label.length <= 12) ? (
          <div className="shrink-0">
            <Buttons buttons={btn ? [btn] : []} content={content} platform={platform} onAction={onAction} compact />
          </div>
        ) : (
          <ChevronRight className="h-[1.1em] w-[1.1em] shrink-0 opacity-60" />
        )}
        {content.dismissible && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss?.();
            }}
            className="absolute right-[0.3em] top-[0.3em] opacity-50"
          >
            <X className="h-[0.75em] w-[0.75em]" />
          </button>
        )}
      </div>
    );
  }

  if (layout === 'captioned_image') {
    return (
      <div role="button" tabIndex={0} onClick={tapFirst} className={cn('relative cursor-pointer overflow-hidden', shadow, className)} style={style} data-layout="captioned_image">
        <EngageImage image={content.image} fit={content.imageFit} className="aspect-[4/3] w-full" alt={content.imageAlt} />
        {content.dismissible && <Dismiss onDismiss={onDismiss} onImage />}
        <div className="space-y-[0.3em] p-[1em]">
          {content.badge && <Badge text={content.badge} content={content} />}
          <Title>{content.title}</Title>
          {content.body && <Body lines={3}>{content.body}</Body>}
        </div>
      </div>
    );
  }

  // image_only — own aspect ratio, capped at 4:5
  const ratio = content.image ? Math.max(content.image.width / content.image.height, 4 / 5) : 16 / 9;
  return (
    <div role="button" tabIndex={0} aria-label={content.title} onClick={tapFirst} className={cn('relative cursor-pointer overflow-hidden', shadow, className)} style={style} data-layout="image_only">
      <EngageImage image={content.image} fit={content.imageFit} className="w-full" style={{ aspectRatio: String(ratio) }} alt={content.imageAlt ?? content.title} />
      {content.dismissible && <Dismiss onDismiss={onDismiss} onImage />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// In-app messages
// ---------------------------------------------------------------------------

export function InAppMessageView({
  layout,
  content,
  platform,
  textScale = 1,
  onAction,
  onDismiss,
  contained,
  className,
}: LayoutProps & { layout: InAppLayout; /** Inside a device mock (absolute) rather than the viewport (fixed). */ contained?: boolean }) {
  const pos = contained ? 'absolute' : 'fixed';
  const style = baseStyle(content, platform, textScale);
  // The preview (contained) renders without the entrance animation.
  const [shown, setShown] = useState(Boolean(contained));
  useEffect(() => {
    if (contained) return;
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, [contained]);

  // slide-up auto-dismisses after 8 s (not in the preview)
  useEffect(() => {
    if (layout !== 'slideup' || contained) return;
    const t = window.setTimeout(() => onDismiss?.(), 8000);
    return () => window.clearTimeout(t);
  }, [layout, contained, onDismiss]);

  if (layout === 'slideup') {
    return (
      <div className={cn(pos, 'inset-x-0 z-[70] flex justify-center px-[12px]', contained ? 'bottom-[76px]' : 'bottom-[88px] md:bottom-6', className)}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => (content.buttons.length ? onAction?.(0) : onDismiss?.())}
          className={cn(
            'flex w-full max-w-[420px] cursor-pointer items-center gap-[0.75em] px-[0.85em] py-[0.7em] shadow-2xl shadow-black/50 transition-all duration-300 motion-reduce:transition-opacity',
            shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
          )}
          style={style}
          data-layout="slideup"
        >
          {content.image && <EngageImage image={content.image} neededPx={120} className="h-[40px] w-[40px] shrink-0" style={{ borderRadius: 10 }} alt={content.imageAlt} />}
          <div className="min-w-0 flex-1">
            <Title size="subhead">{content.title}</Title>
            {content.body && <Body lines={1}>{content.body}</Body>}
          </div>
          <ChevronRight className="h-[1.1em] w-[1.1em] shrink-0 opacity-60" />
        </div>
      </div>
    );
  }

  if (layout === 'fullscreen') {
    return (
      <div
        className={cn(pos, 'inset-0 z-[70] flex flex-col overflow-hidden transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0', className)}
        style={{ ...style, borderRadius: contained ? 'inherit' : 0 }}
        data-layout="fullscreen"
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
      >
        <div className="relative h-[60%] shrink-0">
          <EngageImage image={content.image} fit="cover" className="absolute inset-0" neededPx={1440} alt={content.imageAlt} />
          <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: `linear-gradient(to bottom, transparent, ${content.theme.background})` }} />
        </div>
        <button type="button" aria-label="Close" onClick={onDismiss} className="absolute right-[0.9em] top-[2.6em] flex h-[2em] w-[2em] items-center justify-center rounded-full bg-black/45 text-white">
          <X className="h-[1em] w-[1em]" />
        </button>
        <div className="flex min-h-0 flex-1 flex-col px-[1.25em] pb-[1.5em]">
          <div className="-mt-[1.5em] space-y-[0.5em]">
            {content.badge && <Badge text={content.badge} content={content} />}
            <Title size="large">{content.title}</Title>
            {content.body && <Body>{content.body}</Body>}
          </div>
          <div className="mt-auto pt-[1em]">
            <Buttons buttons={content.buttons} content={content} platform={platform} onAction={onAction} stacked />
          </div>
        </div>
      </div>
    );
  }

  // modal
  return (
    <div className={cn(pos, 'inset-0 z-[70] flex items-center justify-center bg-black/50 transition-opacity duration-200', shown ? 'opacity-100' : 'opacity-0', className)} onClick={onDismiss} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        onClick={(e) => e.stopPropagation()}
        className={cn('relative w-[88%] max-w-[420px] overflow-hidden shadow-2xl shadow-black/60 transition-transform duration-200 motion-reduce:transition-none', shown ? 'scale-100' : 'scale-95')}
        style={style}
        data-layout="modal"
      >
        {content.image && <EngageImage image={content.image} fit={content.imageFit} className="aspect-[16/9] w-full" alt={content.imageAlt} />}
        <Dismiss onDismiss={onDismiss} onImage={Boolean(content.image)} />
        <div className="space-y-[0.5em] p-[1.1em] text-center">
          {content.badge && <Badge text={content.badge} content={content} />}
          <Title size="title2">{content.title}</Title>
          {content.body && <Body>{content.body}</Body>}
          <div className="pt-[0.5em]">
            <Buttons buttons={content.buttons} content={content} platform={platform} onAction={onAction} stacked />
          </div>
        </div>
      </div>
    </div>
  );
}
