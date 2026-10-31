/**
 * Review & launch checklist for a message (ENGAGE_SPEC §12.8, §15).
 */

import type { EmailContent, MessageContent, MessageInput, PushContent } from '../types';

import { conditionValid } from './attributes';
import { CARD_LAYOUTS, CONTENT_LIMITS, IAM_LAYOUTS, applyPlatformOverride, effectivePlatforms, validateWeights } from './content';

export interface CheckItem {
  id: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  hint?: string;
  section: 'setup' | 'layout' | 'content' | 'variants' | 'audience' | 'delivery' | 'goal';
}

const len = (s: string | null | undefined) => (s ?? '').trim().length;

export function messageChecklist(m: MessageInput): CheckItem[] {
  const out: CheckItem[] = [];
  const add = (i: CheckItem) => out.push(i);
  add({ id: 'name', label: 'Internal name', ok: len(m.name) > 0, blocking: true, section: 'setup' });

  if (m.channel === 'content_card') {
    add({ id: 'placement', label: 'Placement chosen', ok: Boolean(m.placement), blocking: true, section: 'setup' });
    add({ id: 'layout', label: 'Card layout chosen', ok: Boolean(m.layout && (CARD_LAYOUTS as readonly string[]).includes(m.layout)), blocking: true, section: 'layout' });
  }
  if (m.channel === 'in_app') {
    add({ id: 'layout', label: 'In-app layout chosen', ok: Boolean(m.layout && (IAM_LAYOUTS as readonly string[]).includes(m.layout)), blocking: true, section: 'layout' });
    add({ id: 'trigger', label: 'Trigger event set', ok: Boolean(m.trigger?.event), blocking: true, section: 'delivery' });
  }

  const w = validateWeights(m.variants, m.controlWeight);
  add({ id: 'weights', label: 'Variant weights + control = 100%', ok: w.ok, blocking: true, hint: w.errors[0], section: 'variants' });

  const { reach, warnings } = effectivePlatforms(m.channel, m.platforms);
  add({ id: 'platforms', label: `Reaches ${reach.length ? reach.join(' · ') : 'no platform'}`, ok: reach.length > 0, blocking: true, hint: warnings[0], section: 'audience' });

  // Content per variant, per reached platform (overrides applied).
  let contentOk = true;
  let firstProblem: string | undefined;
  for (const v of m.variants) {
    for (const p of reach.length ? reach : (['ios'] as const)) {
      const c = applyPlatformOverride(v.content as MessageContent & PushContent & EmailContent, v.platformOverrides as never, p);
      let problem: string | null = null;
      if (m.channel === 'content_card' || m.channel === 'in_app') {
        if (!len(c.title) && m.layout !== 'image_only') problem = 'title is empty';
        else if (len(c.title) > CONTENT_LIMITS.title) problem = 'title is too long';
        else if (len(c.body) > CONTENT_LIMITS.body) problem = 'body is too long';
        else if ((m.layout === 'image_only' || m.layout === 'captioned_image' || m.layout === 'hero' || m.layout === 'fullscreen') && !c.image?.assetId) problem = `${m.layout?.replace('_', ' ')} needs an image`;
        else if ((c.buttons ?? []).some((b) => !len(b.label) || len(b.label) > CONTENT_LIMITS.buttonLabel)) problem = 'a button label is empty or too long';
        else if ((c.buttons ?? []).some((b) => b.action.type === 'url' && !/^https:\/\//.test(b.action.value ?? ''))) problem = 'a URL action must start with https://';
        else if ((c.buttons ?? []).some((b) => b.action.type === 'campaign' && !len(b.action.value))) problem = 'a campaign action has no campaign';
      } else if (m.channel === 'push') {
        if (!len(c.title) || !len(c.body)) problem = 'title and body are required';
        else if (len(c.title) > CONTENT_LIMITS.pushTitle || len(c.body) > CONTENT_LIMITS.pushBody) problem = 'title/body too long';
      } else if (m.channel === 'email') {
        if (!len(c.subject) || !len(c.body)) problem = 'subject and body are required';
        else if (len(c.subject) > CONTENT_LIMITS.subject || len(c.body) > CONTENT_LIMITS.emailBody) problem = 'subject/body too long';
      }
      if (problem && contentOk) {
        contentOk = false;
        firstProblem = `Variant ${v.id}${reach.length > 1 ? ` (${p})` : ''}: ${problem}`;
      }
    }
  }
  add({ id: 'content', label: 'Content complete for every variant and platform', ok: contentOk, blocking: true, hint: firstProblem, section: 'content' });

  add({ id: 'filters', label: 'Audience filters valid', ok: m.audienceFilters.every(conditionValid), blocking: true, section: 'audience' });
  add({ id: 'audience', label: m.segmentId || m.audienceFilters.length ? 'Targeted audience' : 'Everyone (no segment)', ok: true, blocking: false, section: 'audience' });

  const start = Date.parse(m.startsAt);
  const end = m.endsAt ? Date.parse(m.endsAt) : null;
  add({ id: 'schedule', label: 'Schedule valid', ok: Number.isFinite(start) && (end === null || (Number.isFinite(end) && end > start)), blocking: true, hint: end !== null && end <= start ? 'End must be after start' : undefined, section: 'delivery' });
  if (m.channel === 'push' || m.channel === 'email') {
    const needsDate = m.sendMode === 'scheduled' || m.sendMode === 'local_time';
    add({ id: 'send', label: 'Send time set', ok: Boolean(m.sendMode) && (!needsDate || Boolean(m.sendAt)) && (m.sendMode !== 'local_time' || (m.localHour !== null && m.localHour >= 0 && m.localHour <= 23)), blocking: true, section: 'delivery' });
  }
  if (m.channel === 'in_app' && m.trigger) {
    add({ id: 'delay', label: 'Trigger delay 0–30 s', ok: m.trigger.delaySeconds >= 0 && m.trigger.delaySeconds <= 30, blocking: true, section: 'delivery' });
  }
  add({ id: 'goal', label: m.conversion ? `Conversion goal: ${m.conversion.event}` : 'Conversion goal (recommended)', ok: Boolean(m.conversion), blocking: false, section: 'goal' });
  if (m.conversion) add({ id: 'goal_window', label: 'Goal window 1–168 h', ok: m.conversion.windowHours >= 1 && m.conversion.windowHours <= 168, blocking: true, section: 'goal' });
  return out;
}
