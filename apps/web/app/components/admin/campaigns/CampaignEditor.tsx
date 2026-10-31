'use client';

import { ArrowLeft, Check, ExternalLink, Loader2, RotateCcw, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { campaignsAdmin, CampaignApiError, isVersionConflict } from '@/lib/campaigns/admin-client';
import { svgDataUrl, svgFor } from '@/lib/campaigns/art/campaign-art';
import { buildPreviewView, newCampaignInput, phaseOn, toInput, todayYmd } from '@/lib/campaigns/campaign-utils';
import type { AdminCampaign, ArtSlot, CampaignInput } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

import { AppStoreCardMock, CalendarMock, HomeMock } from './DeviceMocks';
import type { EditorApi } from './editor-api';
import { Btn, Callout, StatusPill } from './fields';
import { BasicsSection } from './sections/BasicsSection';
import { ChannelsSection } from './sections/ChannelsSection';
import { ContentSection } from './sections/ContentSection';
import { CreativeSection } from './sections/CreativeSection';
import { DatesSection } from './sections/DatesSection';
import { EngageMessagesSection } from './sections/EngageMessagesSection';
import { GoLiveSection } from './sections/GoLiveSection';
import { MessagesSection } from './sections/MessagesSection';
import { DateScrubber, PreviewSection } from './sections/PreviewSection';

const SECTIONS = [
  { id: 'basics', label: 'Basics' },
  { id: 'dates', label: 'Dates' },
  { id: 'content', label: 'Content' },
  { id: 'creative', label: 'Creative' },
  { id: 'messages', label: 'Messages' },
  { id: 'engage', label: 'Engage' },
  { id: 'channels', label: 'Channels' },
  { id: 'preview', label: 'Preview' },
  { id: 'golive', label: 'Go live' },
] as const;

function initialPreviewDate(c: CampaignInput): string {
  const today = todayYmd();
  return phaseOn(c, today) ? today : c.startsAt;
}

export function CampaignEditor({ id }: { id: string | null }) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<AdminCampaign | null>(null);
  const [draft, setDraft] = useState<CampaignInput>(() => newCampaignInput('seasonal_circle'));
  const [baseline, setBaseline] = useState<string>(() => (id ? '' : JSON.stringify(newCampaignInput('seasonal_circle'))));
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(id ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const [previewDate, setPreviewDate] = useState<string>(() => initialPreviewDate(draft));
  const [todayOpened, setTodayOpened] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('basics');
  const savePromise = useRef<Promise<AdminCampaign | null> | null>(null);

  const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = draftJson !== baseline;

  const adopt = useCallback((c: AdminCampaign, resetDraft: boolean) => {
    setCampaign(c);
    if (resetDraft) {
      const input = toInput(c);
      setDraft(input);
      setBaseline(JSON.stringify(input));
    }
  }, []);

  // Load
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoadState('loading');
    campaignsAdmin
      .get(id)
      .then((c) => {
        if (!alive) return;
        adopt(c, true);
        setPreviewDate(initialPreviewDate(toInput(c)));
        setLoadState('ready');
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e instanceof CampaignApiError ? (e.status === 404 ? 'Campaign not found.' : e.message) : 'Could not load the campaign.');
        setLoadState('error');
      });
    return () => {
      alive = false;
    };
  }, [id, adopt]);

  const save = useCallback(async (): Promise<AdminCampaign | null> => {
    if (savePromise.current) return savePromise.current;
    const run = (async () => {
      setSaving(true);
      const body = draft;
      const bodyJson = JSON.stringify(body);
      try {
        let saved: AdminCampaign;
        if (!campaign) {
          saved = await campaignsAdmin.create(body);
          setCampaign(saved);
          setBaseline(bodyJson);
          router.replace(`/admin/campaigns/${saved.id}`);
        } else {
          saved = await campaignsAdmin.update(campaign.id, body, campaign.version);
          setCampaign(saved);
          setBaseline(bodyJson);
        }
        setSavedAt(Date.now());
        setConflict(false);
        return saved;
      } catch (e) {
        if (isVersionConflict(e)) {
          setConflict(true);
          toast.error('Someone else saved this campaign. Reload to continue.');
        } else {
          const field = e instanceof CampaignApiError && e.details?.field ? ` (${String(e.details.field)})` : '';
          toast.error(`${e instanceof CampaignApiError ? e.message : 'Save failed'}${field}`);
        }
        return null;
      } finally {
        setSaving(false);
        savePromise.current = null;
      }
    })();
    savePromise.current = run;
    return run;
  }, [draft, campaign, router]);

  const ensureSaved = useCallback(async () => {
    if (campaign && !dirty) return campaign;
    return save();
  }, [campaign, dirty, save]);

  const refreshServer = useCallback(async () => {
    if (!campaign) return null;
    try {
      const c = await campaignsAdmin.get(campaign.id);
      adopt(c, !dirty);
      return c;
    } catch {
      return null;
    }
  }, [campaign, dirty, adopt]);

  const reloadAfterConflict = async () => {
    if (!campaign) return;
    try {
      const c = await campaignsAdmin.get(campaign.id);
      adopt(c, true);
      setConflict(false);
      toast.success('Reloaded the latest version');
    } catch {
      toast.error('Reload failed');
    }
  };

  // ⌘S / Ctrl+S, and warn before leaving with unsaved changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [save, dirty]);

  // Scroll-spy for the section nav.
  useEffect(() => {
    if (loadState !== 'ready') return;
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveSection(top.target.id);
      },
      { rootMargin: '-140px 0px -55% 0px' }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [loadState]);

  // Preview state (deferred so typing never waits on mock rendering).
  const deferredDraft = useDeferredValue(draft);
  const [localArt, setLocalArtState] = useState<Partial<Record<ArtSlot, string>>>({});
  const setLocalArt = useCallback((slot: ArtSlot, url: string | null) => setLocalArtState((m) => {
    const next = { ...m };
    if (url) next[slot] = url;
    else delete next[slot];
    return next;
  }), []);
  const mergedArt = useMemo(() => {
    const out = { ...(campaign?.art ?? {}) };
    for (const [slot, url] of Object.entries(localArt) as [ArtSlot, string][]) out[slot] = { url, width: 0, height: 0, generated: false, updatedAt: new Date().toISOString() };
    return out;
  }, [campaign?.art, localArt]);
  const previewView = useMemo(
    () => buildPreviewView({ ...deferredDraft, id: campaign?.id, art: mergedArt }, previewDate, { todayOpened }),
    [deferredDraft, campaign?.id, mergedArt, previewDate, todayOpened]
  );
  const creativeKey = JSON.stringify([deferredDraft.template, deferredDraft.palette, deferredDraft.glyph, deferredDraft.startsAt, deferredDraft.endsAt, deferredDraft.marks, deferredDraft.slug]);
  const generatedCache = useRef<{ key: string; urls: Partial<Record<ArtSlot, string>> }>({ key: '', urls: {} });
  const artFor = useCallback(
    (slot: ArtSlot) => {
      if (localArt[slot]) return { url: localArt[slot], uploaded: true };
      const asset = campaign?.art?.[slot];
      if (asset?.url) return { url: asset.url, uploaded: true };
      if (generatedCache.current.key !== creativeKey) generatedCache.current = { key: creativeKey, urls: {} };
      const cached = generatedCache.current.urls[slot];
      if (cached) return { url: cached, uploaded: false };
      const url = svgDataUrl(svgFor(deferredDraft, slot));
      generatedCache.current.urls[slot] = url;
      return { url, uploaded: false };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign?.art, creativeKey, localArt]
  );

  const api: EditorApi = {
    draft,
    campaign,
    dirty,
    update: (patch) => setDraft((d) => ({ ...d, ...patch })),
    set: (fn) => setDraft(fn),
    ensureSaved,
    applyServer: (c) => adopt(c, !dirty),
    refreshServer,
    previewDate,
    setPreviewDate,
    todayOpened,
    setTodayOpened,
    previewView,
    artFor,
    setLocalArt,
  };

  if (loadState === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (loadState === 'error') {
    return (
      <div className="mx-auto max-w-lg py-24 text-center">
        <p className="text-lg font-semibold text-white">{loadError}</p>
        <Link href="/admin/campaigns" className="mt-4 inline-block text-sm text-purple-300 hover:underline">
          ← All campaigns
        </Link>
      </div>
    );
  }

  const status = campaign?.status ?? 'new';
  const card = artFor('appStoreCard');

  return (
    <div className="pb-24">
      {/* Top bar */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-slate-800 bg-[#070a17]/90 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex h-14 items-center gap-3">
          <Link href="/admin/campaigns" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="All campaigns">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="text-2xl" aria-hidden>
            {draft.emoji || '✨'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white sm:text-base">{draft.title || 'Untitled campaign'}</p>
            <p className="truncate text-xs text-slate-500">{draft.slug ? `/c/${draft.slug}` : 'New campaign'}</p>
          </div>
          <StatusPill status={status} />
          <span className="hidden text-xs text-slate-500 md:inline">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            ) : (
              'Up to date'
            )}
          </span>
          {campaign?.published && (
            <a href={`/c/${campaign.slug}`} target="_blank" rel="noreferrer" className="hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white sm:inline-flex" aria-label="Open public page">
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <Btn variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty || conflict} title="⌘S">
            <Save className="h-4 w-4" /> <span className="hidden sm:inline">{campaign ? 'Save' : 'Create draft'}</span>
          </Btn>
        </div>
        <nav className="-mb-px flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none]" aria-label="Sections">
          {SECTIONS.filter((s) => s.id !== 'content' || draft.template !== 'spotlight' || draft.cta.action === 'start_circle').map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn(
                'whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition',
                activeSection === s.id ? 'bg-purple-500/20 text-purple-200' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              )}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </div>

      {conflict && (
        <Callout tone="warn" className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span>This campaign was changed elsewhere since you opened it. Reload to get the latest version (your unsaved edits here will be discarded).</span>
          <Btn size="sm" onClick={() => void reloadAfterConflict()}>
            <RotateCcw className="h-3.5 w-3.5" /> Reload
          </Btn>
        </Callout>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <BasicsSection api={api} />
          <DatesSection api={api} />
          {(draft.template !== 'spotlight' || draft.cta.action === 'start_circle') && <ContentSection api={api} />}
          <CreativeSection api={api} />
          <MessagesSection api={api} />
          <EngageMessagesSection api={api} />
          <ChannelsSection api={api} />
          <PreviewSection api={api} />
          <GoLiveSection api={api} />
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-[9.5rem] space-y-4">
            <LivePreview api={api} cardUrl={card.url} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function LivePreview({ api, cardUrl }: { api: EditorApi; cardUrl: string }) {
  const [tab, setTab] = useState<'home' | 'calendar' | 'appstore'>('home');
  const tabs = [
    { id: 'home' as const, label: 'Home' },
    ...(api.draft.template === 'daily_calendar' ? [{ id: 'calendar' as const, label: 'Calendar' }] : []),
    { id: 'appstore' as const, label: 'App Store' },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'home';
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live preview</p>
        <div className="flex gap-0.5 rounded-lg bg-slate-950/60 p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn('rounded-md px-2 py-1 text-[11px] font-medium', current === t.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3">
        <DateScrubber api={api} compact />
      </div>
      <div className="max-h-[calc(100vh-17rem)] overflow-y-auto [scrollbar-width:none]">
        {current === 'home' && <HomeMock view={api.previewView} />}
        {current === 'calendar' && <CalendarMock view={api.previewView} />}
        {current === 'appstore' && <AppStoreCardMock art={cardUrl} appStore={api.draft.appStore} view={api.previewView} />}
      </div>
    </div>
  );
}
