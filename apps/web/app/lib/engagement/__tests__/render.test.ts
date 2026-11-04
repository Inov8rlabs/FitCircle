/**
 * Renderers: structural checks on the email HTML (size budget, preheader,
 * dark colour-scheme, alt text, no emoji, escaping, tracked links, mobile
 * media query, plain-text alternative) and the push payload.
 */
import { describe, expect, it } from 'vitest';

import { welcomeEmail } from '../../email/welcome-email';
import { LIFECYCLE_STEPS } from '../messages/lifecycle';
import { buildWeeklyReport } from '../messages/weekly-report';
import { renderEmail } from '../render/email';
import { renderPush } from '../render/push';
import type { MessagePlan } from '../types';

import { lifecycleFacts, week, weeklyFacts } from './fixtures';

const EMOJI = /\p{Extended_Pictographic}/u;

const rich = () =>
  buildWeeklyReport(
    weeklyFacts({
      goals: { dailyStepsTarget: 8000, dailyWaterMlTarget: 2000, targetWeightKg: 80 },
      thisWeek: week({ activeDays: 6, meals: { count: 15, days: 6 }, workouts: { count: 3, minutes: 120 }, checkIns: 6, steps: { total: 60000, daysWithData: 7, daysAtGoal: 5 }, water: { days: 5, daysAtGoal: 4 }, weight: { first: 85, last: 84.3, entries: 3 } }),
      circles: [{ id: 'c', name: 'Lunch <Club> & "Co"', memberCount: 4, activeMembersThisWeek: 3, yourActiveDays: 6, yourRank: 1, upcoming: false, inviteCode: null, joinedAt: null }],
      campaigns: [{ slug: 'hold_the_line', title: 'Hold the Line', tagline: 'Keep your gains through the holidays.', startsAt: '2026-11-15', endsAt: '2026-12-15', joined: false }],
      recentGrowthSlots: [],
    })
  ) as MessagePlan;

const render = (p: MessagePlan) =>
  renderEmail(p.email!, {
    messageKey: p.messageKey,
    medium: p.medium,
    content: p.variants.hero,
    sendId: '00000000-0000-4000-8000-000000000009',
    footerLinks: [{ label: 'Unsubscribe from weekly recaps', url: 'https://www.fitcircle.ai/api/engagement/unsubscribe?t=x' }],
    postalAddress: '123 Example St, Seattle WA',
  });

describe('renderEmail', () => {
  it('stays well under Gmail’s 102 KB clip and is a complete document', () => {
    const r = render(rich());
    expect(Buffer.byteLength(r.html)).toBeLessThan(60_000);
    expect(r.html.startsWith('<!doctype html>')).toBe(true);
    expect(r.html).toContain('</html>');
  });

  it('dark colour scheme, preheader, viewport, mobile media query, logo alt text', () => {
    const p = rich();
    const r = render(p);
    expect(r.html).toContain('<meta name="color-scheme" content="dark">');
    expect(r.html).toContain('name="viewport"');
    expect(r.html).toContain(p.email!.preheader.replace(/'/g, '&#39;'));
    expect(r.html).toContain('@media only screen and (max-width:480px)');
    expect(r.html).toMatch(/<img [^>]*alt="F"/); // images off: a gradient "F" tile next to the FitCircle wordmark
    expect(r.html).toContain('v:roundrect'); // Outlook bulletproof button
  });

  it('never uses emoji (design rule) and escapes user-provided text', () => {
    const r = render(rich());
    expect(EMOJI.test(r.html)).toBe(false);
    expect(r.html).toContain('Lunch &lt;Club&gt; &amp; &quot;Co&quot;');
    expect(r.html).not.toContain('Lunch <Club>');
  });

  it('every FitCircle link carries UTM + msg_id; footer has unsubscribe + postal address', () => {
    const r = render(rich());
    const hrefs = [...r.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((h) => !h.includes('unsubscribe'));
    expect(hrefs.length).toBeGreaterThan(1);
    for (const h of hrefs) {
      const u = new URL(h);
      expect(u.searchParams.get('utm_source')).toBe('email');
      expect(u.searchParams.get('utm_campaign')).toBe('weekly_report');
      expect(u.searchParams.get('msg_id')).toBe('00000000-0000-4000-8000-000000000009');
    }
    expect(r.html).toContain('Unsubscribe from weekly recaps');
    expect(r.html).toContain('123 Example St, Seattle WA');
  });

  it('plain-text alternative has the content and links', () => {
    const r = render(rich());
    expect(r.text).toContain('THIS WEEK');
    expect(r.text).toMatch(/Plan my week: https:\/\/fitcircle\.ai\/open\?screen=dashboard/);
    expect(r.text).toContain('Unsubscribe from weekly recaps: https://www.fitcircle.ai/api/engagement/unsubscribe');
    expect(r.text).not.toMatch(/<(table|tr|td|p|a|div|span|br)\b/i);
    expect(r.text).toContain('Lunch <Club> & "Co"'); // plain text is not HTML-escaped
  });

  it('lifecycle emails render too', () => {
    for (const step of LIFECYCLE_STEPS.filter((s) => s.channels.includes('email'))) {
      const b = step.build(lifecycleFacts({ streak: { current: 7, lastEngagementDate: '2026-10-31' }, circles: [{ id: 'c', name: 'Crew', memberCount: 1, activeMembersThisWeek: 1, yourActiveDays: 1, yourRank: 1, upcoming: false, inviteCode: 'FITABC123', joinedAt: '2026-10-01T00:00:00Z' }] }), 'p');
      const r = renderEmail(b.email!, { messageKey: step.key, medium: 'lifecycle' });
      expect(EMOJI.test(r.html)).toBe(false);
      expect(r.html).toContain('utm_campaign=' + step.key);
    }
  });
});

describe('welcomeEmail', () => {
  it('one clear first action, no unsubscribe (transactional), no emoji', () => {
    const r = welcomeEmail({ firstName: 'Sam', firstActionUrl: 'https://fitcircle.ai/open?screen=food_log&utm_source=email' });
    expect(r.subject).toBe('Welcome to FitCircle, Sam');
    expect(r.html.match(/<v:roundrect/g)).toHaveLength(1);
    expect(r.html).toContain('Snap my first meal');
    expect(r.html).not.toMatch(/unsubscribe/i);
    expect(EMOJI.test(r.html)).toBe(false);
    expect(r.text).toContain('Snap my first meal: https://fitcircle.ai/open?screen=food_log');
    expect(welcomeEmail({ firstName: null, firstActionUrl: 'https://fitcircle.ai/open' }).subject).toBe('Welcome to FitCircle');
  });
});

describe('renderPush', () => {
  it('weekly report rides weekly_summary; lifecycle steps use lifecycle_nudge with a screen + dedupe key', () => {
    const p = rich();
    expect(renderPush(p.push!, 'weekly_report', '2026-W44')).toMatchObject({ type: 'weekly_summary', data: { dedupeKey: 'engagement:weekly_report:2026-W44', screen: 'dashboard' } });
    const n = renderPush({ title: 'Better with friends 🎉', body: 'x'.repeat(400), screen: 'circles' }, 'onboarding_first_circle', 'once');
    expect(n.type).toBe('lifecycle_nudge');
    expect(n.data.title).toBe('Better with friends');
    expect([...n.data.body].length).toBeLessThanOrEqual(160);
  });
});
