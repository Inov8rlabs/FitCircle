'use client';

/**
 * Web app Engage renderer (ENGAGE_SPEC §8, §13): fetches GET /api/mobile/engage
 * (x-platform: web), renders content cards per placement and in-app messages
 * as overlays, evaluates triggers on the client, reports impressions / clicks /
 * dismissals and app events in batches.
 */

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import {
  APP_EVENT,
  canShowInApp,
  emitAppEvent,
  fetchEngage,
  recordInAppShown,
  routeForScreen,
  screenForPath,
  startEventQueue,
  trackEngage,
  triggerMatches,
  type AppEventDetail,
} from '@/lib/engage/client/runtime';
import { PLACEMENT_MAX } from '@/lib/engage/types';
import type { CardView, EngageAction, EngageResponse, InAppView, Placement } from '@/lib/engage/types';
import { STREAK_AUTO_CLAIMED_EVENT, type StreakAutoClaimMeta } from '@/lib/streaks/auto-claim-events';
import { useAuthStore } from '@/stores/auth-store';

import { ContentCardView, InAppMessageView } from './layouts';

interface EngageCtx {
  data: EngageResponse | null;
  dismissed: Set<string>;
  dismissCard: (card: CardView) => void;
  runAction: (action: EngageAction | undefined, ctx: { messageId: string; variantId: string; channel: 'content_card' | 'in_app'; buttonIndex: number }) => void;
}

const Ctx = createContext<EngageCtx | null>(null);
const REFRESH_MS = 15 * 60_000;

export function useEngage(): EngageCtx | null {
  return useContext(Ctx);
}

/** Mounted once (root providers). Inactive until a user is signed in. */
export function EngageRoot({ children }: { children: React.ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id);
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<EngageResponse | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<InAppView | null>(null);
  const dataRef = useRef<EngageResponse | null>(null);
  dataRef.current = data;

  const load = useCallback(async () => {
    try {
      setData(await fetchEngage());
    } catch {
      // keep the last response
    }
  }, []);

  // Fetch + refresh, event queue, app_open.
  useEffect(() => {
    if (!userId) {
      setData(null);
      return;
    }
    const stop = startEventQueue();
    void load();
    emitAppEvent('app_open');
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), REFRESH_MS);
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [userId, load]);

  // screen_view on route changes.
  useEffect(() => {
    if (!userId || !pathname) return;
    const screen = screenForPath(pathname);
    if (screen) emitAppEvent('screen_view', { screen });
  }, [userId, pathname]);

  // Check-ins (server-side streak auto-claims) → check_in_completed / streak_milestone.
  useEffect(() => {
    if (!userId) return;
    const onClaim = (e: Event) => {
      const meta = (e as CustomEvent<StreakAutoClaimMeta>).detail;
      if (!meta?.claimed) return;
      emitAppEvent('check_in_completed', { streak: meta.streakCount ?? null });
      if (meta.milestone) emitAppEvent('streak_milestone', { days: meta.milestone.milestone });
    };
    window.addEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
    return () => window.removeEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
  }, [userId]);

  // On-device trigger evaluation.
  useEffect(() => {
    if (!userId) return;
    const timers: number[] = [];
    const onEvent = (e: Event) => {
      const ev = (e as CustomEvent<AppEventDetail>).detail;
      const d = dataRef.current;
      if (!d || active) return;
      const blocked = typeof window !== 'undefined' && /^\/(onboarding|upgrade|login|register)/.test(window.location.pathname);
      if (blocked) return;
      const candidates = [...(d.inApp ?? [])].filter((m) => triggerMatches(m, ev) && canShowInApp(m, d.caps)).sort((a, b) => b.priority - a.priority);
      const pick = candidates[0];
      if (!pick) return;
      timers.push(
        window.setTimeout(() => {
          if (!canShowInApp(pick, dataRef.current?.caps ?? d.caps)) return;
          recordInAppShown(pick.messageId);
          setActive(pick);
        }, Math.min(30, Math.max(0, pick.trigger.delaySeconds)) * 1000)
      );
    };
    window.addEventListener(APP_EVENT, onEvent);
    return () => {
      window.removeEventListener(APP_EVENT, onEvent);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [userId, active]);

  const runAction = useCallback<EngageCtx['runAction']>(
    (action, c) => {
      trackEngage({ type: 'click', messageId: c.messageId, variantId: c.variantId, buttonIndex: c.buttonIndex });
      analytics.track(AnalyticsEvents.engageMessageClicked({ message_id: c.messageId, variant_id: c.variantId, channel: c.channel, button_index: c.buttonIndex, action: action?.type }));
      if (!action) return;
      switch (action.type) {
        case 'url':
          if (action.value && /^https:\/\//.test(action.value)) window.open(action.value, '_blank', 'noopener,noreferrer');
          break;
        case 'invite':
          router.push('/invite');
          break;
        case 'paywall':
          router.push('/upgrade');
          break;
        case 'campaign':
          if (action.value) router.push(`/c/${encodeURIComponent(action.value)}`);
          break;
        case 'start_circle':
          router.push(action.value ? `/c/${encodeURIComponent(action.value)}` : '/fitcircles');
          break;
        case 'deeplink':
        case 'screen':
          router.push(routeForScreen(action.value));
          break;
        case 'dismiss':
        default:
          break;
      }
    },
    [router]
  );

  const dismissCard = useCallback((card: CardView) => {
    setDismissed((s) => new Set(s).add(card.messageId));
    trackEngage({ type: 'dismiss', messageId: card.messageId, variantId: card.variantId });
    analytics.track(AnalyticsEvents.engageMessageDismissed({ message_id: card.messageId, variant_id: card.variantId, channel: 'content_card' }));
  }, []);

  const value = useMemo(() => ({ data, dismissed, dismissCard, runAction }), [data, dismissed, dismissCard, runAction]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {active && (
        <ActiveInApp
          key={active.messageId}
          m={active}
          onClose={(reason) => {
            if (reason === 'dismiss') {
              trackEngage({ type: 'dismiss', messageId: active.messageId, variantId: active.variantId });
              analytics.track(AnalyticsEvents.engageMessageDismissed({ message_id: active.messageId, variant_id: active.variantId, channel: 'in_app' }));
            }
            setActive(null);
          }}
          runAction={runAction}
        />
      )}
    </Ctx.Provider>
  );
}

function ActiveInApp({ m, onClose, runAction }: { m: InAppView; onClose: (reason: 'dismiss' | 'action') => void; runAction: EngageCtx['runAction'] }) {
  useEffect(() => {
    trackEngage({ type: 'impression', messageId: m.messageId, variantId: m.variantId });
    analytics.track(AnalyticsEvents.engageMessageViewed({ message_id: m.messageId, variant_id: m.variantId, channel: 'in_app', layout: m.layout }));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose('dismiss');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [m, onClose]);
  return (
    <InAppMessageView
      layout={m.layout}
      content={m.content}
      platform="web"
      onDismiss={() => onClose('dismiss')}
      onAction={(i) => {
        const b = m.content.buttons[i];
        runAction(b?.action, { messageId: m.messageId, variantId: m.variantId, channel: 'in_app', buttonIndex: i });
        onClose(b?.action.type === 'dismiss' ? 'dismiss' : 'action');
      }}
    />
  );
}

/** Reports one impression when ≥ 50% visible for ≥ 1 s (once per page session). */
const seen = new Set<string>();
function useImpression(card: CardView) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen.has(card.messageId) || typeof IntersectionObserver === 'undefined') return;
    let t: number | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          t ??= window.setTimeout(() => {
            if (seen.has(card.messageId)) return;
            seen.add(card.messageId);
            trackEngage({ type: 'impression', messageId: card.messageId, variantId: card.variantId });
            analytics.track(AnalyticsEvents.engageMessageViewed({ message_id: card.messageId, variant_id: card.variantId, channel: 'content_card', layout: card.layout, placement: card.placement }));
            io.disconnect();
          }, 1000);
        } else if (t) {
          window.clearTimeout(t);
          t = null;
        }
      },
      { threshold: [0, 0.5, 1] }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (t) window.clearTimeout(t);
    };
  }, [card]);
  return ref;
}

