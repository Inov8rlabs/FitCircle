import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import {
  DataExportService,
  EXPORT_CHILD_TABLES,
  EXPORT_TABLES,
  EXPORT_TABLE_NAMES,
  PAGE_SIZE,
  ROW_CAP,
  SIGNED_URL_TTL_SECONDS,
} from '../data-export-service';

/**
 * The export against an in-memory database (the repo's FakeSupabase helper)
 * with two additions: column projection for explicit selects (so a column the
 * export leaves out really is absent) and a storage fake for signed URLs.
 */

type Row = Record<string, any>;

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STORAGE = 'https://test.supabase.co/storage/v1/object/public';
const NOW = new Date('2026-11-06T12:00:00.000Z');

function project(row: Row, cols: string): Row {
  if (!cols || cols.trim() === '*') return row;
  const names = cols.split(',').map((c) => c.trim());
  const out: Row = {};
  for (const name of names) if (name in row) out[name] = row[name];
  return out;
}

class ProjectingQuery {
  private cols = '*';
  constructor(private inner: any) {}
  select(cols?: string, opts?: any) {
    this.cols = cols ?? '*';
    this.inner = this.inner.select(cols, opts);
    return this;
  }
  eq(...a: any[]) { this.inner = this.inner.eq(...a); return this; }
  in(...a: any[]) { this.inner = this.inner.in(...a); return this; }
  order(...a: any[]) { this.inner = this.inner.order(...a); return this; }
  range(...a: any[]) { this.inner = this.inner.range(...a); return this; }
  insert(...a: any[]) { this.inner = this.inner.insert(...a); return this; }
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return this.inner
      .then((r: any) => ({ ...r, data: Array.isArray(r.data) ? r.data.map((row: Row) => project(row, this.cols)) : r.data }))
      .then(resolve, reject);
  }
}

/** A table that does not exist: every query resolves with PostgREST's PGRST205. */
class MissingQuery {
  constructor(private table: string) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  order() { return this; }
  range() { return this; }
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve({
      data: null,
      error: { code: 'PGRST205', message: `Could not find the table 'public.${this.table}' in the schema cache` },
    }).then(resolve, reject);
  }
}

class ExportDb {
  fake = new FakeSupabase({});
  missing = new Set<string>();
  signCalls: Array<{ bucket: string; paths: string[]; ttl: number }> = [];
  fromCalls: string[] = [];

  from(table: string) {
    this.fromCalls.push(table);
    if (this.missing.has(table)) return new MissingQuery(table);
    return new ProjectingQuery(this.fake.from(table));
  }

