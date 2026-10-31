'use client';

import {
  ArrowLeft,
  BarChart3,
  Bell,
  CheckCircle2,
  Circle,
  CircleAlert,
  Copy,
  Loader2,
  Pause,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Save,
  Send,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ContentCardView, InAppMessageView } from '@/components/engage/layouts';
import { EngageApiError, engageAdmin, type Estimate } from '@/lib/engage/client/admin-client';
import { assetStore, useAssetStoreVersion } from '@/lib/engage/client/asset-store';
import { messageChecklist } from '@/lib/engage/preview/checklist';
import {
  CARD_LAYOUTS,
  CHANNEL_LABEL,
  IAM_LAYOUTS,
  LAYOUT_LABEL,
  PLACEMENTS,
  PLACEMENT_DEFAULT_LAYOUT,
  PLACEMENT_LABEL,
  PLATFORM_LABEL,
  PLATFORMS,
  assetToRef,
  defaultContentFor,
  effectivePlatforms,
  evenWeights,
  newMessageInput,
  nextVariantId,
  rebalance,
  resolveTheme,
  validateWeights,
} from '@/lib/engage/preview/content';
import type {
  AppEventName,
  AssetRef,
  CardLayout,
  EmailContent,
  EngageChannel,
  EngageLayout,
  EngageMessage,
  EngagePlatform,
  EngageSegment,
  InAppLayout,
  MessageContent,
  MessageInput,
  MessageVariant,
  PushContent,
  RenderedContent,
  TriggerFilter,
} from '@/lib/engage/types';
import { PLACEMENT_MAX } from '@/lib/engage/types';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

import { FilterBuilder } from '../FilterBuilder';
import { MessageAnalytics } from '../messages/MessageAnalytics';
import { PreviewPane } from '../preview/PreviewPane';
import { Btn, Callout, Card, Field, PlatformIcon, PlatformSelector, SegmentedControl, StatusPill, Toggle, inputCls, num } from '../ui';

import { useCampaignOptions } from './ActionPicker';
import { CardContentEditor, EditTargetBar, EmailContentEditor, PushContentEditor, type EditTarget } from './ContentEditor';

export const APP_EVENTS: readonly { value: AppEventName; label: string; props?: string[] }[] = [
  { value: 'app_open', label: 'App opened' },
  { value: 'screen_view', label: 'Screen viewed', props: ['screen'] },
  { value: 'check_in_completed', label: 'Check-in completed', props: ['streak'] },
  { value: 'streak_milestone', label: 'Streak milestone', props: ['days'] },
  { value: 'circle_created', label: 'Circle created' },
  { value: 'circle_joined', label: 'Circle joined' },
  { value: 'invite_sent', label: 'Invite sent', props: ['count'] },
  { value: 'subscription_started', label: 'Subscription started' },
  { value: 'door_opened', label: 'Calendar door opened', props: ['campaign', 'day'] },
  { value: 'workout_logged', label: 'Workout logged' },
  { value: 'meal_logged', label: 'Meal logged' },
];

const STEPS = [
  { id: 'setup', label: 'Setup' },
  { id: 'layout', label: 'Layout' },
  { id: 'content', label: 'Content' },
  { id: 'variants', label: 'Variants' },
  { id: 'audience', label: 'Audience' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'goal', label: 'Goal' },
  { id: 'review', label: 'Review' },
] as const;

function toInput(m: EngageMessage | MessageInput): MessageInput {
  const keys: (keyof MessageInput)[] = [
    'name', 'campaignId', 'channel', 'placement', 'layout', 'variants', 'controlWeight', 'segmentId', 'audienceFilters', 'platforms', 'startsAt', 'endsAt',
    'sendMode', 'sendAt', 'localHour', 'trigger', 'maxImpressionsPerUser', 'minHoursBetween', 'priority', 'respectGlobalCap', 'conversion',
  ];
  const out = {} as Record<string, unknown>;
  for (const k of keys) out[k] = (m as unknown as Record<string, unknown>)[k] ?? null;
  const base = newMessageInput((m as MessageInput).channel);
  return { ...base, ...(out as Partial<MessageInput>), variants: (m as MessageInput).variants ?? base.variants, audienceFilters: (m as MessageInput).audienceFilters ?? [], platforms: (m as MessageInput).platforms ?? [] } as MessageInput;
}

const isoToLocal = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localToIso = (v: string) => (v ? new Date(v).toISOString() : null);