function PlacedCard({ card, ctx }: { card: CardView; ctx: EngageCtx }) {
  const ref = useImpression(card);
  return (
    <div ref={ref}>
      <ContentCardView
        layout={card.layout}
        content={card.content}
        platform="web"
        onDismiss={() => ctx.dismissCard(card)}
        onAction={(i) => {
          const b = card.content.buttons[i];
          if (b?.action.type === 'dismiss') return ctx.dismissCard(card);
          ctx.runAction(b?.action, { messageId: card.messageId, variantId: card.variantId, channel: 'content_card', buttonIndex: i });
        }}
      />
    </div>
  );
}

/** Content cards for a placement; renders nothing (no gap) when empty. */
export function EngagePlacement({ placement, className }: { placement: Placement; className?: string }) {
  const ctx = useEngage();
  if (!ctx?.data) return null;
  const cards = (ctx.data.cards?.[placement] ?? [])
    .filter((c) => !ctx.dismissed.has(c.messageId))
    .sort((a, b) => Number(b.content.pinned) - Number(a.content.pinned) || b.priority - a.priority)
    .slice(0, PLACEMENT_MAX[placement] ?? 1);
  if (cards.length === 0) return null;
  return (
    <div className={className}>
      <div className="space-y-3">
        {cards.map((c) => (
          <PlacedCard key={c.messageId} card={c} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

/**
 * home_hero merge (§8): the campaign card wins when the server says so (or when
 * there's no hero content card); otherwise the content card shows.
 */
export function useHeroDecision(): { showCampaign: boolean; card: CardView | null } {
  const ctx = useEngage();
  const card = ctx?.data?.cards?.home_hero?.find((c) => !ctx.dismissed.has(c.messageId)) ?? null;
  if (!ctx?.data || !card || ctx.data.heroCampaignSlug) return { showCampaign: true, card: null };
  return { showCampaign: false, card };
}
