'use client';

import { Apple, Bell, Copy, Download, ExternalLink, Mail, RefreshCw, Smartphone, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { campaignsAdmin, CampaignApiError, isAppStoreNotConnected, type AppStoreStatus } from '@/lib/campaigns/admin-client';
import { renderSlotPng } from '@/lib/campaigns/art/campaign-art';
import { APP_STORE_LIMITS, appStoreRules, shortDate } from '@/lib/campaigns/campaign-utils';
import type { AppStoreBadge, ArtSlot, CampaignAppStore } from '@/lib/campaigns/types';
import { ART_SLOT_SIZES } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

import { BADGE_LABELS } from '../DeviceMocks';
import type { EditorApi } from '../editor-api';
import { Btn, Callout, Section, SelectField, TextAreaField, TextField, downloadFile } from '../fields';

const PURPOSES: { value: NonNullable<CampaignAppStore['purpose']>; label: string }[] = [
  { value: 'APPROPRIATE_FOR_ALL_USERS', label: 'Appropriate for all users' },
  { value: 'ATTRACT_NEW_USERS', label: 'Attract new users' },
  { value: 'KEEP_ACTIVE_USERS_INFORMED', label: 'Keep active users informed' },
  { value: 'BRING_BACK_LAPSED_USERS', label: 'Bring back lapsed users' },
];

const PLAY_CONSOLE_URL = 'https://play.google.com/console/developers';

export function ChannelsSection({ api }: { api: EditorApi }) {
  const { draft, update } = api;
  const as = draft.appStore ?? {};
  const setAs = (patch: Partial<CampaignAppStore>) => update({ appStore: { ...as, ...patch } });
  const pushOn = draft.notifications.filter((n) => n.enabled).length;
  const emailOn = draft.emails.filter((n) => n.enabled).length;

  return (
    <Section id="channels" index={7} title="Channels" description="Where the campaign shows up.">
      <div className="grid gap-2 sm:grid-cols-3">
        <ChannelChip icon={<Smartphone className="h-4 w-4" />} name="In-app" status="Always on" ok />
        <ChannelChip icon={<Bell className="h-4 w-4" />} name="Push" status={pushOn ? `${pushOn} scheduled` : 'None'} ok={pushOn > 0} href="#messages" />
        <ChannelChip icon={<Mail className="h-4 w-4" />} name="Email" status={emailOn ? `${emailOn} scheduled` : 'None'} ok={emailOn > 0} href="#messages" />
      </div>

      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <Apple className="h-4 w-4" /> App Store In-App Event
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Event name" value={as.name ?? ''} max={APP_STORE_LIMITS.name} placeholder={draft.title} onChange={(name) => setAs({ name })} />
          <SelectField
            label="Badge"
            value={as.badge ?? 'CHALLENGE'}
            options={(Object.keys(BADGE_LABELS) as AppStoreBadge[]).map((b) => ({ value: b, label: BADGE_LABELS[b] }))}
            onChange={(badge) => setAs({ badge })}
          />
        </div>
        <TextField label="Short description" value={as.shortDescription ?? ''} max={APP_STORE_LIMITS.shortDescription} placeholder={draft.tagline} onChange={(shortDescription) => setAs({ shortDescription })} />
        <TextAreaField label="Long description" value={as.longDescription ?? ''} max={APP_STORE_LIMITS.longDescription} rows={2} onChange={(longDescription) => setAs({ longDescription })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Purpose" value={as.purpose ?? 'APPROPRIATE_FOR_ALL_USERS'} options={PURPOSES} onChange={(purpose) => setAs({ purpose })} />
          <SelectField
            label="Priority"
            value={as.priority ?? 'NORMAL'}
            options={[
              { value: 'NORMAL', label: 'Normal' },
              { value: 'HIGH', label: 'High' },
            ]}
            onChange={(priority) => setAs({ priority })}
          />
        </div>
        {(draft.platforms ?? []).length > 0 && !(draft.platforms ?? []).includes('ios') && <Callout tone="warn">This campaign doesn&apos;t target iOS, so the App Store event isn&apos;t needed.</Callout>}
        <AppStoreStatusPanel api={api} />
      </div>

      <PlayPanel api={api} />
    </Section>
  );
}

function ChannelChip({ icon, name, status, ok, href }: { icon: React.ReactNode; name: string; status: string; ok: boolean; href?: string }) {
  const body = (
    <div className={cn('flex items-center gap-3 rounded-xl border p-3', ok ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/40')}>
      <span className={ok ? 'text-emerald-300' : 'text-slate-500'}>{icon}</span>
      <div>
        <p className="text-sm font-medium text-white">{name}</p>
        <p className="text-xs text-slate-400">{status}</p>
      </div>
    </div>
  );
  return href ? <a href={href}>{body}</a> : body;
}

function AppStoreStatusPanel({ api }: { api: EditorApi }) {
  const id = api.campaign?.id ?? null;
  const [status, setStatus] = useState<AppStoreStatus | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'sync' | 'submit' | 'load' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setBusy('load');
    try {
      const s = await campaignsAdmin.appStoreStatus(id);
      setStatus(s);
      setConnected(s?.connected !== false);
      setError(null);
    } catch (e) {
      if (isAppStoreNotConnected(e)) setConnected(false);
      else setError(e instanceof CampaignApiError ? e.message : 'Could not load App Store status');
    } finally {
      setBusy(null);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (kind: 'sync' | 'submit') => {
    const c = await api.ensureSaved();
    if (!c) return;
    setBusy(kind);
    try {
      await (kind === 'sync' ? campaignsAdmin.appStoreSync(c.id) : campaignsAdmin.appStoreSubmit(c.id));
      toast.success(kind === 'sync' ? 'Synced to App Store Connect' : 'Submitted for review');
      void api.refreshServer();
      void load();
    } catch (e) {
      if (isAppStoreNotConnected(e)) setConnected(false);
      else {
        const issues = e instanceof CampaignApiError && Array.isArray(e.details?.issues) ? ` ${(e.details.issues as unknown[]).map(String).join(' · ')}` : '';
        toast.error(`${e instanceof CampaignApiError ? e.message : `App Store ${kind} failed`}${issues}`);
      }
    } finally {
      setBusy(null);
    }
  };

  const rules = appStoreRules(api.draft);
  const pick = <K extends 'eventId' | 'state' | 'lastSyncedAt' | 'lastError'>(k: K) => (status && status[k] !== undefined ? status[k] : api.campaign?.appStore?.[k]) ?? null;
  const as = { eventId: pick('eventId'), state: pick('state'), lastSyncedAt: pick('lastSyncedAt'), lastError: pick('lastError') };
  const issues = status?.issues ?? [];

  if (!id) return <Callout tone="info">Save the campaign to sync it to App Store Connect.</Callout>;
  if (connected === false) return <ExportPack api={api} kind="appstore" />;

  return (
    <div className="space-y-3">
      {error && <Callout tone="error">{error}</Callout>}
      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <Stat label="State" value={as.state ?? (as.eventId ? 'Created' : 'Not synced')} />
        <Stat label="Event id" value={as.eventId ?? '—'} mono />
        <Stat label="Last sync" value={as.lastSyncedAt ? new Date(as.lastSyncedAt).toLocaleString() : '—'} />
        <Stat label="Promo from" value={rules.promoStart ? shortDate(rules.promoStart) : '—'} />
      </div>
      {as.lastError && <Callout tone="error">Last error: {as.lastError}</Callout>}
      {issues.length > 0 && (
        <Callout tone="warn">
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Callout>
      )}
      {!rules.durationOk && <Callout tone="warn">The event is longer than 31 days. App Store Connect will reject it.</Callout>}
      <div className="flex flex-wrap gap-2">
        <Btn onClick={() => void run('sync')} loading={busy === 'sync'}>
          <RefreshCw className="h-4 w-4" /> Sync event + screenshots
        </Btn>
        <Btn variant="primary" onClick={() => void run('submit')} loading={busy === 'submit'} disabled={!as.eventId}>
          <Upload className="h-4 w-4" /> Submit for review
        </Btn>
        <Btn variant="ghost" onClick={() => void load()} loading={busy === 'load'}>
          Refresh status
        </Btn>
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-900/80 p-2.5">
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn('truncate text-sm text-white', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  );
}

function PlayPanel({ api }: { api: EditorApi }) {
  const { draft, update } = api;
  const play = draft.play ?? {};
  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">▶ Google Play promotional content</p>
        <a href={PLAY_CONSOLE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-purple-300 hover:underline">
          Play Console → Grow → Promotional content <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="text-xs text-slate-400">No public API: create it by hand in Play Console with this export pack.</p>
      {(draft.platforms ?? []).length > 0 && !(draft.platforms ?? []).includes('android') && <Callout tone="warn">This campaign doesn&apos;t target Android, so a Play promo isn&apos;t needed.</Callout>}
      <TextField label="Title" value={play.title ?? ''} max={80} placeholder={draft.title} onChange={(title) => update({ play: { ...play, title } })} />
      <TextAreaField label="Description" value={play.description ?? ''} max={500} rows={3} placeholder={draft.description} onChange={(description) => update({ play: { ...play, description } })} />
      <ExportPack api={api} kind="play" />
    </div>
  );
}

function ExportPack({ api, kind }: { api: EditorApi; kind: 'appstore' | 'play' }) {
  const { draft, campaign } = api;
  const slots: ArtSlot[] = kind === 'appstore' ? ['appStoreCard', 'appStoreDetails'] : ['appStoreCard'];
  const as = draft.appStore ?? {};
  const rules = appStoreRules(draft);
  const copy =
    kind === 'appstore'
      ? [
          `Reference name: ${draft.slug}`,
          `Event name (≤30): ${as.name || draft.title}`,
          `Short description (≤50): ${as.shortDescription || draft.tagline}`,
          `Long description (≤120): ${as.longDescription || draft.description}`,
          `Badge: ${as.badge ?? 'CHALLENGE'}`,
          `Purpose: ${as.purpose ?? 'APPROPRIATE_FOR_ALL_USERS'} · Priority: ${as.priority ?? 'NORMAL'}`,
          `Event start: ${draft.startsAt} · Event end: ${draft.endsAt}`,
          `Publish start (promotion): ${rules.promoStart ?? draft.featuredFrom}`,
          `Deep link: https://www.fitcircle.ai/c/${draft.slug}`,
        ].join('\n')
      : [
          `Title (≤80): ${draft.play?.title || draft.title}`,
          `Description (≤500): ${draft.play?.description || draft.description}`,
          `Start: ${draft.startsAt} · End: ${draft.endsAt}`,
          `Deep link: https://www.fitcircle.ai/c/${draft.slug}`,
        ].join('\n');

  const download = async (slot: ArtSlot) => {
    const { width, height } = ART_SLOT_SIZES[slot];
    const name = `${draft.slug || 'campaign'}-${kind === 'play' ? 'play-' : ''}${slot}-${width}x${height}.png`;
    const asset = campaign?.art?.[slot];
    try {
      if (asset) await downloadFile(asset.url, name);
      else await downloadFile(await renderSlotPng(draft, slot), name);
    } catch {
      toast.error('Download failed');
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-700 p-3">
      {kind === 'appstore' && (
        <Callout tone="warn">
          App Store Connect isn&apos;t connected on this server (ASC_* env missing), so create the event by hand. Export pack below.
        </Callout>
      )}
      <div className="flex flex-wrap gap-2">
        {slots.map((s) => (
          <Btn key={s} size="sm" onClick={() => void download(s)}>
            <Download className="h-3.5 w-3.5" /> {ART_SLOT_SIZES[s].width}×{ART_SLOT_SIZES[s].height} PNG{campaign?.art?.[s] ? '' : ' (generated)'}
          </Btn>
        ))}
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => void navigator.clipboard?.writeText(copy).then(() => toast.success('Copied'))}
        >
          <Copy className="h-3.5 w-3.5" /> Copy text
        </Btn>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950/80 p-3 font-mono text-xs leading-relaxed text-slate-300">{copy}</pre>
    </div>
  );
}