export function MessageComposer({ id, initialChannel, campaignId, initialTab, initialPlatform }: { id: string | null; initialChannel?: EngageChannel; campaignId?: string | null; initialTab?: 'compose' | 'analytics'; initialPlatform?: EngagePlatform }) {
  const router = useRouter();
  const [message, setMessage] = useState<EngageMessage | null>(null);
  const [draft, setDraft] = useState<MessageInput>(() => ({ ...newMessageInput(initialChannel ?? 'content_card'), campaignId: campaignId ?? null }));
  const [baseline, setBaseline] = useState(() => JSON.stringify({ ...newMessageInput(initialChannel ?? 'content_card'), campaignId: campaignId ?? null }));
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(id ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState<'compose' | 'analytics'>(initialTab ?? 'compose');
  const [variantIdx, setVariantIdx] = useState(0);
  const [target, setTarget] = useState<EditTarget>('all');
  const [platform, setPlatform] = useState<EngagePlatform>(initialPlatform ?? 'ios');
  const [textScale, setTextScale] = useState(1);
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [active, setActive] = useState<string>('setup');
  const savePromise = useRef<Promise<EngageMessage | null> | null>(null);
  useAssetStoreVersion();

  const dirty = JSON.stringify(draft) !== baseline;
  const update = (patch: Partial<MessageInput>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    void assetStore.ensureLoaded().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    engageAdmin
      .getMessage(id)
      .then((m) => {
        if (!alive) return;
        setMessage(m);
        const input = toInput(m);
        setDraft(input);
        setBaseline(JSON.stringify(input));
        setLoadState('ready');
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e instanceof EngageApiError ? (e.status === 404 ? 'Message not found.' : e.message) : 'Could not load the message.');
        setLoadState('error');
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // If the preview platform isn't reached, switch to one that is.
  const { reach, warnings } = effectivePlatforms(draft.channel, draft.platforms);
  useEffect(() => {
    if (reach.length && !reach.includes(platform)) setPlatform(reach[0]);
  }, [reach, platform]);

  const save = useCallback(async (): Promise<EngageMessage | null> => {
    if (savePromise.current) return savePromise.current;
    const run = (async () => {
      setSaving(true);
      const body = draft;
      const json = JSON.stringify(body);
      try {
        const saved = message ? await engageAdmin.updateMessage(message.id, body, message.version) : await engageAdmin.createMessage(body);
        setMessage(saved);
        setBaseline(json);
        setConflict(false);
        if (!message) router.replace(`/admin/messages/${saved.id}`);
        return saved;
      } catch (e) {
        if (e instanceof EngageApiError && e.code === 'VERSION_CONFLICT') {
          setConflict(true);
          toast.error('Someone else saved this message. Reload to continue.');
        } else toast.error(e instanceof EngageApiError ? e.message : 'Save failed');
        return null;
      } finally {
        setSaving(false);
        savePromise.current = null;
      }
    })();
    savePromise.current = run;
    return run;
  }, [draft, message, router]);

  const ensureSaved = useCallback(async () => (message && !dirty ? message : save()), [message, dirty, save]);

  const act = async (kind: 'launch' | 'pause' | 'resume' | 'duplicate') => {
    const m = await ensureSaved();
    if (!m) return;
    setBusy(kind);
    try {
      const r = await engageAdmin.action(m.id, kind);
      if (kind === 'duplicate') {
        toast.success('Duplicated as a draft');
        router.push(`/admin/messages/${r.id}`);
        return;
      }
      setMessage(r);
      toast.success(kind === 'launch' ? 'Launched 🚀' : kind === 'pause' ? 'Paused' : 'Resumed');
    } catch (e) {
      const issues = e instanceof EngageApiError && Array.isArray(e.details?.issues) ? ` ${(e.details.issues as unknown[]).map(String).join(' · ')}` : '';
      toast.error(`${e instanceof EngageApiError ? e.message : `${kind} failed`}${issues}`);
    } finally {
      setBusy(null);
    }
  };

  const reload = async () => {
    if (!message) return;
    const m = await engageAdmin.getMessage(message.id);
    setMessage(m);
    const input = toInput(m);
    setDraft(input);
    setBaseline(JSON.stringify(input));
    setConflict(false);
  };

  // ⌘S + unsaved-changes guard
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

  // Scroll-spy
  useEffect(() => {
    if (loadState !== 'ready' || tab !== 'compose') return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-130px 0px -60% 0px' }
    );
    STEPS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [loadState, tab]);

  const variant = draft.variants[Math.min(variantIdx, draft.variants.length - 1)];
  const setVariant = (v: MessageVariant) => update({ variants: draft.variants.map((x, i) => (i === variantIdx ? v : x)) });

  const assets = useMemo(() => {
    const out: Record<string, AssetRef> = {};
    for (const a of assetStore.all()) out[a.id] = assetToRef(a);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetStore.all().length]);

  const deferred = useDeferredValue(draft);
  const previewVariant = deferred.variants[Math.min(variantIdx, deferred.variants.length - 1)] ?? deferred.variants[0];
  const checklist = useMemo(() => messageChecklist(draft), [draft]);
  const blocking = checklist.filter((c) => c.blocking && !c.ok);

  if (loadState === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (loadState === 'error') {
    return (
      <div className="py-24 text-center">
        <p className="text-lg font-semibold text-white">{loadError}</p>
        <Link href="/admin/messages" className="mt-3 inline-block text-sm text-purple-300 hover:underline">
          ← All messages
        </Link>
      </div>
    );
  }

  const status = message?.status ?? 'draft';
  const isCard = draft.channel === 'content_card';
  const isIam = draft.channel === 'in_app';
  const visual = isCard || isIam;

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-slate-800/80 bg-[#070a17]/90 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 py-2.5">
          <Link href={`/admin/messages?channel=${draft.channel}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <input
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder={`Untitled ${CHANNEL_LABEL[draft.channel].toLowerCase()}`}
              className="w-full max-w-md truncate bg-transparent text-base font-semibold text-white placeholder:text-slate-500 focus:outline-none"
              aria-label="Message name"
            />
            <p className="flex items-center gap-2 text-xs text-slate-500">
              {CHANNEL_LABEL[draft.channel]}
              {isCard && draft.placement ? ` · ${PLACEMENT_LABEL[draft.placement]}` : ''}
              {draft.layout ? ` · ${LAYOUT_LABEL[draft.layout]}` : ''}
              <span>{saving ? '· Saving…' : dirty ? '· Unsaved' : message ? '· Saved' : ''}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-2.5 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Launching to</span>
            <PlatformSelector value={draft.platforms} onChange={(platforms) => update({ platforms })} disabled={draft.channel === 'push' ? ['web'] : []} size="sm" />
          </div>
          <StatusPill status={status} />
          {message && (
            <SegmentedControl
              value={tab}
              onChange={setTab}
              options={[
                { value: 'compose', label: 'Compose' },
                { value: 'analytics', label: <span className="inline-flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5" /> Analytics</span> },
              ]}
            />
          )}
          <Btn variant="secondary" onClick={() => void save()} loading={saving} disabled={!dirty || conflict} title="⌘S">
            <Save className="h-4 w-4" /> <span className="hidden sm:inline">{message ? 'Save' : 'Save draft'}</span>
          </Btn>
          {status === 'live' || status === 'scheduled' ? (
            <Btn variant="danger" onClick={() => void act('pause')} loading={busy === 'pause'}>
              <Pause className="h-4 w-4" /> Pause
            </Btn>
          ) : status === 'paused' ? (
            <Btn variant="success" onClick={() => void act('resume')} loading={busy === 'resume'}>
              <Play className="h-4 w-4" /> Resume
            </Btn>
          ) : (
            <Btn variant="primary" onClick={() => void act('launch')} loading={busy === 'launch'} disabled={blocking.length > 0} title={blocking[0]?.label}>
              <Rocket className="h-4 w-4" /> Launch
            </Btn>
          )}
        </div>
        {tab === 'compose' && (
          <nav className="-mb-px flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none]" aria-label="Steps">
            {STEPS.filter((s) => s.id !== 'layout' || visual).map((s, i) => (
              <a key={s.id} href={`#${s.id}`} className={cn('whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition', active === s.id ? 'bg-purple-500/20 text-purple-200' : 'text-slate-400 hover:bg-slate-800 hover:text-white')}>
                <span className="mr-1 text-slate-500">{i + 1}</span>
                {s.label}
              </a>
            ))}
          </nav>
        )}
      </div>

      {conflict && (
        <Callout tone="warn" className="mt-4 flex items-center justify-between gap-2">
          <span>This message changed elsewhere. Reload to get the latest version (your unsaved edits are discarded).</span>
          <Btn size="sm" onClick={() => void reload()}>
            <RotateCcw className="h-3.5 w-3.5" /> Reload
          </Btn>
        </Callout>
      )}
      {warnings.length > 0 && <Callout tone="warn" className="mt-4">{warnings.join(' ')}</Callout>}

      {tab === 'analytics' && message ? (
        <div className="mt-6">
          <MessageAnalytics message={message} />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            <SetupSection draft={draft} update={update} isNew={!message} />
            {visual && <LayoutSection draft={draft} update={update} />}

            <StepCard id="content" n={visual ? 3 : 2} title="Content" description="Personalise with {{first_name}}, {{streak}}, {{circle_name}}, {{days_left}}.">
              <VariantTabs draft={draft} idx={variantIdx} setIdx={setVariantIdx} />
              <EditTargetBar target={target} onChange={setTarget} overrides={variant.platformOverrides as never} />
              {visual && (
                <CardContentEditor variant={variant as MessageVariant<MessageContent>} onChange={setVariant as never} target={target} isCard={isCard} layout={draft.layout} onLocalPreview={setLocalImage} />
              )}
              {draft.channel === 'push' && <PushContentEditor variant={variant as MessageVariant<PushContent>} onChange={setVariant as never} target={target} />}
              {draft.channel === 'email' && <EmailContentEditor variant={variant as MessageVariant<EmailContent>} onChange={setVariant as never} target={target} onLocalPreview={setLocalImage} />}
            </StepCard>

            <VariantsSection draft={draft} update={update} n={visual ? 4 : 3} onSelect={setVariantIdx} />
            <AudienceSection draft={draft} update={update} n={visual ? 5 : 4} />
            <DeliverySection draft={draft} update={update} n={visual ? 6 : 5} />
            <GoalSection draft={draft} update={update} n={visual ? 7 : 6} />
            <ReviewSection
              n={visual ? 8 : 7}
              draft={draft}
              message={message}
              checklist={checklist}
              ensureSaved={ensureSaved}
              act={act}
              busy={busy}
              variantId={variant.id}
              platform={platform}
            />
          </div>

          <aside className="hidden xl:block">
            <div className="sticky top-[8.5rem] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live preview</p>
                <SegmentedControl
                  size="sm"
                  value={platform}
                  onChange={setPlatform}
                  options={PLATFORMS.map((p) => ({ value: p, label: <span className="inline-flex items-center gap-1"><PlatformIcon p={p} className="h-3 w-3" /> {PLATFORM_LABEL[p]}</span>, title: reach.includes(p) ? undefined : 'Not targeted' }))}
                />
              </div>
              <div className="flex items-center gap-3">
                {draft.variants.length > 1 && (
                  <SegmentedControl size="sm" value={String(variantIdx)} onChange={(v) => setVariantIdx(Number(v))} options={draft.variants.map((v, i) => ({ value: String(i), label: v.id }))} />
                )}
                {visual && (
                  <label className="ml-auto flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="text-[10px]">A</span>
                    <input type="range" min={0.85} max={1.5} step={0.05} value={textScale} onChange={(e) => setTextScale(Number(e.target.value))} className="w-24 accent-purple-500" aria-label="Text size" />
                    <span className="text-sm">A</span>
                  </label>
                )}
              </div>
              {!reach.includes(platform) && <p className="text-[11px] text-amber-300">{PLATFORM_LABEL[platform]} isn&apos;t targeted. Showing it anyway.</p>}
              <div className="max-h-[calc(100vh-13rem)] overflow-y-auto [scrollbar-width:none]">
                <PreviewPane message={deferred} variant={previewVariant} platform={platform} textScale={textScale} assets={assets} localImage={localImage} />
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function StepCard({ id, n, title, description, children, actions }: { id: string; n: number; title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-36 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-xs font-bold text-purple-200">{n}</span>
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-400">{description}</p>}
          </div>
        </div>
        {actions}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

type SectionProps = { draft: MessageInput; update: (p: Partial<MessageInput>) => void };

function SetupSection({ draft, update, isNew }: SectionProps & { isNew: boolean }) {
  const campaigns = useCampaignOptions();
  const switchChannel = (channel: EngageChannel) => {
    const fresh = newMessageInput(channel);
    update({
      channel,
      placement: fresh.placement,
      layout: fresh.layout,
      variants: draft.variants.map((v) => ({ ...v, content: defaultContentFor(channel), platformOverrides: undefined })),
      platforms: channel === 'push' ? draft.platforms.filter((p) => p !== 'web') : draft.platforms,
      sendMode: fresh.sendMode,
      localHour: fresh.localHour,
      trigger: fresh.trigger,
      maxImpressionsPerUser: fresh.maxImpressionsPerUser,
      minHoursBetween: fresh.minHoursBetween,
    });
  };
  return (
    <StepCard id="setup" n={1} title="Setup" description="Channel and where it shows up.">
      <div className="grid gap-2 sm:grid-cols-4">
        {(['content_card', 'in_app', 'push', 'email'] as EngageChannel[]).map((c) => (
          <button
            key={c}
            type="button"
            disabled={!isNew && c !== draft.channel}
            onClick={() => switchChannel(c)}
            className={cn('rounded-xl border p-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40', draft.channel === c ? 'border-purple-400 bg-purple-500/10 text-white' : 'border-slate-800 text-slate-300 hover:border-slate-600')}
          >
            {CHANNEL_LABEL[c]}
          </button>
        ))}
      </div>
      {draft.channel === 'content_card' && (
        <Field label="Placement">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {PLACEMENTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => update({ placement: p, layout: draft.placement && draft.layout && draft.layout !== PLACEMENT_DEFAULT_LAYOUT[draft.placement] ? draft.layout : PLACEMENT_DEFAULT_LAYOUT[p] })}
                className={cn('rounded-xl border p-2.5 text-left transition', draft.placement === p ? 'border-purple-400 bg-purple-500/10' : 'border-slate-800 hover:border-slate-600')}
              >
                <p className="text-sm font-medium text-white">{PLACEMENT_LABEL[p]}</p>
                <p className="text-[11px] text-slate-500">
                  Max {PLACEMENT_MAX[p]} · {LAYOUT_LABEL[PLACEMENT_DEFAULT_LAYOUT[p]].toLowerCase()} recommended
                </p>
              </button>
            ))}
          </div>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Campaign (optional)">
          <select value={draft.campaignId ?? ''} onChange={(e) => update({ campaignId: e.target.value || null })} className={inputCls}>
            <option value="">None</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.title} · {c.status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority" hint="Higher wins when several messages compete for a slot">
          <input type="number" value={draft.priority} onChange={(e) => update({ priority: Number.parseInt(e.target.value || '0', 10) || 0 })} className={inputCls} />
        </Field>
      </div>
    </StepCard>
  );
}

const THUMB_CONTENT: RenderedContent = {
  image: { id: 'thumb', url: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><circle cx="80" cy="45" r="22" fill="none" stroke="white" stroke-opacity=".7" stroke-width="5"/></svg>'), variants: [], width: 1600, height: 900, dominantColor: '#a855f7', alt: null },
  imageAlt: null,
  title: 'Winter circle',
  body: 'Check in with your crew every day.',
  badge: 'New',
  buttons: [{ label: 'Join', action: { type: 'dismiss' }, style: 'primary' }],
  theme: resolveTheme({}),
  imageFit: 'cover',
  dismissible: false,
  pinned: false,
};

function LayoutSection({ draft, update }: SectionProps) {
  const layouts: readonly EngageLayout[] = draft.channel === 'in_app' ? IAM_LAYOUTS : CARD_LAYOUTS;
  const recommended = draft.channel === 'content_card' && draft.placement ? PLACEMENT_DEFAULT_LAYOUT[draft.placement] : null;
  return (
    <StepCard id="layout" n={2} title="Layout" description="The native component the apps render. Same spec on iOS, Android and web.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {layouts.map((l) => (
          <div
            key={l}
            role="button"
            tabIndex={0}
            aria-pressed={draft.layout === l}
            onClick={() => update({ layout: l })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                update({ layout: l });
              }
            }}
            className={cn('group cursor-pointer overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400', draft.layout === l ? 'border-purple-400 ring-2 ring-purple-500/30' : 'border-slate-800 hover:border-slate-600')}
          >
            <div className="pointer-events-none relative h-36 overflow-hidden bg-[#070a17] p-2" aria-hidden inert>
              {draft.channel === 'in_app' ? (
                <div className="relative h-full overflow-hidden rounded-lg bg-slate-900">
                  <InAppMessageView layout={l as InAppLayout} content={THUMB_CONTENT} platform="ios" textScale={0.42} contained />
                </div>
              ) : (
                <div className="origin-top-left scale-[0.5]" style={{ width: '200%' }}>
                  <ContentCardView layout={l as CardLayout} content={{ ...THUMB_CONTENT, buttons: l === 'banner' ? [] : THUMB_CONTENT.buttons }} platform="ios" textScale={1} />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-2.5 py-2">
              <span className="text-xs font-medium text-white">{LAYOUT_LABEL[l]}</span>
              {recommended === l && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">Recommended</span>}
            </div>
          </div>
        ))}
      </div>
    </StepCard>
  );
}

function VariantTabs({ draft, idx, setIdx }: { draft: MessageInput; idx: number; setIdx: (i: number) => void }) {
  if (draft.variants.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {draft.variants.map((v, i) => (
        <button key={v.id} type="button" onClick={() => setIdx(i)} className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold', i === idx ? 'bg-purple-500/20 text-white ring-1 ring-purple-400/50' : 'bg-slate-800/60 text-slate-400 hover:text-white')}>
          {v.id} · {v.name || `Variant ${v.id}`} <span className="ml-1 text-slate-500">{v.weight}%</span>
        </button>
      ))}
    </div>
  );
}

function VariantsSection({ draft, update, n, onSelect }: SectionProps & { n: number; onSelect: (i: number) => void }) {
  const check = validateWeights(draft.variants, draft.controlWeight);
  const setWeights = (w: number[]) => update({ variants: draft.variants.map((v, i) => ({ ...v, weight: w[i] })) });
  const add = () => {
    const id = nextVariantId(draft.variants);
    const src = draft.variants[draft.variants.length - 1];
    const variants = [...draft.variants, { ...src, id, name: `Variant ${id}`, content: JSON.parse(JSON.stringify(src.content)), platformOverrides: src.platformOverrides ? JSON.parse(JSON.stringify(src.platformOverrides)) : undefined }];
    const w = evenWeights(variants.length, draft.controlWeight);
    update({ variants: variants.map((v, i) => ({ ...v, weight: w[i] })) });
    onSelect(variants.length - 1);
  };
  const remove = (i: number) => {
    const variants = draft.variants.filter((_, j) => j !== i);
    const w = evenWeights(variants.length, draft.controlWeight);
    update({ variants: variants.map((v, k) => ({ ...v, weight: w[k] })) });
    onSelect(0);
  };
  const setControl = (c: number) => {
    const control = Math.max(0, Math.min(50, Math.round(c)));
    const w = evenWeights(draft.variants.length, control);
    update({ controlWeight: control, variants: draft.variants.map((v, i) => ({ ...v, weight: w[i] })) });
  };
  const total = draft.variants.reduce((s, v) => s + v.weight, 0) + draft.controlWeight;
  return (
    <StepCard
      id="variants"
      n={n}
      title="Variants"
      description="A/B test content. Users are bucketed deterministically; control sees nothing (measures lift)."
      actions={
        draft.variants.length < 5 && (
          <Btn size="sm" onClick={add}>
            <Plus className="h-3.5 w-3.5" /> Add variant
          </Btn>
        )
      }
    >
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
        {draft.variants.map((v, i) => (
          <div key={v.id} style={{ width: `${v.weight}%`, background: ['#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fbbf24'][i % 5] }} title={`${v.id} ${v.weight}%`} />
        ))}
        <div style={{ width: `${draft.controlWeight}%` }} className="bg-slate-600" title={`Control ${draft.controlWeight}%`} />
      </div>
      <div className="space-y-2">
        {draft.variants.map((v, i) => (
          <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-slate-950" style={{ background: ['#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fbbf24'][i % 5] }}>
              {v.id}
            </span>
            <input value={v.name} onChange={(e) => update({ variants: draft.variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className={cn(inputCls, 'h-8 w-40')} aria-label="Variant name" />
            <input
              type="range"
              min={0}
              max={100 - draft.controlWeight}
              value={v.weight}
              disabled={draft.variants.length === 1}
              onChange={(e) => setWeights(rebalance(draft.variants.map((x) => x.weight), i, Number(e.target.value), draft.controlWeight))}
              className="min-w-[8rem] flex-1 accent-purple-500"
              aria-label={`Weight ${v.id}`}
            />
            <span className="w-12 text-right text-sm font-semibold tabular-nums text-white">{v.weight}%</span>
            <Btn size="sm" variant="ghost" onClick={() => onSelect(i)}>
              Edit
            </Btn>
            {draft.variants.length > 1 && (
              <button type="button" onClick={() => remove(i)} className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-300" aria-label={`Remove variant ${v.id}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-700 p-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-700 text-[10px] font-bold text-white">CTL</span>
          <span className="w-40 text-sm text-slate-300">Control (holdout)</span>
          <input type="range" min={0} max={50} value={draft.controlWeight} onChange={(e) => setControl(Number(e.target.value))} className="min-w-[8rem] flex-1 accent-slate-400" aria-label="Control %" />
          <span className="w-12 text-right text-sm font-semibold tabular-nums text-white">{draft.controlWeight}%</span>
          <span className="w-[74px]" />
        </div>
      </div>
      <p className={cn('text-xs', check.ok ? 'text-slate-500' : 'text-rose-400')}>{check.ok ? `Total ${total}%` : check.errors[0]}</p>
    </StepCard>
  );
}

let segmentCache: Promise<EngageSegment[]> | null = null;
function useSegments(): EngageSegment[] {
  const [list, setList] = useState<EngageSegment[]>([]);
  useEffect(() => {
    segmentCache ??= engageAdmin.listSegments().catch(() => {
      segmentCache = null;
      return [];
    });
    let alive = true;
    void segmentCache.then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

/** Debounced live reach estimate, per platform when the server provides it. */
export function useReach(body: { filters: MessageInput['audienceFilters']; segmentId?: string | null; platforms?: EngagePlatform[] }, enabled = true) {
  const [est, setEst] = useState<Estimate | null>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      engageAdmin
        .estimate(JSON.parse(key) as typeof body)
        .then((r) => alive && setEst(r))
        .catch(() => alive && setEst(null))
        .finally(() => alive && setLoading(false));
    }, 450);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { est, loading };
}

export function ReachPanel({ est, loading, platforms }: { est: Estimate | null; loading: boolean; platforms: EngagePlatform[] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <Users className="h-3.5 w-3.5" /> Estimated reach
        </p>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums text-white">{est ? `${est.approximate ? '≈ ' : ''}${num(est.count)}` : '—'}</p>
      <p className="text-xs text-slate-500">users</p>
      {est?.byPlatform && (
        <div className="mt-3 space-y-1.5">
          {PLATFORMS.map((p) => {
            const v = est.byPlatform?.[p] ?? 0;
            const on = platforms.length === 0 || platforms.includes(p);
            const max = Math.max(1, ...PLATFORMS.map((x) => est.byPlatform?.[x] ?? 0));
            return (
              <div key={p} className={cn('flex items-center gap-2 text-xs', !on && 'opacity-40')}>
                <PlatformIcon p={p} className="h-3 w-3 text-slate-400" />
                <span className="w-14 text-slate-300">{PLATFORM_LABEL[p]}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-purple-400" style={{ width: `${(v / max) * 100}%` }} />
                </div>
                <span className="w-12 text-right tabular-nums text-slate-300">{num(v)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AudienceSection({ draft, update, n }: SectionProps & { n: number }) {
  const segments = useSegments();
  const { reach, warnings } = effectivePlatforms(draft.channel, draft.platforms);
  const { est, loading } = useReach({ filters: draft.audienceFilters, segmentId: draft.segmentId, platforms: reach });
  const seg = segments.find((s) => s.id === draft.segmentId);
  return (
    <StepCard id="audience" n={n} title="Audience" description="Segment AND inline filters AND platforms.">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-5">
          <Field label="Platforms">
            <PlatformSelector value={draft.platforms} onChange={(platforms) => update({ platforms })} disabled={draft.channel === 'push' ? ['web'] : []} />
            {warnings.map((w) => (
              <p key={w} className="mt-1.5 text-xs text-amber-300">
                {w}
              </p>
            ))}
            {draft.channel === 'in_app' && draft.platforms.includes('web') && <p className="mt-1.5 text-xs text-slate-500">On web, in-app messages render as overlays.</p>}
          </Field>
          <Field label="Segment" hint={seg?.description}>
            <select value={draft.segmentId ?? ''} onChange={(e) => update({ segmentId: e.target.value || null })} className={inputCls}>
              <option value="">Everyone</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.estimatedCount != null ? ` · ≈${num(s.estimatedCount)}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Extra filters">
            <FilterBuilder value={draft.audienceFilters} onChange={(audienceFilters) => update({ audienceFilters })} emptyLabel="No extra filters." />
          </Field>
        </div>
        <ReachPanel est={est} loading={loading} platforms={reach} />
      </div>
    </StepCard>
  );
}

function TriggerBuilder({ draft, update }: SectionProps) {
  const t = draft.trigger ?? { event: 'app_open' as AppEventName, filters: [], delaySeconds: 0 };
  const set = (p: Partial<typeof t>) => update({ trigger: { ...t, ...p } });
  const meta = APP_EVENTS.find((e) => e.value === t.event);
  const filters = t.filters ?? [];
  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Trigger (evaluated on device)</p>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
        When
        <select value={t.event} onChange={(e) => set({ event: e.target.value as AppEventName, filters: [] })} className={cn(inputCls, 'h-9 w-56 py-1.5')}>
          {APP_EVENTS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        then wait
        <input type="number" min={0} max={30} value={t.delaySeconds} onChange={(e) => set({ delaySeconds: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} className={cn(inputCls, 'h-9 w-20 py-1.5')} />
        s
      </div>
      {filters.map((f, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 pl-4 text-sm">
          <span className="text-xs text-slate-500">where</span>
          <select value={f.key} onChange={(e) => set({ filters: filters.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} className={cn(inputCls, 'h-8 w-32 py-1')}>
            {(meta?.props ?? [f.key]).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select value={f.op} onChange={(e) => set({ filters: filters.map((x, j) => (j === i ? { ...x, op: e.target.value as TriggerFilter['op'] } : x)) })} className={cn(inputCls, 'h-8 w-20 py-1')}>
            {(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const).map((o) => (
              <option key={o} value={o}>
                {{ eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' }[o]}
              </option>
            ))}
          </select>
          <input
            value={String(f.value)}
            onChange={(e) => set({ filters: filters.map((x, j) => (j === i ? { ...x, value: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value } : x)) })}
            className={cn(inputCls, 'h-8 w-32 py-1')}
          />
          <button type="button" onClick={() => set({ filters: filters.filter((_, j) => j !== i) })} className="text-slate-500 hover:text-rose-300" aria-label="Remove">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {meta?.props && (
        <Btn size="sm" variant="ghost" onClick={() => set({ filters: [...filters, { key: meta.props![0], op: meta.props![0] === 'screen' || meta.props![0] === 'campaign' ? 'eq' : 'gte', value: meta.props![0] === 'screen' ? 'home' : 1 }] })}>
          <Plus className="h-3.5 w-3.5" /> Property filter
        </Btn>
      )}
      <p className="text-[11px] text-slate-500">Never shown over onboarding, the paywall, a system sheet or the camera. Max 1 per session and 2 per 24 h unless global caps are off.</p>
    </div>
  );
}

function DeliverySection({ draft, update, n }: SectionProps & { n: number }) {
  const pe = draft.channel === 'push' || draft.channel === 'email';
  return (
    <StepCard id="delivery" n={n} title="Delivery" description="When it’s eligible and how often people see it.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts">
          <input type="datetime-local" value={isoToLocal(draft.startsAt)} onChange={(e) => update({ startsAt: localToIso(e.target.value) ?? draft.startsAt })} className={inputCls} />
        </Field>
        <Field label="Ends" hint="Empty = runs until paused">
          <input type="datetime-local" value={isoToLocal(draft.endsAt)} onChange={(e) => update({ endsAt: localToIso(e.target.value) })} className={inputCls} />
        </Field>
      </div>
      {draft.channel === 'in_app' && <TriggerBuilder draft={draft} update={update} />}
      {pe && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <SegmentedControl
            value={draft.sendMode ?? 'immediate'}
            onChange={(sendMode) => update({ sendMode, sendAt: sendMode === 'immediate' ? null : draft.sendAt ?? new Date(Date.now() + 86_400_000).toISOString() })}
            options={[
              { value: 'immediate', label: 'Send on launch' },
              { value: 'scheduled', label: 'At a time (UTC)' },
              { value: 'local_time', label: "In each user's local time" },
            ]}
          />
          {draft.sendMode === 'scheduled' && (
            <Field label="Send at">
              <input type="datetime-local" value={isoToLocal(draft.sendAt)} onChange={(e) => update({ sendAt: localToIso(e.target.value) })} className={cn(inputCls, 'w-64')} />
            </Field>
          )}
          {draft.sendMode === 'local_time' && (
            <div className="flex flex-wrap gap-3">
              <Field label="On">
                <input type="date" value={(draft.sendAt ?? '').slice(0, 10)} onChange={(e) => update({ sendAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })} className={cn(inputCls, 'w-44')} />
              </Field>
              <Field label="At (local)">
                <select value={draft.localHour ?? 9} onChange={(e) => update({ localHour: Number(e.target.value) })} className={cn(inputCls, 'w-36')}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {draft.channel === 'push' && <p className="text-[11px] text-slate-500">Respects each user&apos;s daily push cap and quiet hours (category: challenges).</p>}
        </div>
      )}
      {!pe && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Max impressions per user" hint="Empty = unlimited">
            <input type="number" min={1} value={draft.maxImpressionsPerUser ?? ''} onChange={(e) => update({ maxImpressionsPerUser: e.target.value ? Math.max(1, Number(e.target.value)) : null })} className={inputCls} />
          </Field>
          <Field label="Min hours between">
            <input type="number" min={0} value={draft.minHoursBetween ?? ''} onChange={(e) => update({ minHoursBetween: e.target.value ? Math.max(0, Number(e.target.value)) : null })} className={inputCls} />
          </Field>
          <Field label="Global caps">
            <label className="flex h-10 items-center gap-2 text-sm text-slate-300">
              <Toggle checked={draft.respectGlobalCap} onChange={(respectGlobalCap) => update({ respectGlobalCap })} label="Respect global caps" /> Respect global caps
            </label>
          </Field>
        </div>
      )}
    </StepCard>
  );
}

function GoalSection({ draft, update, n }: SectionProps & { n: number }) {
  const g = draft.conversion;
  return (
    <StepCard id="goal" n={n} title="Conversion goal" description="Counted when a user does this within the window after a click (or impression).">
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <Toggle checked={Boolean(g)} onChange={(on) => update({ conversion: on ? { event: 'check_in_completed', windowHours: 24, basis: 'click' } : null })} label="Track a conversion" /> Track a conversion
      </label>
      {g && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
          <select value={g.event} onChange={(e) => update({ conversion: { ...g, event: e.target.value as AppEventName } })} className={cn(inputCls, 'h-9 w-56 py-1.5')}>
            {APP_EVENTS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
          within
          <input type="number" min={1} max={168} value={g.windowHours} onChange={(e) => update({ conversion: { ...g, windowHours: Math.max(1, Math.min(168, Number(e.target.value) || 1)) } })} className={cn(inputCls, 'h-9 w-20 py-1.5')} />
          hours of a
          <SegmentedControl
            size="sm"
            value={g.basis}
            onChange={(basis) => update({ conversion: { ...g, basis } })}
            options={[
              { value: 'click', label: 'click' },
              { value: 'impression', label: 'impression' },
            ]}
          />
        </div>
      )}
    </StepCard>
  );
}

function ReviewSection({
  n,
  draft,
  message,
  checklist,
  ensureSaved,
  act,
  busy,
  variantId,
  platform,
}: {
  n: number;
  draft: MessageInput;
  message: EngageMessage | null;
  checklist: ReturnType<typeof messageChecklist>;
  ensureSaved: () => Promise<EngageMessage | null>;
  act: (k: 'launch' | 'pause' | 'resume' | 'duplicate') => Promise<void>;
  busy: string | null;
  variantId: string;
  platform: EngagePlatform;
}) {
  const userId = useAuthStore((s) => s.user?.id);
  const [onPhone, setOnPhone] = useState(Boolean(userId && message?.previewUserIds?.includes(userId)));
  const [testing, setTesting] = useState(false);
  const { reach } = effectivePlatforms(draft.channel, draft.platforms);
  const blocking = checklist.filter((c) => c.blocking && !c.ok);
  const status = message?.status ?? 'draft';

  const togglePhone = async () => {
    const m = await ensureSaved();
    if (!m) return;
    try {
      await engageAdmin.preview(m.id, !onPhone);
      setOnPhone(!onPhone);
      toast.success(!onPhone ? 'Shows on your devices on next app open' : 'Phone preview off');
    } catch (e) {
      toast.error(e instanceof EngageApiError ? e.message : 'Preview failed');
    }
  };
  const sendTest = async () => {
    const m = await ensureSaved();
    if (!m) return;
    setTesting(true);
    try {
      await engageAdmin.test(m.id, { variantId, platform });
      toast.success(draft.channel === 'push' ? 'Test push sent to your devices' : draft.channel === 'email' ? 'Test email sent to you' : 'You’ll see it on your next app open');
    } catch (e) {
      toast.error(e instanceof EngageApiError ? e.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <StepCard id="review" n={n} title="Review & launch">
      <Card className="flex flex-wrap items-center gap-3 bg-slate-950/50">
        <Rocket className="h-5 w-5 text-purple-300" />
        <p className="text-sm text-slate-300">
          Launching to{' '}
          <span className="font-semibold text-white">
            {reach.map((p) => PLATFORM_LABEL[p]).join(' · ') || 'nobody'}
          </span>
          {draft.variants.length > 1 ? ` · ${draft.variants.length} variants` : ''}
          {draft.controlWeight ? ` · ${draft.controlWeight}% control` : ''}
        </p>
        <span className="ml-auto flex gap-1">
          {reach.map((p) => (
            <span key={p} className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-500/15 text-purple-200">
              <PlatformIcon p={p} />
            </span>
          ))}
        </span>
      </Card>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {checklist.map((i) => (
          <li key={i.id}>
            <a href={`#${i.section}`} className="flex items-start gap-2.5 rounded-lg p-2 hover:bg-slate-800/50">
              {i.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : i.blocking ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
              <span>
                <span className={cn('block text-sm', i.ok ? 'text-slate-300' : 'text-white')}>{i.label}</span>
                {!i.ok && i.hint && <span className="block text-xs text-slate-500">{i.hint}</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {status === 'live' || status === 'scheduled' ? (
          <Btn variant="danger" onClick={() => void act('pause')} loading={busy === 'pause'}>
            <Pause className="h-4 w-4" /> Pause
          </Btn>
        ) : status === 'paused' ? (
          <Btn variant="success" onClick={() => void act('resume')} loading={busy === 'resume'}>
            <Play className="h-4 w-4" /> Resume
          </Btn>
        ) : (
          <Btn variant="primary" onClick={() => void act('launch')} loading={busy === 'launch'} disabled={blocking.length > 0}>
            <Rocket className="h-4 w-4" /> Launch
          </Btn>
        )}
        <Btn onClick={() => void sendTest()} loading={testing}>
          {draft.channel === 'push' ? <Bell className="h-4 w-4" /> : <Send className="h-4 w-4" />} Send test to me
        </Btn>
        {(draft.channel === 'content_card' || draft.channel === 'in_app') && (
          <Btn variant={onPhone ? 'success' : 'secondary'} onClick={() => void togglePhone()}>
            <Smartphone className="h-4 w-4" /> {onPhone ? 'On my phone · turn off' : 'Preview on my phone'}
          </Btn>
        )}
        {message && (
          <Btn variant="ghost" onClick={() => void act('duplicate')} loading={busy === 'duplicate'} className="ml-auto">
            <Copy className="h-4 w-4" /> Duplicate
          </Btn>
        )}
      </div>
      {blocking.length > 0 && <p className="text-xs text-rose-400">{blocking.length} required item{blocking.length === 1 ? '' : 's'} left.</p>}
    </StepCard>
  );
}
