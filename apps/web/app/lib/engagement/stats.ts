/**
 * Per message / variant / channel performance from engagement_sends rows
 * (GET /api/admin/engagement/stats; the same numbers as the SQL in
 * docs/ENGAGEMENT_MESSAGING.md §8). Pure.
 *
 * Rates use `sent` as the denominator (opens/clicks are provider-observed and
 * include privacy proxies, so treat open rate as directional). Lift compares
 * goal conversion of sent vs holdout rows of the same message and channel.
 */
export interface StatsRow {
  message_key: string;
  channel: string;
  status: string;
  variant: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  unsubscribed_at: string | null;
  converted_at: string | null;
  meta?: Record<string, any> | null;
}

export interface MessageStats {
  message_key: string;
  channel: string;
  variant: string;
  sent: number;
  failed: number;
  suppressed: number;
  skipped: number;
  holdout: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  converted: number;
  holdout_converted: number;
  growth_converted: number;
  delivery_rate: number | null;
  open_rate: number | null;
  click_rate: number | null;
  unsubscribe_rate: number | null;
  conversion_rate: number | null;
  holdout_conversion_rate: number | null;
  /** conversion_rate − holdout_conversion_rate (percentage points), when both exist. */
  lift_pp: number | null;
}

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 100 : null);

/**
 * Group by message_key + channel + a variant dimension: 'all' (default),
 * or one key of the flattened variant string (e.g. 'hero', 'growth', 'subject').
 */
export function aggregateStats(rows: StatsRow[], by: string = 'all'): MessageStats[] {
  const groups = new Map<string, MessageStats>();
  const variantOf = (v: string | null) => {
    if (by === 'all') return 'all';
    const part = (v ?? '').split('|').find((p) => p.startsWith(`${by}:`));
    return part ? part.slice(by.length + 1) : '(none)';
  };
  for (const r of rows) {
    const variant = variantOf(r.variant);
    const key = `${r.message_key}\u0000${r.channel}\u0000${variant}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        message_key: r.message_key,
        channel: r.channel,
        variant,
        sent: 0, failed: 0, suppressed: 0, skipped: 0, holdout: 0,
        delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0,
        converted: 0, holdout_converted: 0, growth_converted: 0,
        delivery_rate: null, open_rate: null, click_rate: null, unsubscribe_rate: null,
        conversion_rate: null, holdout_conversion_rate: null, lift_pp: null,
      };
      groups.set(key, g);
    }
    switch (r.status) {
      case 'sent':
        g.sent++;
        if (r.delivered_at) g.delivered++;
        if (r.opened_at) g.opened++;
        if (r.clicked_at) g.clicked++;
        if (r.bounced_at) g.bounced++;
        if (r.complained_at) g.complained++;
        if (r.unsubscribed_at) g.unsubscribed++;
        if (r.converted_at) g.converted++;
        if (r.meta?.growth_converted_at) g.growth_converted++;
        break;
      case 'holdout':
        g.holdout++;
        if (r.converted_at) g.holdout_converted++;
        break;
      case 'failed':
        g.failed++;
        break;
      case 'suppressed':
        g.suppressed++;
        break;
      case 'skipped':
        g.skipped++;
        break;
    }
  }
  return [...groups.values()]
    .map((g) => {
      const conversion = rate(g.converted, g.sent);
      const holdout = rate(g.holdout_converted, g.holdout);
      return {
        ...g,
        delivery_rate: rate(g.delivered, g.sent),
        open_rate: rate(g.opened, g.sent),
        click_rate: rate(g.clicked, g.sent),
        unsubscribe_rate: rate(g.unsubscribed, g.sent),
        conversion_rate: conversion,
        holdout_conversion_rate: holdout,
        lift_pp: conversion !== null && holdout !== null ? Math.round((conversion - holdout) * 100) / 100 : null,
      };
    })
    .sort((a, b) => a.message_key.localeCompare(b.message_key) || a.channel.localeCompare(b.channel) || a.variant.localeCompare(b.variant));
}
