/** Fitzy Pro paywall payloads (docs/FITZY_V2_SPEC.md §6). */
import type { FitzyPaywall, PaywallTrigger } from '../types/fitzy';

const HEADLINES: Record<PaywallTrigger, string> = {
  fitzy_quota: 'Keep the momentum going',
  weekly_plan: 'Your plan is ready',
  memory: 'Fitzy can remember what matters to you',
  history: 'Pick up any conversation',
};

const BULLETS = ['Unlimited coaching with Fitzy, every day', 'A weekly plan built around your goals', 'Fitzy remembers your routines and preferences'];

export function paywallFor(trigger: PaywallTrigger): FitzyPaywall {
  return { trigger, headline: HEADLINES[trigger], bullets: [...BULLETS], cta: 'Unlock Fitzy Pro' };
}
