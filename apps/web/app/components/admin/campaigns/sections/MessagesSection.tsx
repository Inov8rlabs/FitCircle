'use client';

import { Bell, ChevronDown, Mail, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { campaignsAdmin, CampaignApiError } from '@/lib/campaigns/admin-client';
import { PLACEHOLDERS, addDays, placeholderContext, renderPlaceholders, shortDate, uniqueKey } from '@/lib/campaigns/campaign-utils';
import type { CampaignEmail, CampaignNotification } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

import { EmailPreviewMock, PushBannerMock } from '../DeviceMocks';
import type { EditorApi } from '../editor-api';
import { Btn, Section, SelectField, TextAreaField, TextField, Toggle } from '../fields';

type Kind = CampaignNotification['kind'];

const KIND_LABEL: Record<Kind, string> = { launch: 'Launch day', daily: 'Every live day', last_day: 'Last day', custom: 'Custom date' };
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00 local` }));

function whenLabel(kind: Kind, sendOn: string | null | undefined, startsAt: string, endsAt: string): string {
  if (kind === 'launch') return shortDate(startsAt);
  if (kind === 'last_day') return shortDate(endsAt);
  if (kind === 'daily') return `${shortDate(startsAt)} – ${shortDate(endsAt)}`;
  return sendOn ? shortDate(sendOn) : 'pick a date';
}

export function MessagesSection({ api }: { api: EditorApi }) {
  const { draft, update, previewView } = api;
  const ctx = placeholderContext(previewView);
  const render = (s: string) => renderPlaceholders(s, ctx);
  const daily = draft.template === 'daily_calendar';

  const addPush = (kind: Kind) => {
    const isDaily = kind === 'daily';
    const n: CampaignNotification = {
      key: uniqueKey(kind, draft.notifications),
      kind,
      sendOn: kind === 'custom' ? addDays(draft.startsAt, 7) : null,
      localHour: 8,
      title: kind === 'launch' ? `${draft.title || '{{title}}'} starts today ${draft.emoji}` : isDaily && daily ? 'Door {{day}} is open {{door_emoji}}' : kind === 'last_day' ? 'Last day of {{title}}!' : '',
      body: kind === 'launch' ? 'Check in with your crew today.' : isDaily && daily ? '{{door_title}}: check in today to open it.' : kind === 'last_day' ? 'Finish strong: check in one more time.' : '',
      audience: isDaily ? (daily ? 'reminders' : 'participants') : 'all',
      enabled: true,
    };
    update({ notifications: [...draft.notifications, n] });
  };
  const addEmail = (kind: Kind) => {
    const e: CampaignEmail = {
      key: uniqueKey(`email_${kind}`, draft.emails),
      kind,
      sendOn: kind === 'custom' ? addDays(draft.startsAt, -3) : null,
      localHour: 9,
      subject: kind === 'launch' ? `${draft.title || '{{title}}'} starts today ${draft.emoji}` : '',
      preheader: draft.tagline,
      heading: kind === 'launch' ? 'It starts today, {{first_name}}' : '',
      body: kind === 'launch' ? `${draft.description}\n\nOpen FitCircle and check in to get going.` : '',
      ctaLabel: draft.ctaLabel || 'Open FitCircle',
      audience: 'all',
      enabled: true,
    };
    update({ emails: [...draft.emails, e] });
  };

  return (
    <Section id="messages" index={5} title="Messages" description="Push and email sent by the hourly cron in each recipient's local time.">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/40 p-2.5 text-xs">
        <span className="mr-1 text-slate-400">Placeholders:</span>
        {PLACEHOLDERS.filter((p) => daily || !p.dailyOnly).map((p) => (
          <button
            key={p.token}
            type="button"
            title={`${p.help} · click to copy`}
            onClick={() => void navigator.clipboard?.writeText(p.token).then(() => toast.success(`Copied ${p.token}`))}
            className="rounded-md bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-purple-200 hover:bg-slate-700"
          >
            {p.token}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <Bell className="h-4 w-4 text-purple-300" /> Push ({draft.notifications.filter((n) => n.enabled).length} on)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(['launch', 'daily', 'last_day', 'custom'] as Kind[]).map((k) => (
              <Btn key={k} size="sm" variant="ghost" onClick={() => addPush(k)}>
                <Plus className="h-3.5 w-3.5" /> {KIND_LABEL[k]}
              </Btn>
            ))}
          </div>
        </div>
        {draft.notifications.length === 0 && <p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-sm text-slate-500">No push messages yet.</p>}
        {draft.notifications.map((n, i) => (
          <MessageCard
            key={i}
            icon={<Bell className="h-4 w-4" />}
            title={render(n.title) || 'Untitled push'}
            meta={`${KIND_LABEL[n.kind]} · ${whenLabel(n.kind, n.sendOn, draft.startsAt, draft.endsAt)} · ${String(n.localHour).padStart(2, '0')}:00 · ${n.audience}`}
            enabled={n.enabled}
            onToggle={(enabled) => update({ notifications: draft.notifications.map((x, j) => (j === i ? { ...x, enabled } : x)) })}
            onDelete={() => update({ notifications: draft.notifications.filter((_, j) => j !== i) })}
            onTest={() => sendTest(api, 'push', n.key)}
          >
            <PushFields n={n} daily={daily} onChange={(patch) => update({ notifications: draft.notifications.map((x, j) => (j === i ? { ...x, ...patch } : x)) })} />
            <PushBannerMock title={render(n.title)} body={render(n.body)} />
          </MessageCard>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <Mail className="h-4 w-4 text-pink-300" /> Email ({draft.emails.filter((n) => n.enabled).length} on)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(['launch', 'last_day', 'custom'] as Kind[]).map((k) => (
              <Btn key={k} size="sm" variant="ghost" onClick={() => addEmail(k)}>
                <Plus className="h-3.5 w-3.5" /> {KIND_LABEL[k]}
              </Btn>
            ))}
          </div>
        </div>
        {draft.emails.length === 0 && <p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-sm text-slate-500">No emails yet. Marketing consent and unsubscribe links are handled for you.</p>}
        {draft.emails.map((e, i) => (
          <MessageCard
            key={i}
            icon={<Mail className="h-4 w-4" />}
            title={render(e.subject) || 'Untitled email'}
            meta={`${KIND_LABEL[e.kind]} · ${whenLabel(e.kind, e.sendOn, draft.startsAt, draft.endsAt)} · ${String(e.localHour).padStart(2, '0')}:00 · ${e.audience}`}
            enabled={e.enabled}
            onToggle={(enabled) => update({ emails: draft.emails.map((x, j) => (j === i ? { ...x, enabled } : x)) })}
            onDelete={() => update({ emails: draft.emails.filter((_, j) => j !== i) })}
            onTest={() => sendTest(api, 'email', e.key)}
          >
            <EmailFields e={e} onChange={(patch) => update({ emails: draft.emails.map((x, j) => (j === i ? { ...x, ...patch } : x)) })} />
            <EmailPreviewMock email={e} view={previewView} headerArt={api.artFor('emailHeader').url} render={render} />
          </MessageCard>
        ))}
      </div>
    </Section>
  );
}

async function sendTest(api: EditorApi, channel: 'push' | 'email', key: string) {
  const c = await api.ensureSaved();
  if (!c) return;
  try {
    if (channel === 'push') await campaignsAdmin.testPush(c.id, key);
    else await campaignsAdmin.testEmail(c.id, key);
    toast.success(channel === 'push' ? 'Test push sent to your devices' : 'Test email sent to you');
  } catch (e) {
    toast.error(e instanceof CampaignApiError ? e.message : 'Could not send the test');
  }
}

function MessageCard({
  icon,
  title,
  meta,
  enabled,
  onToggle,
  onDelete,
  onTest,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  onDelete: () => void;
  onTest: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!title || title.startsWith('Untitled'));
  const [testing, setTesting] = useState(false);
  return (
    <div className={cn('rounded-xl border bg-slate-950/40', enabled ? 'border-slate-800' : 'border-slate-800/60 opacity-70')}>
      <div className="flex items-center gap-3 p-3">
        <span className="text-slate-400">{icon}</span>
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-medium text-white">{title}</p>
          <p className="truncate text-xs text-slate-500">{meta}</p>
        </button>
        <Btn
          size="sm"
          variant="ghost"
          loading={testing}
          onClick={async () => {
            setTesting(true);
            await onTest();
            setTesting(false);
          }}
        >
          <Send className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Send test to me</span>
        </Btn>
        <Toggle checked={enabled} onChange={onToggle} label="Enabled" />
        <button type="button" onClick={() => setOpen(!open)} className="p-1 text-slate-400" aria-label={open ? 'Collapse' : 'Expand'}>
          <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="grid gap-4 border-t border-slate-800 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {children}
          <div className="lg:col-span-2">
            <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 text-xs text-rose-300/80 hover:text-rose-300">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleFields({ kind, sendOn, localHour, onChange }: { kind: Kind; sendOn?: string | null; localHour: number; onChange: (p: { kind?: Kind; sendOn?: string | null; localHour?: number }) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <SelectField label="When" value={kind} options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={(k) => onChange({ kind: k, sendOn: k === 'custom' ? sendOn ?? null : null })} />
      <SelectField label="Local time" value={localHour} options={HOURS} onChange={(h) => onChange({ localHour: h })} />
      {kind === 'custom' && <TextField label="Send on" type="date" value={sendOn ?? ''} onChange={(v) => onChange({ sendOn: v || null })} fieldClassName="col-span-2" />}
    </div>
  );
}

function PushFields({ n, daily, onChange }: { n: CampaignNotification; daily: boolean; onChange: (p: Partial<CampaignNotification>) => void }) {
  return (
    <div className="space-y-3">
      <ScheduleFields kind={n.kind} sendOn={n.sendOn} localHour={n.localHour} onChange={onChange} />
      <SelectField
        label="Audience"
        value={n.audience}
        options={[
          { value: 'all', label: 'Everyone with push' },
          { value: 'participants', label: 'Joined' },
          { value: 'reminders', label: 'Joined + reminders on' },
        ]}
        hint={daily && n.kind === 'daily' ? "Daily reminders skip people who already opened today's door" : undefined}
        onChange={(audience) => onChange({ audience })}
      />
      <TextField label="Title" value={n.title} max={60} onChange={(title) => onChange({ title })} />
      <TextAreaField label="Body" value={n.body} max={140} rows={2} onChange={(body) => onChange({ body })} />
      <TextField label="Key" value={n.key} hint="Dedupe key; don't change after it has sent" onChange={(key) => onChange({ key: key.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })} className="font-mono text-xs" />
    </div>
  );
}

function EmailFields({ e, onChange }: { e: CampaignEmail; onChange: (p: Partial<CampaignEmail>) => void }) {
  return (
    <div className="space-y-3">
      <ScheduleFields kind={e.kind} sendOn={e.sendOn} localHour={e.localHour} onChange={onChange} />
      <SelectField
        label="Audience"
        value={e.audience}
        options={[
          { value: 'all', label: 'Everyone (marketing opt-in)' },
          { value: 'participants', label: 'Joined' },
        ]}
        onChange={(audience) => onChange({ audience })}
      />
      <TextField label="Subject" value={e.subject} max={80} onChange={(subject) => onChange({ subject })} />
      <TextField label="Preheader" value={e.preheader} max={100} onChange={(preheader) => onChange({ preheader })} />
      <TextField label="Heading" value={e.heading} max={60} onChange={(heading) => onChange({ heading })} />
      <TextAreaField label="Body" value={e.body} max={600} rows={6} hint="Plain text · blank line = new paragraph" onChange={(body) => onChange({ body })} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Button" value={e.ctaLabel} max={24} onChange={(ctaLabel) => onChange({ ctaLabel })} />
        <TextField label="Key" value={e.key} onChange={(key) => onChange({ key: key.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })} className="font-mono text-xs" />
      </div>
    </div>
  );
}
