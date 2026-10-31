/** Engage rows for tests. */
import type { AssetRow, MessageRow } from '../../engage/model';

let n = 0;
export const mid = () => `e0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export const cardContent = (over: Record<string, unknown> = {}) => ({
  title: 'Hi {{first_name | default: "friend"}}',
  body: 'Your streak is {{streak}} days',
  badge: null,
  image: null,
  imageAlt: null,
  buttons: [{ label: 'Invite', action: { type: 'invite', value: null }, style: 'primary' }],
  theme: {},
  imageFit: 'cover',
  dismissible: true,
  pinned: false,
  ...over,
});

export function messageRow(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: mid(),
    name: 'Message',
    campaign_id: null,
    channel: 'content_card',
    placement: 'home_feed',
    layout: 'card',
    published: true,
    published_at: '2026-10-01T00:00:00Z',
    paused_at: null,
    archived_at: null,
    variants: [{ id: 'A', name: 'A', weight: 100, content: cardContent() }],
    control_weight: 0,
    segment_id: null,
    audience_filters: [],
    platforms: [],
    starts_at: '2026-10-01T00:00:00Z',
    ends_at: null,
    send_mode: null,
    send_at: null,
    local_hour: null,
    send_completed_at: null,
    trigger: null,
    max_impressions_per_user: null,
    min_hours_between: null,
    priority: 0,
    respect_global_cap: true,
    conversion: null,
    preview_user_ids: [],
    created_by: null,
    updated_by: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    version: 1,
    ...over,
  };
}

export function assetRow(over: Partial<AssetRow> = {}): AssetRow {
  const id = mid();
  return {
    id,
    sha256: id.replace(/-/g, '').padEnd(64, 'a').slice(0, 64),
    name: 'hero.png',
    mime: 'image/png',
    width: 1440,
    height: 810,
    bytes: 12345,
    url: `https://cdn.test/engage-assets/a/${id}.png`,
    variants: [
      { width: 480, url: `https://cdn.test/engage-assets/a/${id}@480.webp`, format: 'webp' },
      { width: 960, url: `https://cdn.test/engage-assets/a/${id}@960.webp`, format: 'webp' },
    ],
    dominant_color: '#334455',
    tags: ['winter'],
    alt: 'Snowy ring',
    created_by: null,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: '2026-10-10T00:00:00Z',
    archived_at: null,
    ...over,
  };
}

/** Minimal valid PNG header with the given dimensions. */
export function png(width: number, height: number, salt = 0): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  b[39] = salt;
  return b;
}

/** Minimal lossy WebP (VP8) header with the given dimensions. */
export function webp(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  b.set([...'VP8 '].map((c) => c.charCodeAt(0)), 12);
  b[26] = width & 0xff;
  b[27] = (width >> 8) & 0x3f;
  b[28] = height & 0xff;
  b[29] = (height >> 8) & 0x3f;
  return b;
}
