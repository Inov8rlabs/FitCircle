'use client';

import { Archive, CheckCircle2, Circle, CircleAlert, Rocket, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { campaignsAdmin, CampaignApiError } from '@/lib/campaigns/admin-client';
import { dateRange, publishChecklist, shortDate } from '@/lib/campaigns/campaign-utils';
import { cn } from '@/lib/utils';

import type { EditorApi } from '../editor-api';
import { Btn, Callout, Section, StatusPill } from '../fields';

export function GoLiveSection({ api }: { api: EditorApi }) {
  const router = useRouter();
  const { draft, campaign, dirty } = api;
  const items = publishChecklist({ ...draft, art: campaign?.art ?? {} });
  const blocking = items.filter((i) => i.blocking && !i.ok);
  const [busy, setBusy] = useState<'publish' | 'unpublish' | 'archive' | null>(null);
  const status = campaign?.status ?? 'new';

  const publish = async () => {
    const c = await api.ensureSaved();
    if (!c) return;
    setBusy('publish');
    try {
      const updated = await campaignsAdmin.publish(c.id);
      if (updated && 'id' in updated) api.applyServer(updated);
      else await api.refreshServer();
      analytics.track(AnalyticsEvents.campaignPublished({ campaign: c.slug, template: c.template }));
      toast.success(`${draft.title} is published 🚀`);
    } catch (e) {
      const details = e instanceof CampaignApiError ? e.details : null;
      const m: unknown = details?.missing;
      const missing = Array.isArray(m) ? ` Missing: ${m.map(String).join(', ')}` : '';
      toast.error(`${e instanceof CampaignApiError ? e.message : 'Publish failed'}${missing}`);
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    if (!campaign) return;
    if (!window.confirm('Unpublish? The campaign disappears from the apps right away.')) return;
    setBusy('unpublish');
    try {
      const updated = await campaignsAdmin.unpublish(campaign.id);
      if (updated && 'id' in updated) api.applyServer(updated);
      else await api.refreshServer();
      toast.success('Unpublished');
    } catch (e) {
      toast.error(e instanceof CampaignApiError ? e.message : 'Unpublish failed');
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    if (!campaign) return;
    if (!window.confirm(`Archive “${draft.title}”? It will be hidden everywhere.`)) return;
    setBusy('archive');
    try {
      await campaignsAdmin.archive(campaign.id);
      toast.success('Archived');
      router.push('/admin/campaigns');
    } catch (e) {
      toast.error(e instanceof CampaignApiError ? e.message : 'Archive failed');
      setBusy(null);
    }
  };

  return (
    <Section id="golive" index={9} title="Go live" description="Publish when the checklist is green.">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <StatusPill status={status} />
        <p className="text-sm text-slate-300">
          {campaign?.published
            ? `Published${campaign.publishedAt ? ` ${new Date(campaign.publishedAt).toLocaleDateString()}` : ''} · teaser from ${shortDate(draft.featuredFrom)}, live ${dateRange(draft.startsAt, draft.endsAt)}`
            : 'Not published. Only admins previewing on their phone can see it.'}
        </p>
      </div>

      <ul className="grid gap-1.5 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.section}`} className="flex items-start gap-2.5 rounded-lg p-2 hover:bg-slate-800/50">
              {i.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : i.blocking ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              )}
              <span>
                <span className={cn('block text-sm', i.ok ? 'text-slate-300' : 'text-white')}>{i.label}</span>
                {!i.ok && i.hint && <span className="block text-xs text-slate-500">{i.hint}</span>}
                {!i.ok && !i.blocking && !i.hint && <span className="block text-xs text-slate-500">Recommended</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>

      {blocking.length > 0 && <Callout tone="error">{blocking.length} required {blocking.length === 1 ? 'item' : 'items'} left before you can publish.</Callout>}
      {dirty && blocking.length === 0 && <Callout tone="info">Unsaved changes will be saved before publishing.</Callout>}

      <div className="flex flex-wrap gap-2">
        {campaign?.published ? (
          <Btn variant="danger" onClick={() => void unpublish()} loading={busy === 'unpublish'}>
            <Undo2 className="h-4 w-4" /> Unpublish
          </Btn>
        ) : (
          <Btn variant="primary" onClick={() => void publish()} loading={busy === 'publish'} disabled={blocking.length > 0}>
            <Rocket className="h-4 w-4" /> Publish
          </Btn>
        )}
        {campaign?.published && dirty && (
          <Btn variant="success" onClick={() => void api.ensureSaved().then((c) => c && toast.success('Live campaign updated'))}>
            Save changes to the live campaign
          </Btn>
        )}
        {campaign && status !== 'archived' && (
          <Btn variant="ghost" onClick={() => void archive()} loading={busy === 'archive'} className="ml-auto">
            <Archive className="h-4 w-4" /> Archive
          </Btn>
        )}
      </div>
    </Section>
  );
}
