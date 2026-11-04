/**
 * Fixed per-state card colours + icon (not editable) — a leaf module so config.ts can check
 * admin button styles against each state's card without importing card.ts.
 */
import type { PromoTheme } from '../promos/types';

import type { ProLifecycleState } from './types';

const theme = (colors: string[]): PromoTheme => ({ background: { kind: 'gradient', colors }, foreground: 'light' });

/** Fixed per state (not editable): colours + icon key (with the legacy glyph for pre-icon_keys builds). */
export const STATE_STYLE: Record<ProLifecycleState, { theme: PromoTheme; icon: 'hourglass' | 'crown'; emoji: string; countdownLabel: string | null }> = {
  pro_expiring: { theme: theme(['#1E1B4B', '#4338CA', '#7C3AED']), icon: 'hourglass', emoji: '⏳', countdownLabel: 'Pro ends in' },
  pro_expired: { theme: theme(['#3B0764', '#7E22CE', '#BE185D']), icon: 'crown', emoji: '👑', countdownLabel: null },
  trial_expiring: { theme: theme(['#0C4A6E', '#0369A1', '#6D28D9']), icon: 'hourglass', emoji: '⏳', countdownLabel: 'Trial ends in' },
};

