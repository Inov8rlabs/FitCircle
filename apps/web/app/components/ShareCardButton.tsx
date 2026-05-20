'use client';

/**
 * Share card button + modal — web port of iOS `ShareCardButton` and Android
 * `ShareCardButton`. Generates a card via `/api/mobile/share/cards`, displays
 * the OG-image preview, and offers Web Share API + copy-link fallback.
 *
 * Usage:
 * ```tsx
 * <ShareCardButton context={{
 *   type: 'milestone',
 *   data: { milestoneName: '7-Day Warrior', dayCount: 7, badgeEmoji: '🔥', currentStreak: 7 }
 * }} />
 * ```
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Share2, Check, Copy } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/auth-store';

export type ShareCardType =
  | 'milestone'
  | 'challenge_complete'
  | 'perfect_week'
  | 'momentum_flame'
  | 'circle_boost';

export interface ShareCardContextValue {
  type: ShareCardType;
  /** Data shape varies by type — matches `share-card-service.ts` interfaces. */
  data: Record<string, unknown>;
}

export type ShareCardButtonStyle = 'primary' | 'secondary' | 'icon';

interface Props {
  context: ShareCardContextValue;
  style?: ShareCardButtonStyle;
  label?: string;
  className?: string;
}

interface GeneratedCard {
  id: string;
  image_url: string | null;
  card_type: string;
  shared_count: number;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error ?? `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : 'Request failed');
  }
  return json as T;
}

export function ShareCardButton({
  context, style = 'primary', label = 'Share Achievement', className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<GeneratedCard | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const openShare = async () => {
    setOpen(true);
    if (card) return; // already generated
    setIsGenerating(true);
    try {
      const result = await authedFetch<{ data: GeneratedCard }>('/api/mobile/share/cards', {
        method: 'POST',
        body: JSON.stringify({ card_type: context.type, card_data: context.data }),
      });
      setCard(result.data);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not generate card');
      setOpen(false);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openShare}
        className={[styleClasses(style), className].filter(Boolean).join(' ')}
        aria-label={label}
      >
        <Share2 className={style === 'icon' ? 'h-4 w-4' : 'h-4 w-4 mr-2'} />
        {style !== 'icon' && <span>{label}</span>}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <ShareCardDialog
          card={card}
          isGenerating={isGenerating}
          shareText={shareTextFor(context)}
        />
      </Dialog>
    </>
  );
}

function ShareCardDialog({
  card, isGenerating, shareText,
}: {
  card: GeneratedCard | null;
  isGenerating: boolean;
  shareText: string;
}) {
  const [copied, setCopied] = useState(false);
  const imageUrl = card?.image_url;

  const handleNativeShare = async () => {
    if (!card) return;
    const url = imageUrl ?? window.location.origin;
    const payload: ShareData = { title: 'FitCircle', text: shareText, url };
    if (navigator.share) {
      try {
        await navigator.share(payload);
      } catch (e: any) {
        if (e?.name !== 'AbortError') toast.error('Sharing failed');
      }
    } else {
      void handleCopy();
    }
  };

  const handleCopy = async () => {
    const url = imageUrl ?? window.location.origin;
    try {
      await navigator.clipboard.writeText(`${shareText} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Share your achievement</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="aspect-[1.91/1] bg-zinc-900 rounded-xl overflow-hidden flex items-center justify-center">
          {isGenerating ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="Share card preview" className="w-full h-full object-cover" />
          ) : (
            <p className="text-sm text-muted-foreground p-6 text-center">Card preview unavailable</p>
          )}
        </div>

        <p className="text-sm text-muted-foreground rounded-md bg-zinc-900 p-3 italic">
          "{shareText}"
        </p>
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="secondary" onClick={handleCopy} disabled={!card}>
          {copied ? <><Check className="h-4 w-4 mr-2" />Copied</> : <><Copy className="h-4 w-4 mr-2" />Copy link</>}
        </Button>
        <Button onClick={handleNativeShare} disabled={!card}>
          <Share2 className="h-4 w-4 mr-2" /> Share
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function styleClasses(style: ShareCardButtonStyle): string {
  switch (style) {
    case 'primary':
      return 'w-full inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity';
    case 'secondary':
      return 'inline-flex items-center rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-purple-400 hover:bg-zinc-700 transition-colors';
    case 'icon':
      return 'inline-flex items-center justify-center rounded-full bg-zinc-800 h-10 w-10 text-purple-400 hover:bg-zinc-700 transition-colors';
  }
}

function shareTextFor(ctx: ShareCardContextValue): string {
  switch (ctx.type) {
    case 'milestone': {
      const d = ctx.data as { milestoneName?: string; dayCount?: number; badgeEmoji?: string };
      return `Just hit the ${d.milestoneName ?? 'milestone'} — ${d.dayCount ?? ''} days of momentum on FitCircle! ${d.badgeEmoji ?? '🔥'}`;
    }
    case 'challenge_complete': {
      const d = ctx.data as { challengeName?: string };
      return `Just completed the ${d.challengeName ?? 'challenge'} on FitCircle! 🏆`;
    }
    case 'perfect_week':
      return 'Perfect week on FitCircle! 7 days of consistent check-ins! ✨';
    case 'momentum_flame': {
      const d = ctx.data as { flameLevel?: number };
      return `My momentum flame is at level ${d.flameLevel ?? 'max'} on FitCircle! 🔥`;
    }
    case 'circle_boost': {
      const d = ctx.data as { multiplier?: number };
      return `Our circle just hit ${d.multiplier ?? ''}x boost on FitCircle! ⚡`;
    }
    default:
      return 'Crushing it on FitCircle!';
  }
}
