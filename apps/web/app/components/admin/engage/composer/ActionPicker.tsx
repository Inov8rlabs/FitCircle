'use client';

import { useEffect, useState } from 'react';

import { campaignsAdmin } from '@/lib/campaigns/admin-client';
import type { AdminCampaign } from '@/lib/campaigns/types';
import type { ActionType, EngageAction } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { inputCls } from '../ui';

export const ACTION_LABEL: Record<ActionType, string> = {
  deeplink: 'Open screen (deep link)',
  url: 'Open URL',
  invite: 'Invite friends',
  paywall: 'Show paywall',
  start_circle: 'Start a circle',
  campaign: 'Open campaign',
  screen: 'Screen key',
  dismiss: 'Dismiss',
};

/** Same routes as push `screen` (ENGAGE_SPEC §4). */
export const DEEPLINK_ROUTES: readonly { value: string; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'circles', label: 'Circles' },
  { value: 'food_log', label: 'Food log' },
  { value: 'log_meal', label: 'Log a meal (camera)' },
  { value: 'invite_hub', label: 'Invite hub' },
  { value: 'streaks', label: 'Streaks' },
  { value: 'workouts', label: 'Workouts' },
  { value: 'profile', label: 'Profile' },
  { value: 'settings', label: 'Settings' },
  { value: 'paywall', label: 'Paywall' },
];

let campaignCache: Promise<AdminCampaign[]> | null = null;
export function useCampaignOptions(): AdminCampaign[] {
  const [list, setList] = useState<AdminCampaign[]>([]);
  useEffect(() => {
    campaignCache ??= campaignsAdmin.list().catch(() => {
      campaignCache = null;
      return [];
    });
    let alive = true;
    void campaignCache.then((l) => alive && setList(l.filter((c) => c.status !== 'archived')));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

const sel = cn(inputCls, 'h-9 py-1.5');

export function ActionPicker({ value, onChange, allow, compact }: { value: EngageAction; onChange: (a: EngageAction) => void; allow?: ActionType[]; compact?: boolean }) {
  const campaigns = useCampaignOptions();
  const types = (allow ?? (Object.keys(ACTION_LABEL) as ActionType[]));
  return (
    <div className={cn('flex flex-wrap gap-2', compact && 'flex-nowrap')}>
      <select
        value={value.type}
        onChange={(e) => {
          const t = e.target.value as ActionType;
          onChange({ type: t, value: t === 'deeplink' || t === 'screen' ? 'home' : t === 'url' ? 'https://' : null });
        }}
        className={cn(sel, 'w-48')}
        aria-label="Action"
      >
        {types.map((t) => (
          <option key={t} value={t}>
            {ACTION_LABEL[t]}
          </option>
        ))}
      </select>
      {(value.type === 'deeplink' || value.type === 'screen') && (
        <select value={value.value ?? 'home'} onChange={(e) => onChange({ ...value, value: e.target.value })} className={cn(sel, 'w-44')} aria-label="Route">
          {DEEPLINK_ROUTES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      )}
      {value.type === 'url' && (
        <input
          value={value.value ?? ''}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          placeholder="https://"
          className={cn(sel, 'min-w-[12rem] flex-1', value.value && !/^https:\/\//.test(value.value) && 'border-rose-500/60')}
          aria-label="URL"
        />
      )}
      {(value.type === 'campaign' || value.type === 'start_circle') && (
        <select value={value.value ?? ''} onChange={(e) => onChange({ ...value, value: e.target.value || null })} className={cn(sel, 'w-52')} aria-label="Campaign">
          <option value="">{value.type === 'start_circle' ? 'No prefill (blank wizard)' : 'Choose a campaign…'}</option>
          {campaigns
            .filter((c) => value.type !== 'start_circle' || c.circle)
            .map((c) => (
              <option key={c.id} value={c.slug}>
                {c.emoji} {c.title} · {c.status}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}
