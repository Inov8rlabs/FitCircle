/**
 * Push renderer: PushContent → the NotificationOrchestrator call. Lifecycle
 * pushes reuse existing notification types where one already exists (the
 * weekly report rides `weekly_summary`, a journey-category type the apps
 * already route to the dashboard); onboarding / re-engagement use the
 * data-driven `lifecycle_nudge` type (journey category, screen from data).
 */
import { stripEmoji } from '../../text/strip-emoji';
import type { MessageKey, PushContent } from '../types';

export type LifecyclePushType = 'weekly_summary' | 'lifecycle_nudge';

export interface RenderedPush {
  type: LifecyclePushType;
  data: {
    title: string;
    body: string;
    screen: PushContent['screen'];
    dedupeKey: string;
    messageKey: MessageKey;
  };
}

/** Lock-screen limits the apps render without truncating mid-word. */
const TITLE_MAX = 60;
const BODY_MAX = 160;

const clip = (s: string, max: number) => {
  const chars = [...stripEmoji(s).trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
};

export function renderPush(p: PushContent, messageKey: MessageKey, periodKey: string): RenderedPush {
  return {
    type: messageKey === 'weekly_report' ? 'weekly_summary' : 'lifecycle_nudge',
    data: {
      title: clip(p.title, TITLE_MAX),
      body: clip(p.body, BODY_MAX),
      screen: p.screen,
      // Same key on a re-run → the orchestrator's 24 h dedupe guard drops it.
      dedupeKey: `engagement:${messageKey}:${periodKey}`.slice(0, 120),
      messageKey,
    },
  };
}