  storage = {
    from: (bucket: string) => ({
      createSignedUrls: async (paths: string[], ttl: number) => {
        this.signCalls.push({ bucket, paths: [...paths], ttl });
        return {
          data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${bucket}/${path}?ttl=${ttl}`, error: null })),
          error: null,
        };
      },
    }),
  };

  seed(table: string, ...rows: Row[]) {
    this.fake.seed(table, rows);
  }
}

let db: ExportDb;
const build = () => DataExportService.buildExport({ id: USER, email: 'me@example.com' }, { db: db as any, now: NOW });

/** One row of the user's and one of someone else's in every exported table. */
function seedEveryTable(target: ExportDb) {
  for (const spec of EXPORT_TABLES) {
    target.seed(spec.table, { id: `${spec.name}-mine`, [spec.column]: USER, created_at: '2026-10-01' });
    target.seed(spec.table, { id: `${spec.name}-theirs`, [spec.column]: OTHER, created_at: '2026-10-01' });
  }
  target.seed('workout_exercises', { id: 'we-mine', exercise_log_id: 'exercise_logs-mine' });
  target.seed('workout_exercises', { id: 'we-theirs', exercise_log_id: 'exercise_logs-theirs' });
  target.seed('exercise_sets', { id: 'set-mine', workout_exercise_id: 'we-mine', reps: 10 });
  target.seed('exercise_sets', { id: 'set-theirs', workout_exercise_id: 'we-theirs', reps: 3 });
}

beforeEach(() => {
  db = new ExportDb();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('DataExportService.buildExport: completeness', () => {
  it('exports every table in the list, with a manifest entry for each', async () => {
    seedEveryTable(db);
    const out = await build();

    expect(EXPORT_TABLE_NAMES.length).toBeGreaterThan(80);
    for (const name of EXPORT_TABLE_NAMES) {
      expect(out.data[name], name).toBeDefined();
      expect(out.data[name].length, name).toBeGreaterThanOrEqual(1);
      expect(out.tables[name], name).toBe(out.data[name].length);
    }
    expect(Object.keys(out.tables).sort()).toEqual([...EXPORT_TABLE_NAMES].sort());
    expect(out.manifest.errors).toEqual([]);
    expect(out.manifest.truncated).toEqual([]);
  });

  it('covers the tables the audit found missing (F10)', () => {
    for (const name of [
      'food_log_entries',
      'food_log_images',
      'beverage_logs',
      'exercise_logs',
      'body_composition_logs',
      'fitzy_conversations',
      'fitzy_messages',
      'fitzy_memory',
      'fitzy_plans',
      'fitzy_daily',
      'circle_messages',
      'streak_claims',
      'streak_shields',
      'streak_recoveries',
      'referral_invites',
      'referrals_sent',
      'user_consent',
      'user_consents',
      'push_tokens',
      'subscription_events',
      'nutrition_training_samples',
      'dietary_preferences',
      'experiment_assignments',
      'user_attribution',
      'notification_preferences',
    ]) {
      expect(EXPORT_TABLE_NAMES, name).toContain(name);
    }
  });

  it('never exports another user\'s rows', async () => {
    seedEveryTable(db);
    const out = await build();

    expect(JSON.stringify(out)).not.toContain(OTHER);
    expect(out.data.workout_exercises.map((r) => r.id)).toEqual(['we-mine']);
    expect(out.data.exercise_sets.map((r) => r.id)).toEqual(['set-mine']);
  });

  it('exports only the chat messages the user wrote', async () => {
    db.seed(
      'circle_messages',
      { id: 'mine', sender_id: USER, kind: 'user_text', body: 'hello' },
      { id: 'friend', sender_id: OTHER, kind: 'user_text', body: 'hi back' },
      { id: 'system', sender_id: null, kind: 'system_event', body: 'someone logged a meal' }
    );
    const out = await build();
    expect(out.data.circle_messages.map((r) => r.id)).toEqual(['mine']);
  });

  it('keeps credentials and other people\'s contact details out', async () => {
    db.seed('push_tokens', { id: 'pt', user_id: USER, token: 'apns-raw-token-value', platform: 'ios', created_at: '2026-10-01' });
    db.seed('apple_auth_tokens', { user_id: USER, refresh_token: 'apple-refresh-secret', created_at: '2026-10-01' });
    db.seed('referral_invites', {
      id: 'ri',
      inviter_id: USER,
      email: 'friend@example.com',
      name: 'Friend Name',
      contact_display: 'f***@example.com',
      contact_hash: 'hash-of-friend',
      status: 'sent',
    });
    db.seed('circle_invites', { id: 'ci', inviter_id: USER, email: 'invitee@example.com', status: 'pending' });
    db.seed('referrals', { id: 'rf', inviter_id: USER, invitee_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', invitee_device_hash: 'their-device' });

    const out = await build();
    const text = JSON.stringify(out);

    expect(out.data.push_tokens).toEqual([{ id: 'pt', platform: 'ios', created_at: '2026-10-01' }]);
    for (const secret of [
      'apns-raw-token-value',
      'apple-refresh-secret',
      'friend@example.com',
      'Friend Name',
      'f***@example.com',
      'hash-of-friend',
      'invitee@example.com',
      'their-device',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(out.data.referral_invites[0]).toMatchObject({ id: 'ri', status: 'sent' });
  });

  it('pages past the PostgREST 1000-row limit', async () => {
    const rows = Array.from({ length: PAGE_SIZE * 2 + 500 }, (_, i) => ({
      id: `d-${String(i).padStart(6, '0')}`,
      user_id: USER,
    }));
    db.seed('daily_tracking', ...rows);
    const out = await build();
    expect(out.data.daily_tracking).toHaveLength(PAGE_SIZE * 2 + 500);
    expect(out.tables.daily_tracking).toBe(PAGE_SIZE * 2 + 500);
    expect(out.manifest.truncated).not.toContain('daily_tracking');
  });

  it('caps a table at ROW_CAP rows and flags it as truncated', async () => {
    const rows = Array.from({ length: ROW_CAP + 1 }, (_, i) => ({ id: `e-${String(i).padStart(6, '0')}`, user_id: USER }));
    db.seed('engagement_activities', ...rows);
    const out = await build();
    expect(out.data.engagement_activities).toHaveLength(ROW_CAP);
    expect(out.manifest.truncated).toEqual(['engagement_activities']);
    expect(out.manifest.rowCap).toBe(ROW_CAP);
  });
});

describe('DataExportService.buildExport: photos', () => {
  it('adds short-lived signed URLs for the user\'s photos and only theirs', async () => {
    db.seed(
      'food_log_images',
      {
        id: 'img-1',
        user_id: USER,
        storage_bucket: 'food-logs',
        storage_path: `${USER}/2026/11/e1/i1_original.jpg`,
        thumbnail_path: `${USER}/2026/11/e1/i1_thumb.jpg`,
      },
      // A row of the user's that points into someone else's folder is not signed.
      { id: 'img-2', user_id: USER, storage_bucket: 'food-logs', storage_path: `${OTHER}/x/y.jpg`, thumbnail_path: null }
    );
    db.seed('beverage_log_images', {
      id: 'bimg',
      user_id: USER,
      storage_bucket: 'beverage-logs',
      storage_path: `${USER}/2026/11/b1/i_original.jpg`,
      thumbnail_path: `${USER}/2026/11/b1/i_thumb.jpg`,
    });
    db.seed('nutrition_training_samples', { id: 'nts', user_id: USER, image_path: `${USER}/abc.jpg` });
    db.seed('check_ins', {
      id: 'chk',
      user_id: USER,
      photo_urls: [`${STORAGE}/checkin-photos/checkin-photos/${USER}_1.jpg`, 'https://elsewhere.example/p.jpg'],
    });
    db.seed('body_composition_logs', { id: 'bc', user_id: USER, photo_urls: [`${STORAGE}/fitcircle-media/${USER}/scale/1.jpg`] });
    db.seed('circle_messages', { id: 'msg', sender_id: USER, kind: 'user_photo', photo_url: `${STORAGE}/fitcircle-media/${USER}/chat/p.jpg` });
    db.seed('profiles', { id: USER, email: 'me@example.com', avatar_url: `${STORAGE}/avatars/avatars/${USER}_123.jpg` });

    const out = await build();

    const [img1, img2] = out.data.food_log_images;
    expect(img1.signed_url).toBe(`https://signed.test/food-logs/${USER}/2026/11/e1/i1_original.jpg?ttl=3600`);
    expect(img1.thumbnail_signed_url).toBe(`https://signed.test/food-logs/${USER}/2026/11/e1/i1_thumb.jpg?ttl=3600`);
    expect(img2.signed_url).toBeNull();
    expect(out.data.beverage_log_images[0].signed_url).toContain('https://signed.test/beverage-logs/');
    expect(out.data.nutrition_training_samples[0].image_signed_url).toBe(
      `https://signed.test/nutrition-training/${USER}/abc.jpg?ttl=3600`
    );
    expect(out.data.check_ins[0].photo_signed_urls).toEqual([
      `https://signed.test/checkin-photos/checkin-photos/${USER}_1.jpg?ttl=3600`,
      null,
    ]);
    expect(out.data.body_composition_logs[0].photo_signed_urls[0]).toContain('https://signed.test/fitcircle-media/');
    expect(out.data.circle_messages[0].photo_signed_url).toContain(`https://signed.test/fitcircle-media/${USER}/chat/p.jpg`);
    expect(out.profile?.avatar_signed_url).toContain(`https://signed.test/avatars/avatars/${USER}_123.jpg`);

    expect(db.signCalls.every((c) => c.ttl === SIGNED_URL_TTL_SECONDS)).toBe(true);
    expect(db.signCalls.flatMap((c) => c.paths).some((p) => p.startsWith(OTHER))).toBe(false);
    expect(out.signedUrlExpiresAt).toBe('2026-11-06T13:00:00.000Z');
    expect(out.manifest.signedUrls).toBe(9);
  });

  it('still exports when signing fails', async () => {
    db.seed('food_log_images', { id: 'img', user_id: USER, storage_bucket: 'food-logs', storage_path: `${USER}/a/b.jpg` });
    db.storage.from = () => ({
      createSignedUrls: async () => ({ data: null, error: { message: 'storage down' } }),
    }) as any;
    const out = await build();
    expect(out.data.food_log_images[0].signed_url).toBeNull();
    expect(out.manifest.signedUrls).toBe(0);
  });
});

describe('DataExportService.buildExport: fail-soft', () => {
  it('records a missing table in manifest.errors and exports the rest', async () => {
    seedEveryTable(db);
    db.missing.add('food_log_entries');
    const out = await build();

    expect(out.data.food_log_entries).toEqual([]);
    expect(out.tables.food_log_entries).toBe(0);
    expect(out.manifest.errors).toEqual([
      expect.objectContaining({ table: 'food_log_entries', code: 'PGRST205' }),
    ]);
    expect(out.data.fitzy_messages).toHaveLength(1);
  });

  it('treats a missing user_consents table (migration 130 not applied) as empty, not an error', async () => {
    db.missing.add('user_consents');
    const out = await build();
    expect(out.data.user_consents).toEqual([]);
    expect(out.manifest.errors).toEqual([]);
  });

  it('exports the new user_consents rows when the table exists', async () => {
    db.seed('user_consents', {
      id: 'uc1',
      user_id: USER,
      consent_type: 'ai_processing',
      granted: true,
      policy_version: '2026-11',
      source: 'ios',
      app_version: '1.2.0',
      granted_at: '2026-11-05T00:00:00Z',
      created_at: '2026-11-05T00:00:00Z',
    });
    const out = await build();
    expect(out.data.user_consents).toEqual([expect.objectContaining({ id: 'uc1', consent_type: 'ai_processing' })]);
  });

  it('records a thrown read as an error without failing the export', async () => {
    const original = db.from.bind(db);
    db.from = ((table: string) => {
      if (table === 'fitzy_messages') throw new Error('socket hang up');
      return original(table);
    }) as any;
    const out = await build();
    expect(out.data.fitzy_messages).toEqual([]);
    expect(out.manifest.errors).toEqual([{ table: 'fitzy_messages', code: null, message: 'socket hang up' }]);
  });
});

describe('DataExportService.buildExport: format', () => {
  it('keeps the v1 top-level keys and adds the v2 ones', async () => {
    db.seed('profiles', { id: USER, email: 'me@example.com', created_at: '2026-01-01', last_active_at: '2026-11-05' });
    db.seed('daily_tracking', { id: 'd1', user_id: USER, tracking_date: '2026-11-01' });
    db.seed('check_ins', { id: 'c1', user_id: USER });
    db.seed('fitcircle_members', { id: 'm1', user_id: USER });
    db.seed('notifications', { id: 'n1', user_id: USER });
    db.seed('user_consent', { id: 'uc', user_id: USER, consent_type: 'privacy_policy' });
    db.seed('privacy_settings', { id: 'ps', user_id: USER, analytics_enabled: false });

    const out = await build();

    // v1
    expect(out.export_metadata).toMatchObject({ export_format: 'JSON', user_id: USER });
    expect(out.account).toEqual({
      user_id: USER,
      email: 'me@example.com',
      created_at: '2026-01-01',
      last_sign_in_at: '2026-11-05',
    });
    expect(out.profile).toMatchObject({ id: USER });
    expect(out.health_data).toEqual({
      daily_tracking: [expect.objectContaining({ id: 'd1' })],
      check_ins: [expect.objectContaining({ id: 'c1' })],
      record_count: 2,
    });
    expect(out.challenges).toEqual({ participations: [expect.objectContaining({ id: 'm1' })], count: 1 });
    expect(out.notifications).toEqual([expect.objectContaining({ id: 'n1' })]);
    expect(out.privacy).toEqual({
      consent_history: [expect.objectContaining({ id: 'uc' })],
      current_settings: expect.objectContaining({ id: 'ps' }),
    });
    // v2
    expect(out.exportVersion).toBe(2);
    expect(out.generatedAt).toBe(NOW.toISOString());
    expect(out.signedUrlExpiresAt).toBe('2026-11-06T13:00:00.000Z');
    expect(out.tables.daily_tracking).toBe(1);
  });

  it('uses the auth account fields when the caller has them', async () => {
    db.seed('profiles', { id: USER, email: 'old@example.com', created_at: '2026-01-01' });
    const out = await DataExportService.buildExport(
      { id: USER, email: 'auth@example.com', created_at: '2025-12-31', last_sign_in_at: '2026-11-06' },
      { db: db as any, now: NOW }
    );
    expect(out.account).toMatchObject({ email: 'auth@example.com', created_at: '2025-12-31', last_sign_in_at: '2026-11-06' });
  });

  it('works for a brand-new account with no data', async () => {
    const out = await build();
    expect(out.profile).toBeNull();
    expect(out.health_data.record_count).toBe(0);
    expect(Object.values(out.tables).every((n) => n === 0)).toBe(true);
  });

  it('lists child tables after their parents', () => {
    const names = EXPORT_TABLES.map((s) => s.name);
    for (const child of EXPORT_CHILD_TABLES) {
      expect(names.includes(child.parent) || EXPORT_CHILD_TABLES.some((c) => c.name === child.parent)).toBe(true);
    }
  });
});

describe('DataExportService.logExport', () => {
  it('writes the legacy audit row and never throws', async () => {
    await DataExportService.logExport(USER, { ipAddress: '1.2.3.4', platform: 'mobile' }, db as any);
    expect(db.fake.getRows('user_consent')).toEqual([
      expect.objectContaining({ user_id: USER, consent_version: 'data-export', metadata: expect.objectContaining({ platform: 'mobile' }) }),
    ]);

    const broken = { from: () => { throw new Error('down'); } };
    await expect(DataExportService.logExport(USER, {}, broken as any)).resolves.toBeUndefined();
  });
});
