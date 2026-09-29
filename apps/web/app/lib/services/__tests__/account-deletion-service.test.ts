import { generateKeyPairSync } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import {
  AccountDeletionError,
  AccountDeletionService,
  isUserOwnedStoragePath,
} from '../account-deletion-service';
import { resetAppleTokenServiceWarningForTests } from '../apple-token-service';

/**
 * Account deletion against a database that enforces the production constraints.
 *
 * Rows live in the repo's FakeSupabase helper (used as it is: select, insert,
 * update, upsert and filters are delegated to it). The helper has no DELETE, no
 * storage and no auth, and it does not know about foreign keys, so this file
 * adds a thin layer on top:
 *   - delete(), contains(), match()
 *   - the foreign keys and the CHECK from supabase/migrations/000_baseline.sql
 *     that matter here, enforced on DELETE the strict way (a NO ACTION reference
 *     blocks even when a cascade of the same statement would have removed the
 *     referencing row; production may be more lenient, never stricter)
 *   - an in-memory storage and auth admin API
 *   - failure injection and one timeline of everything that was called
 */

type Row = Record<string, any>;
type DbError = { code: string; message: string };

interface ForeignKey {
  table: string;
  column: string;
  ref: string;
  onDelete: 'cascade' | 'set null' | 'no action';
}

const fk = (
  table: string,
  column: string,
  ref: string,
  onDelete: ForeignKey['onDelete']
): ForeignKey => ({ table, column, ref, onDelete });

/** From 000_baseline.sql (FK CONSTRAINT section) and 079 for the exercise tables. */
const FOREIGN_KEYS: ForeignKey[] = [
  // -> profiles
  fk('fitcircles', 'creator_id', 'profiles', 'cascade'),
  fk('fitcircle_members', 'user_id', 'profiles', 'cascade'),
  fk('fitcircle_members', 'invited_by', 'profiles', 'no action'),
  fk('circle_messages', 'sender_id', 'profiles', 'set null'),
  fk('challenges', 'creator_id', 'profiles', 'no action'),
  fk('challenges', 'winner_user_id', 'profiles', 'no action'),
  fk('challenge_participants', 'user_id', 'profiles', 'cascade'),
  fk('challenge_participants', 'invited_by', 'profiles', 'no action'),
  fk('challenge_logs', 'user_id', 'profiles', 'no action'),
  fk('challenge_invites', 'inviter_id', 'profiles', 'no action'),
  fk('challenge_invites', 'invitee_id', 'profiles', 'no action'),
  fk('circle_quests', 'created_by', 'profiles', 'no action'),
  fk('circle_invites', 'accepted_by', 'profiles', 'no action'),
  fk('circle_invites', 'inviter_id', 'profiles', 'cascade'),
  fk('check_ins', 'user_id', 'profiles', 'cascade'),
  fk('check_ins', 'verified_by', 'profiles', 'no action'),
  fk('comments', 'user_id', 'profiles', 'cascade'),
  fk('comments', 'deleted_by', 'profiles', 'no action'),
  fk('notifications', 'user_id', 'profiles', 'cascade'),
  fk('notifications', 'sender_id', 'profiles', 'no action'),
  fk('team_members', 'user_id', 'profiles', 'cascade'),
  fk('team_members', 'removed_by', 'profiles', 'no action'),
  fk('user_consent', 'user_id', 'profiles', 'cascade'),
  fk('food_log_entries', 'user_id', 'profiles', 'cascade'),
  fk('food_log_images', 'user_id', 'profiles', 'cascade'),
  fk('exercise_logs', 'user_id', 'profiles', 'cascade'),
  fk('exercises', 'created_by', 'profiles', 'cascade'),
  fk('apple_auth_tokens', 'user_id', 'profiles', 'cascade'),
  // -> fitcircles
  fk('fitcircle_members', 'fitcircle_id', 'fitcircles', 'cascade'),
  fk('challenges', 'fitcircle_id', 'fitcircles', 'cascade'),
  fk('circle_messages', 'fitcircle_id', 'fitcircles', 'cascade'),
  fk('circle_quests', 'fitcircle_id', 'fitcircles', 'cascade'),
  fk('circle_invites', 'circle_id', 'fitcircles', 'cascade'),
  fk('notifications', 'related_challenge_id', 'fitcircles', 'cascade'),
  fk('challenge_logs', 'fitcircle_id', 'fitcircles', 'no action'),
  fk('challenge_participants', 'fitcircle_id', 'fitcircles', 'no action'),
  // -> challenges
  fk('challenge_participants', 'challenge_id', 'challenges', 'cascade'),
  fk('challenge_logs', 'challenge_id', 'challenges', 'cascade'),
  fk('challenge_invites', 'challenge_id', 'challenges', 'cascade'),
  fk('circle_quests', 'challenge_id', 'challenges', 'no action'),
  // -> challenge_participants
  fk('challenge_logs', 'participant_id', 'challenge_participants', 'cascade'),
  // -> exercise tables (079)
  fk('workout_exercises', 'exercise_log_id', 'exercise_logs', 'cascade'),
  fk('workout_exercises', 'exercise_id', 'exercises', 'no action'),
];

/** circle_messages_kind_shape (baseline line 1189). */
function violatesMessageShape(row: Row): boolean {
  const system = row.kind === 'system_event' && row.system_event_type != null;
  const user = (row.kind === 'user_text' || row.kind === 'user_photo') && row.sender_id != null;
  return !(system || user);
}

function containsJson(value: any, expected: any): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(value) && expected.every((e) => value.some((v: any) => containsJson(v, e)))
    );
  }
  if (expected && typeof expected === 'object') {
    return (
      !!value &&
      typeof value === 'object' &&
      Object.entries(expected).every(([k, v]) => containsJson(value[k], v))
    );
  }
  return value === expected;
}

class FakeStorage {
  buckets: Record<string, Set<string>> = {};
  removeError: Record<string, string> = {};
  listCalls: Array<{ bucket: string; path: string; offset: number; search?: string }> = [];
  removeCalls: Array<{ bucket: string; paths: string[] }> = [];

  constructor(private timeline: string[]) {}

  put(bucket: string, ...paths: string[]) {
    if (!this.buckets[bucket]) this.buckets[bucket] = new Set();
    for (const path of paths) this.buckets[bucket].add(path);
  }

  objects(bucket: string): string[] {
    return Array.from(this.buckets[bucket] ?? []).sort();
  }

  from(bucket: string) {
    return {
      list: async (
        path: string,
        opts: { limit?: number; offset?: number; search?: string } = {}
      ) => {
        this.listCalls.push({ bucket, path, offset: opts.offset ?? 0, search: opts.search });
        const objects = this.buckets[bucket];
        if (!objects) return { data: null, error: { message: 'Bucket not found' } };

        const prefix = `${path}/`;
        const entries = new Map<string, { name: string; id: string | null }>();
        for (const object of objects) {
          if (!object.startsWith(prefix)) continue;
          const rest = object.slice(prefix.length);
          const [name] = rest.split('/');
          const isFolder = rest.includes('/');
          if (!entries.has(name)) entries.set(name, { name, id: isFolder ? null : `id-${object}` });
        }
        let list = Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
        // Like the real API, `search` matches anywhere in the name.
        if (opts.search) {
          const needle = opts.search.toLowerCase();
          list = list.filter((e) => e.name.toLowerCase().includes(needle));
        }
        const offset = opts.offset ?? 0;
        return { data: list.slice(offset, offset + (opts.limit ?? 100)), error: null };
      },
      remove: async (paths: string[]) => {
        this.timeline.push(`storage:remove:${bucket}`);
        this.removeCalls.push({ bucket, paths: [...paths] });
        if (this.removeError[bucket]) {
          return { data: null, error: { message: this.removeError[bucket] } };
        }
        for (const path of paths) this.buckets[bucket]?.delete(path);
        return { data: paths.map((name) => ({ name })), error: null };
      },
    };
  }
}

class DeletionDb {
  fake = new FakeSupabase({
    profiles: { uniqueKey: ['id'] },
    apple_auth_tokens: { uniqueKey: ['user_id'] },
  });
  timeline: string[] = [];
  storage = new FakeStorage(this.timeline);
  authUsers = new Set<string>();
  private failures: Array<{ table: string; op: string; error: DbError; times: number }> = [];
  private authFailures: Array<{ message: string }> = [];

  auth = {
    admin: {
      deleteUser: async (id: string) => {
        this.timeline.push('auth:deleteUser');
        const failure = this.authFailures.shift();
        if (failure) return { data: null, error: { message: failure.message, status: 500 } };
        if (!this.authUsers.has(id)) {
          return { data: null, error: { message: 'User not found', status: 404, code: 'user_not_found' } };
        }
        this.authUsers.delete(id);
        return { data: {}, error: null };
      },
    },
  };

  from(table: string) {
    return new Query(this, table);
  }

  rows(table: string): Row[] {
    return this.fake.getRows(table);
  }

  seed(table: string, ...rows: Row[]) {
    this.fake.seed(table, rows);
  }

  /** The next `times` statements of this kind fail without changing anything. */
  failOn(table: string, op: string, error: DbError, times = 1) {
    this.failures.push({ table, op, error, times });
  }

  failAuthDelete(message: string, times = 1) {
    for (let i = 0; i < times; i++) this.authFailures.push({ message });
  }

  takeFailure(table: string, op: string): DbError | null {
    const failure = this.failures.find((f) => f.table === table && f.op === op && f.times > 0);
    if (!failure) return null;
    failure.times--;
    return failure.error;
  }

  /** DELETE with foreign keys. All or nothing, like a statement. */
  deleteWhere(table: string, predicate: (row: Row) => boolean): DbError | null {
    const snapshot = new Map<string, Row[]>();
    for (const name of Object.keys(this.fake.tables)) {
      snapshot.set(name, this.rows(name).map((r) => ({ ...r })));
    }
    const error = this.removeRows(table, this.rows(table).filter(predicate));
    if (error) {
      for (const [name, rows] of snapshot) {
        const live = this.rows(name);
        live.splice(0, live.length, ...rows);
      }
    }
    return error;
  }

  private removeRows(table: string, targets: Row[]): DbError | null {
    for (const target of targets) {
      const key = target.id;
      const incoming = FOREIGN_KEYS.filter((f) => f.ref === table);

      for (const f of incoming.filter((i) => i.onDelete === 'no action')) {
        if (this.rows(f.table).some((r) => key != null && r[f.column] === key)) {
          return {
            code: '23503',
            message: `update or delete on table "${table}" violates foreign key constraint "${f.table}_${f.column}_fkey" on table "${f.table}"`,
          };
        }
      }
      for (const f of incoming.filter((i) => i.onDelete === 'set null')) {
        for (const row of this.rows(f.table).filter((r) => key != null && r[f.column] === key)) {
          row[f.column] = null;
          if (f.table === 'circle_messages' && violatesMessageShape(row)) {
            return {
              code: '23514',
              message:
                'new row for relation "circle_messages" violates check constraint "circle_messages_kind_shape"',
            };
          }
        }
      }
      for (const f of incoming.filter((i) => i.onDelete === 'cascade')) {
        const children = this.rows(f.table).filter((r) => key != null && r[f.column] === key);
        const error = this.removeRows(f.table, children);
        if (error) return error;
      }

      const live = this.rows(table);
      const index = live.indexOf(target);
      if (index >= 0) live.splice(index, 1);
    }
    return null;
  }

  /** INSERT: the referenced profile must exist. */
  insertViolation(table: string, payload: Row | Row[]): DbError | null {
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const f of FOREIGN_KEYS.filter((k) => k.table === table && k.ref === 'profiles')) {
      for (const row of rows) {
        const value = row[f.column];
        if (value != null && !this.rows('profiles').some((p) => p.id === value)) {
          return {
            code: '23503',
            message: `insert or update on table "${table}" violates foreign key constraint "${table}_${f.column}_fkey"`,
          };
        }
      }
    }
    return null;
  }
}

class Query {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any = null;
  /** Calls replayed on the helper's query, in order. */
  private calls: Array<[method: string, args: any[]]> = [];
  private predicates: Array<(row: Row) => boolean> = [];

  constructor(
    private db: DeletionDb,
    private table: string
  ) {}

  select(...args: any[]) { this.calls.push(['select', args]); return this; }
  insert(payload: any) { this.op = 'insert'; this.payload = payload; this.calls.push(['insert', [payload]]); return this; }
  update(payload: any) { this.op = 'update'; this.payload = payload; this.calls.push(['update', [payload]]); return this; }
  upsert(...args: any[]) { this.op = 'upsert'; this.payload = args[0]; this.calls.push(['upsert', args]); return this; }
  delete() { this.op = 'delete'; return this; }

  eq(column: string, value: any) { return this.filter('eq', [column, value], (r) => r[column] === value); }
  neq(column: string, value: any) { return this.filter('neq', [column, value], (r) => r[column] !== value); }
  in(column: string, values: any[]) { return this.filter('in', [column, values], (r) => values.includes(r[column])); }
  is(column: string, value: any) {
    return this.filter('is', [column, value], (r) => (value === null ? r[column] == null : r[column] === value));
  }
  not(column: string, operator: string, value: any) {
    return this.filter('not', [column, operator, value], (r) =>
      operator === 'is' && value === null ? r[column] != null : r[column] !== value
    );
  }
  match(conditions: Row) {
    for (const [column, value] of Object.entries(conditions)) this.eq(column, value);
    return this;
  }
  contains(column: string, expected: any) {
    if (this.op !== 'delete') throw new Error('DeletionDb: contains() is only supported on delete');
    this.predicates.push((r) => containsJson(r[column], expected));
    return this;
  }
  order(...args: any[]) { this.calls.push(['order', args]); return this; }
  limit(...args: any[]) { this.calls.push(['limit', args]); return this; }

  private filter(method: string, args: any[], predicate: (row: Row) => boolean) {
    this.calls.push([method, args]);
    this.predicates.push(predicate);
    return this;
  }

  private run(terminal?: 'single' | 'maybeSingle'): Promise<any> {
    this.db.timeline.push(`db:${this.op}:${this.table}`);

    const injected = this.db.takeFailure(this.table, this.op);
    if (injected) return Promise.resolve({ data: null, error: injected, count: null });

    if (this.op === 'delete') {
      const error = this.db.deleteWhere(this.table, (r) => this.predicates.every((p) => p(r)));
      return Promise.resolve({ data: null, error });
    }
    if (this.op === 'insert') {
      const error = this.db.insertViolation(this.table, this.payload);
      if (error) return Promise.resolve({ data: null, error });
    }

    let query: any = this.db.fake.from(this.table);
    for (const [method, args] of this.calls) query = query[method](...args);
    return terminal ? query[terminal]() : Promise.resolve(query);
  }

  single() { return this.run('single'); }
  maybeSingle() { return this.run('maybeSingle'); }
  then<T>(resolve: (value: any) => T, reject?: (e: any) => T): Promise<T> {
    return this.run().then(resolve, reject);
  }
}

// ----------------------------------------------------------------------------

let db: DeletionDb;
vi.mock('../../supabase-admin', () => ({
  createAdminSupabase: () => db,
}));

const recalculateLeaderboard = vi.fn();
vi.mock('../leaderboard-service-v2', () => ({
  recalculateLeaderboard: (...args: unknown[]) => recalculateLeaderboard(...args),
}));

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FRIEND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEWER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OUTSIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const SHARED = '11111111-1111-4111-8111-111111111111'; // owned by USER, has other members
const SOLO = '22222222-2222-4222-8222-222222222222'; // owned by USER, nobody else
const THEIRS = '33333333-3333-4333-8333-333333333333'; // owned by FRIEND, USER is a member

const STORAGE_BASE = 'https://test.supabase.co/storage/v1/object/public';
const APPLE_ENV = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID'] as const;
const savedEnv: Record<string, string | undefined> = {};
let fetchMock: ReturnType<typeof vi.fn>;

function configureApple() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.APPLE_TEAM_ID = 'TEAM123456';
  process.env.APPLE_KEY_ID = 'KEY1234567';
  process.env.APPLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.APPLE_CLIENT_ID = 'com.inov8rlabs.apps.fitcircle';
}

function seedPeople(target: DeletionDb) {
  for (const id of [USER, FRIEND, NEWER, OUTSIDER]) {
    target.seed('profiles', { id, display_name: `user-${id.slice(0, 4)}`, avatar_url: null });
    target.authUsers.add(id);
  }
}

function seedCircles(target: DeletionDb) {
  target.seed(
    'fitcircles',
    { id: SHARED, creator_id: USER, name: 'Shared', type: 'step_count', participant_count: 3 },
    { id: SOLO, creator_id: USER, name: 'Solo', type: 'custom', participant_count: 1 },
    { id: THEIRS, creator_id: FRIEND, name: 'Theirs', type: 'weight_loss', participant_count: 2 }
  );
  target.seed(
    'fitcircle_members',
    { id: 'm-shared-user', fitcircle_id: SHARED, user_id: USER, status: 'active', joined_at: '2026-01-01', invited_by: null },
    { id: 'm-shared-newer', fitcircle_id: SHARED, user_id: NEWER, status: 'active', joined_at: '2026-03-01', invited_by: USER },
    { id: 'm-shared-friend', fitcircle_id: SHARED, user_id: FRIEND, status: 'active', joined_at: '2026-02-01', invited_by: USER },
    { id: 'm-solo-user', fitcircle_id: SOLO, user_id: USER, status: 'active', joined_at: '2026-01-01', invited_by: null },
    { id: 'm-theirs-friend', fitcircle_id: THEIRS, user_id: FRIEND, status: 'active', joined_at: '2026-01-01', invited_by: null },
    { id: 'm-theirs-user', fitcircle_id: THEIRS, user_id: USER, status: 'active', joined_at: '2026-02-01', invited_by: FRIEND }
  );
}

function seedMessages(target: DeletionDb) {
  target.seed(
    'circle_messages',
    { id: 'msg-text', fitcircle_id: THEIRS, sender_id: USER, kind: 'user_text', body: 'hello', photo_url: null },
    {
      id: 'msg-photo',
      fitcircle_id: THEIRS,
      sender_id: USER,
      kind: 'user_photo',
      body: null,
      photo_url: `${STORAGE_BASE}/fitcircle-media/${USER}/chat/photo.jpg`,
    },
    { id: 'msg-tombstone', fitcircle_id: THEIRS, sender_id: USER, kind: 'user_text', body: null, photo_url: null, deleted_at: '2026-05-01' },
    { id: 'msg-friend', fitcircle_id: THEIRS, sender_id: FRIEND, kind: 'user_text', body: 'hi back', photo_url: null },
    {
      id: 'msg-system-user',
      fitcircle_id: THEIRS,
      sender_id: null,
      kind: 'system_event',
      system_event_type: 'workout_done',
      body: 'user-aaaa finished a workout',
      system_payload: { render_hint: 'card', actors: [{ id: USER }] },
    },
    {
      id: 'msg-system-friend',
      fitcircle_id: THEIRS,
      sender_id: null,
      kind: 'system_event',
      system_event_type: 'workout_done',
      body: 'user-bbbb finished a workout',
      system_payload: { render_hint: 'card', actors: [{ id: FRIEND }] },
    }
  );
}

function seedChallenges(target: DeletionDb) {
  target.seed(
    'challenges',
    { id: 'ch-theirs', fitcircle_id: THEIRS, creator_id: USER, name: 'Pushups', winner_user_id: null, participant_count: 2 },
    { id: 'ch-won', fitcircle_id: THEIRS, creator_id: FRIEND, name: 'Planks', winner_user_id: USER, participant_count: 1 },
    { id: 'ch-solo', fitcircle_id: SOLO, creator_id: USER, name: 'Alone', winner_user_id: null, participant_count: 1 }
  );
  target.seed(
    'challenge_participants',
    { id: 'cp-user', challenge_id: 'ch-theirs', fitcircle_id: THEIRS, user_id: USER, status: 'active', invited_by: null },
    { id: 'cp-friend', challenge_id: 'ch-theirs', fitcircle_id: THEIRS, user_id: FRIEND, status: 'active', invited_by: USER },
    { id: 'cp-solo', challenge_id: 'ch-solo', fitcircle_id: SOLO, user_id: USER, status: 'active', invited_by: null }
  );
  target.seed(
    'challenge_logs',
    { id: 'log-user', challenge_id: 'ch-theirs', participant_id: 'cp-user', fitcircle_id: THEIRS, user_id: USER, amount: 10 },
    { id: 'log-friend', challenge_id: 'ch-theirs', participant_id: 'cp-friend', fitcircle_id: THEIRS, user_id: FRIEND, amount: 12 },
    { id: 'log-solo', challenge_id: 'ch-solo', participant_id: 'cp-solo', fitcircle_id: SOLO, user_id: USER, amount: 5 }
  );
  target.seed(
    'challenge_invites',
    { id: 'ci-sent', challenge_id: 'ch-theirs', inviter_id: USER, invitee_id: NEWER, status: 'pending' },
    { id: 'ci-received', challenge_id: 'ch-won', inviter_id: FRIEND, invitee_id: USER, status: 'pending' },
    { id: 'ci-other', challenge_id: 'ch-won', inviter_id: FRIEND, invitee_id: NEWER, status: 'pending' }
  );
  target.seed(
    'circle_quests',
    { id: 'q-theirs', fitcircle_id: THEIRS, challenge_id: 'ch-theirs', quest_name: 'Quest', created_by: USER },
    { id: 'q-solo', fitcircle_id: SOLO, challenge_id: 'ch-solo', quest_name: 'Solo quest', created_by: USER }
  );
  target.seed(
    'circle_invites',
    { id: 'inv-accepted', circle_id: THEIRS, inviter_id: FRIEND, accepted_by: USER, status: 'accepted' },
    { id: 'inv-sent', circle_id: SHARED, inviter_id: USER, accepted_by: NEWER, status: 'accepted' }
  );
}

function seedEverything(target: DeletionDb) {
  seedPeople(target);
  seedCircles(target);
  seedMessages(target);
  seedChallenges(target);
  target.seed('food_log_entries', { id: 'food-1', user_id: USER }, { id: 'food-2', user_id: FRIEND });
  target.seed('notifications', { id: 'n-1', user_id: FRIEND, sender_id: USER, title: 't', body: 'b' });
  target.seed('exercises', { id: 'ex-custom', created_by: USER, is_custom: true });
  target.seed('exercise_logs', { id: 'el-1', user_id: USER });
  target.seed('workout_exercises', { id: 'we-1', exercise_log_id: 'el-1', exercise_id: 'ex-custom' });
}

function expectNoTraceOf(userId: string) {
  expect(db.rows('profiles').some((p) => p.id === userId)).toBe(false);
  expect(db.authUsers.has(userId)).toBe(false);
  for (const table of Object.keys(db.fake.tables)) {
    for (const row of db.rows(table)) {
      for (const [column, value] of Object.entries(row)) {
        if (value === userId) {
          throw new Error(`${table}.${column} still references the deleted user (row ${row.id})`);
        }
      }
    }
  }
}

const indexOf = (event: string) => db.timeline.indexOf(event);
const lastIndexOf = (event: string) => db.timeline.lastIndexOf(event);

beforeEach(() => {
  for (const key of APPLE_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetAppleTokenServiceWarningForTests();
  db = new DeletionDb();
  recalculateLeaderboard.mockReset();
  recalculateLeaderboard.mockResolvedValue({ entries: [], error: null });
  fetchMock = vi.fn(async () => {
    db.timeline.push('apple:fetch');
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const key of APPLE_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('test database: the production constraints block a bare profile delete', () => {
  it('rejects it when the user sent a chat message (CHECK circle_messages_kind_shape)', async () => {
    seedPeople(db);
    db.seed('fitcircles', { id: THEIRS, creator_id: FRIEND });
    db.seed('circle_messages', { id: 'm', fitcircle_id: THEIRS, sender_id: USER, kind: 'user_text', body: 'x' });

    const { error } = await db.from('profiles').delete().eq('id', USER);

    expect(error?.code).toBe('23514');
    expect(db.rows('profiles').some((p) => p.id === USER)).toBe(true);
    expect(db.rows('circle_messages')[0].sender_id).toBe(USER); // rolled back
  });

  it.each([
    ['fitcircle_members', { id: 'x', fitcircle_id: THEIRS, user_id: FRIEND, invited_by: USER }],
    ['challenges', { id: 'x', fitcircle_id: THEIRS, creator_id: USER }],
    ['circle_quests', { id: 'x', fitcircle_id: THEIRS, created_by: USER }],
    ['circle_invites', { id: 'x', circle_id: THEIRS, inviter_id: FRIEND, accepted_by: USER }],
  ])('rejects it when %s still references the user (no ON DELETE action)', async (table, row) => {
    seedPeople(db);
    db.seed('fitcircles', { id: THEIRS, creator_id: FRIEND });
    db.seed(table, row);

    const { error } = await db.from('profiles').delete().eq('id', USER);

    expect(error?.code).toBe('23503');
    expect(error?.message).toContain(table);
    expect(db.rows('profiles').some((p) => p.id === USER)).toBe(true);
  });
});

describe('AccountDeletionService.deleteAccount', () => {
  it('deletes a user who sent chat messages', async () => {
    seedPeople(db);
    db.seed('fitcircles', { id: THEIRS, creator_id: FRIEND, type: 'custom' });
    db.seed(
      'fitcircle_members',
      { id: 'm1', fitcircle_id: THEIRS, user_id: FRIEND, status: 'active', joined_at: '2026-01-01' },
      { id: 'm2', fitcircle_id: THEIRS, user_id: USER, status: 'active', joined_at: '2026-02-01' }
    );
    seedMessages(db);
    db.storage.put('fitcircle-media', `${USER}/chat/photo.jpg`, `${FRIEND}/chat/other.jpg`);

    const result = await AccountDeletionService.deleteAccount(USER, { userEmail: 'u@example.com' });

    expect(result.success).toBe(true);
    // The user's messages are gone, tombstone and system post about them included.
    expect(db.rows('circle_messages').map((m) => m.id).sort()).toEqual(['msg-friend', 'msg-system-friend']);
    // The photo went before the row that named it, the row before the profile.
    expect(db.storage.objects('fitcircle-media')).toEqual([`${FRIEND}/chat/other.jpg`]);
    expect(indexOf('storage:remove:fitcircle-media')).toBeLessThan(indexOf('db:delete:circle_messages'));
    expect(indexOf('db:delete:circle_messages')).toBeLessThan(indexOf('db:delete:profiles'));
    expect(indexOf('db:delete:profiles')).toBeLessThan(indexOf('auth:deleteUser'));
    expectNoTraceOf(USER);
  });

  it('transfers an owned circle to the oldest active member and frees the members it invited', async () => {
    seedPeople(db);
    seedCircles(db);

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.challenges_transferred).toBe(1);
    expect(result.challenges_deleted).toBe(1);

    const shared = db.rows('fitcircles').find((c) => c.id === SHARED);
    expect(shared?.creator_id).toBe(FRIEND); // joined 2026-02-01, before NEWER
    expect(shared?.participant_count).toBe(2);
    expect(db.rows('fitcircles').some((c) => c.id === SOLO)).toBe(false);
    expect(db.rows('fitcircles').find((c) => c.id === THEIRS)?.creator_id).toBe(FRIEND);

    // The other members stay, without the reference to the inviter.
    const members = db.rows('fitcircle_members');
    expect(members.map((m) => m.id).sort()).toEqual(['m-shared-friend', 'm-shared-newer', 'm-theirs-friend']);
    expect(members.every((m) => m.invited_by == null)).toBe(true);

    // The new owner is told.
    expect(db.rows('notifications')).toEqual([
      expect.objectContaining({ user_id: FRIEND, related_challenge_id: SHARED, type: 'system' }),
    ]);

    // Ownership and references are settled before anything is deleted.
    const firstDelete = db.timeline.findIndex((e) => e.startsWith('db:delete:'));
    expect(indexOf('db:update:fitcircles')).toBeLessThan(firstDelete);
    expect(indexOf('db:update:fitcircle_members')).toBeLessThan(firstDelete);

    expect(recalculateLeaderboard).toHaveBeenCalledWith(SHARED, 'daily', 'steps', db);
    expect(recalculateLeaderboard).toHaveBeenCalledWith(THEIRS, 'daily', 'weight_loss_pct', db);
    expect(recalculateLeaderboard).not.toHaveBeenCalledWith(SOLO, expect.anything(), expect.anything(), expect.anything());
    expectNoTraceOf(USER);
  });

  it('does not count inactive members as heirs', async () => {
    seedPeople(db);
    db.seed('fitcircles', { id: SHARED, creator_id: USER, type: 'custom' });
    db.seed(
      'fitcircle_members',
      { id: 'm1', fitcircle_id: SHARED, user_id: USER, status: 'active', joined_at: '2026-01-01' },
      { id: 'm2', fitcircle_id: SHARED, user_id: FRIEND, status: 'dropped', joined_at: '2026-01-02', invited_by: USER }
    );

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.challenges_transferred).toBe(0);
    expect(result.challenges_deleted).toBe(1);
    expect(db.rows('fitcircles')).toHaveLength(0);
    expectNoTraceOf(USER);
  });

  it('hands over challenges and quests the user created and removes their own entries', async () => {
    seedPeople(db);
    seedCircles(db);
    seedChallenges(db);

    await AccountDeletionService.deleteAccount(USER);

    const challenges = db.rows('challenges');
    // In a circle that stays: handed to the circle owner, results kept.
    expect(challenges.find((c) => c.id === 'ch-theirs')).toMatchObject({ creator_id: FRIEND, participant_count: 1 });
    expect(challenges.find((c) => c.id === 'ch-won')).toMatchObject({ creator_id: FRIEND, winner_user_id: null });
    // In the circle that had nobody else: gone with it.
    expect(challenges.some((c) => c.id === 'ch-solo')).toBe(false);

    expect(db.rows('circle_quests')).toEqual([
      expect.objectContaining({ id: 'q-theirs', created_by: null, challenge_id: 'ch-theirs' }),
    ]);
    expect(db.rows('challenge_participants')).toEqual([
      expect.objectContaining({ id: 'cp-friend', invited_by: null }),
    ]);
    expect(db.rows('challenge_logs').map((l) => l.id)).toEqual(['log-friend']);
    expect(db.rows('challenge_invites').map((i) => i.id)).toEqual(['ci-other']);
    expect(db.rows('circle_invites')).toEqual([
      expect.objectContaining({ id: 'inv-accepted', accepted_by: null, inviter_id: FRIEND }),
    ]);
    expectNoTraceOf(USER);
  });

  it('deletes an account in every state at once', async () => {
    seedEverything(db);

    const result = await AccountDeletionService.deleteAccount(USER, {
      confirmEmail: 'u@example.com',
      userEmail: 'u@example.com',
      ipAddress: '203.0.113.7',
    });

    expect(result).toMatchObject({
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
      challenges_transferred: 1,
      challenges_deleted: 1,
      data_summary: { check_ins: 0, challenge_participations: 3, notifications: 0, comments: 0, reactions: 0 },
    });
    expect(typeof result.deleted_at).toBe('string');

    expect(db.rows('notifications').find((n) => n.id === 'n-1')).toMatchObject({ user_id: FRIEND, sender_id: null });
    expect(db.rows('food_log_entries').map((f) => f.id)).toEqual(['food-2']);
    expect(db.rows('exercises')).toHaveLength(0);
    expect(db.rows('workout_exercises')).toHaveLength(0);
    expect(db.rows('user_consent')).toHaveLength(0);
    expect(db.rows('profiles').map((p) => p.id).sort()).toEqual([FRIEND, NEWER, OUTSIDER]);
    expectNoTraceOf(USER);
  });

  it('rejects a confirmation email that does not match, before touching anything', async () => {
    seedEverything(db);

    await expect(
      AccountDeletionService.deleteAccount(USER, { confirmEmail: 'a@example.com', userEmail: 'b@example.com' })
    ).rejects.toThrow('Email confirmation does not match');

    expect(db.timeline).toEqual([]);
  });
});

describe('AccountDeletionService.deleteAccount: failures and second attempts', () => {
  it('deletes nothing when a blocker cannot be resolved', async () => {
    seedEverything(db);
    configureApple();
    db.seed('apple_auth_tokens', { user_id: USER, refresh_token: 'refresh-1' });
    db.storage.put('food-logs', `${USER}/2026/09/food-1/img_original.jpg`);
    db.failOn('circle_quests', 'update', { code: '57014', message: 'canceling statement due to statement timeout' });

    const attempt = AccountDeletionService.deleteAccount(USER);

    await expect(attempt).rejects.toBeInstanceOf(AccountDeletionError);
    await expect(attempt).rejects.toThrow(/clearing circle_quests\.created_by.*statement timeout.*57014/);

    expect(db.timeline.some((e) => e.startsWith('db:delete:'))).toBe(false);
    expect(db.timeline.some((e) => e.startsWith('storage:remove:'))).toBe(false);
    expect(db.timeline).not.toContain('apple:fetch');
    expect(db.timeline).not.toContain('auth:deleteUser');
    expect(db.rows('circle_messages').filter((m) => m.sender_id === USER)).toHaveLength(3);
    expect(db.rows('food_log_entries')).toHaveLength(2);
    expect(db.storage.objects('food-logs')).toHaveLength(1);
    expect(db.rows('profiles').some((p) => p.id === USER)).toBe(true);

    // Second attempt.
    const result = await AccountDeletionService.deleteAccount(USER);
    expect(result.success).toBe(true);
    // The circle was transferred by the first attempt and is not transferred twice.
    expect(result.challenges_transferred).toBe(0);
    expect(db.rows('fitcircles').find((c) => c.id === SHARED)?.creator_id).toBe(FRIEND);
    expect(db.rows('notifications').filter((n) => n.related_challenge_id === SHARED)).toHaveLength(1);
    expectNoTraceOf(USER);
  });

  it('stops before the profile when the circles cannot be read (they would cascade)', async () => {
    seedEverything(db);
    db.failOn('fitcircles', 'select', { code: '08006', message: 'connection failure' });

    await expect(AccountDeletionService.deleteAccount(USER)).rejects.toThrow(
      /loading the circles the user owns/
    );

    expect(db.rows('fitcircles')).toHaveLength(3);
    expect(db.rows('fitcircle_members')).toHaveLength(6);
    expect(db.timeline.some((e) => e.startsWith('db:delete:'))).toBe(false);
  });

  it('finishes on the second attempt after failing half way through the rows', async () => {
    seedEverything(db);
    db.failOn('challenge_logs', 'delete', { code: '40001', message: 'could not serialize access' });

    await expect(AccountDeletionService.deleteAccount(USER)).rejects.toThrow(
      /deleting challenge_logs rows of the user/
    );

    // Half done: messages are gone, the account is still there and usable.
    expect(db.rows('circle_messages').some((m) => m.sender_id === USER)).toBe(false);
    expect(db.rows('profiles').some((p) => p.id === USER)).toBe(true);
    expect(db.authUsers.has(USER)).toBe(true);

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(db.rows('challenge_logs').map((l) => l.id)).toEqual(['log-friend']);
    expectNoTraceOf(USER);
  });

  it('finishes on the second attempt after the profile delete failed', async () => {
    seedEverything(db);
    db.failOn('profiles', 'delete', { code: '57014', message: 'canceling statement due to statement timeout' });

    const attempt = AccountDeletionService.deleteAccount(USER);
    await expect(attempt).rejects.toBeInstanceOf(AccountDeletionError);
    await expect(attempt).rejects.toThrow(/deleting the profile.*57014/);

    expect(db.rows('profiles').some((p) => p.id === USER)).toBe(true);
    expect(db.timeline).not.toContain('auth:deleteUser');

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expectNoTraceOf(USER);
  });

  it('finishes on the second attempt after the auth user delete failed', async () => {
    seedEverything(db);
    db.failAuthDelete('Database error deleting user', 2); // first call and its retry

    await expect(AccountDeletionService.deleteAccount(USER)).rejects.toThrow(
      /deleting the auth account.*Database error deleting user/
    );

    expect(db.rows('profiles').some((p) => p.id === USER)).toBe(false);
    expect(db.authUsers.has(USER)).toBe(true);

    // The profile is gone, so the audit insert is refused; that must not matter.
    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expectNoTraceOf(USER);
  });

  it('retries the auth user delete once', async () => {
    seedEverything(db);
    db.failAuthDelete('upstream timeout', 1);

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(db.timeline.filter((e) => e === 'auth:deleteUser')).toHaveLength(2);
    expectNoTraceOf(USER);
  });

  it('succeeds when everything is already gone', async () => {
    seedEverything(db);
    await AccountDeletionService.deleteAccount(USER);
    const others = JSON.stringify(db.fake.tables);

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(result.challenges_transferred).toBe(0);
    expect(result.challenges_deleted).toBe(0);
    expect(JSON.stringify(db.fake.tables)).toBe(others);
  });

  it('tolerates tables that do not exist', async () => {
    seedEverything(db);
    const missing = { code: 'PGRST205', message: "Could not find the table 'public.x' in the schema cache" };
    db.failOn('team_members', 'update', missing);
    db.failOn('team_members', 'delete', missing);
    db.failOn('exercises', 'delete', { code: '42P01', message: 'relation "public.exercises" does not exist' });
    db.failOn('challenges', 'select', missing);
    db.rows('challenges').splice(0); // the table is "missing": nothing references the user from it
    db.rows('circle_quests').forEach((q) => (q.challenge_id = null));
    db.rows('exercises').splice(0);
    db.rows('workout_exercises').splice(0);

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expectNoTraceOf(USER);
  });

  it('does not stop for a leaderboard that cannot be recalculated', async () => {
    seedEverything(db);
    recalculateLeaderboard.mockRejectedValue(new Error('boom'));

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expectNoTraceOf(USER);
  });
});

describe('AccountDeletionService.deleteAccount: storage', () => {
  const avatarOf = (id: string, n = 1) => `avatars/${id}_${1_700_000_000_000 + n}.jpg`;
  const checkinOf = (id: string, n = 1) => `checkin-photos/${id}_${1_700_000_000_000 + n}.jpg`;

  function seedStorage() {
    db.storage.put(
      'food-logs',
      `${USER}/2026/09/food-1/img_original.jpg`,
      `${USER}/2026/09/food-1/img_medium.jpg`,
      `${USER}/2026/09/food-1/img_thumbnail.jpg`,
      `${USER}/2025/12/food-0/old_original.jpg`,
      `${FRIEND}/2026/09/food-2/img_original.jpg`,
      // Another user's entry whose file name starts with the deleted user's id.
      `${FRIEND}/2026/09/food-3/${USER}_original.jpg`,
      // A folder that merely starts with the user's id.
      `${USER}0/2026/09/food-9/img_original.jpg`
    );
    db.storage.put('beverage-logs', `${USER}/2026/09/bev-1/img_original.jpg`, `${FRIEND}/2026/09/bev-2/img_original.jpg`);
    db.storage.put('fitcircle-media', `${USER}/general/1-a.png`, `${USER}/chat/photo.jpg`, `${FRIEND}/chat/other.jpg`);
    db.storage.put(
      'avatars',
      avatarOf(USER),
      avatarOf(USER, 2),
      avatarOf(FRIEND),
      // Contains "<userId>_" but does not start with it: found by search, not owned.
      `avatars/x${USER}_1.jpg`,
      `avatars/${FRIEND}_${USER}_1.jpg`,
      // Same name in another folder of the bucket.
      `other/${USER}_1.jpg`
    );
    db.storage.put('checkin-photos', checkinOf(USER), checkinOf(FRIEND));
    // 'nutrition-training' does not exist in this project.
  }

  const othersBefore = () => ({
    'food-logs': [
      `${FRIEND}/2026/09/food-2/img_original.jpg`,
      `${FRIEND}/2026/09/food-3/${USER}_original.jpg`,
      `${USER}0/2026/09/food-9/img_original.jpg`,
    ].sort(),
    'beverage-logs': [`${FRIEND}/2026/09/bev-2/img_original.jpg`],
    'fitcircle-media': [`${FRIEND}/chat/other.jpg`],
    avatars: [avatarOf(FRIEND), `avatars/x${USER}_1.jpg`, `avatars/${FRIEND}_${USER}_1.jpg`, `other/${USER}_1.jpg`].sort(),
    'checkin-photos': [checkinOf(FRIEND)],
  });

  it("removes the user's objects from every bucket and nothing else", async () => {
    seedEverything(db);
    seedStorage();
    db.rows('profiles').find((p) => p.id === USER)!.avatar_url = `${STORAGE_BASE}/avatars/${avatarOf(USER)}`;

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    for (const [bucket, expected] of Object.entries(othersBefore())) {
      expect(db.storage.objects(bucket)).toEqual(expected);
    }
    for (const call of db.storage.removeCalls) {
      for (const path of call.paths) {
        expect(isUserOwnedStoragePath(call.bucket, path, USER)).toBe(true);
      }
    }
    // A bucket that does not exist is skipped.
    expect(db.storage.listCalls.some((c) => c.bucket === 'nutrition-training')).toBe(true);
    expect(db.storage.removeCalls.some((c) => c.bucket === 'nutrition-training')).toBe(false);
    // Files go before the rows that name them.
    expect(lastIndexOf('storage:remove:food-logs')).toBeLessThan(indexOf('db:delete:food_log_images'));
    expect(lastIndexOf('storage:remove:avatars')).toBeLessThan(indexOf('db:delete:profiles'));
  });

  it('ignores photo urls that point at other users, other buckets or other hosts', async () => {
    seedPeople(db);
    db.seed('fitcircles', { id: THEIRS, creator_id: FRIEND, type: 'custom' });
    db.storage.put('fitcircle-media', `${FRIEND}/chat/other.jpg`);
    db.storage.put('avatars', `avatars/${FRIEND}_1.jpg`);
    db.storage.put('private-bucket', `${USER}/secret.jpg`);
    db.rows('profiles').find((p) => p.id === USER)!.avatar_url = `${STORAGE_BASE}/avatars/avatars/${FRIEND}_1.jpg`;
    db.seed(
      'circle_messages',
      { id: 'a', fitcircle_id: THEIRS, sender_id: USER, kind: 'user_photo', photo_url: `${STORAGE_BASE}/fitcircle-media/${FRIEND}/chat/other.jpg` },
      { id: 'b', fitcircle_id: THEIRS, sender_id: USER, kind: 'user_photo', photo_url: `${STORAGE_BASE}/fitcircle-media/${USER}/../${FRIEND}/chat/other.jpg` },
      { id: 'c', fitcircle_id: THEIRS, sender_id: USER, kind: 'user_photo', photo_url: `${STORAGE_BASE}/private-bucket/${USER}/secret.jpg` },
      { id: 'd', fitcircle_id: THEIRS, sender_id: USER, kind: 'user_photo', photo_url: `https://evil.example/storage/v1/object/public/fitcircle-media/${USER}/x.jpg` },
      { id: 'e', fitcircle_id: THEIRS, sender_id: USER, kind: 'user_photo', photo_url: 'not a url %E0%A4%A' }
    );

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(db.storage.removeCalls).toEqual([]);
    expect(db.storage.objects('fitcircle-media')).toEqual([`${FRIEND}/chat/other.jpg`]);
    expect(db.storage.objects('avatars')).toEqual([`avatars/${FRIEND}_1.jpg`]);
    expect(db.storage.objects('private-bucket')).toEqual([`${USER}/secret.jpg`]);
    expectNoTraceOf(USER);
  });

  it('pages through large folders and removes in batches', async () => {
    seedPeople(db);
    const mine = Array.from({ length: 250 }, (_, i) => `${USER}/2026/09/entry/${String(i).padStart(4, '0')}.jpg`);
    db.storage.put('food-logs', ...mine, `${FRIEND}/2026/09/entry/0001.jpg`);

    await AccountDeletionService.deleteAccount(USER);

    const pages = db.storage.listCalls.filter((c) => c.bucket === 'food-logs' && c.path === `${USER}/2026/09/entry`);
    expect(pages.map((p) => p.offset)).toEqual([0, 100, 200]);
    const batches = db.storage.removeCalls.filter((c) => c.bucket === 'food-logs');
    expect(batches.map((b) => b.paths.length)).toEqual([100, 100, 50]);
    expect(db.storage.objects('food-logs')).toEqual([`${FRIEND}/2026/09/entry/0001.jpg`]);
  });

  it('carries on when storage fails', async () => {
    seedEverything(db);
    seedStorage();
    db.storage.removeError['food-logs'] = 'storage unavailable';
    const list = db.storage.from.bind(db.storage);
    db.storage.from = ((bucket: string) => {
      if (bucket === 'beverage-logs') {
        return {
          list: async () => {
            throw new Error('socket hang up');
          },
          remove: async () => ({ data: null, error: null }),
        };
      }
      return list(bucket);
    }) as typeof db.storage.from;

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(db.storage.objects('avatars')).toEqual(othersBefore().avatars);
    expectNoTraceOf(USER);
  });

  it('does not touch storage for a user id that is not a uuid', async () => {
    db.seed('profiles', { id: 'avatars' });
    db.authUsers.add('avatars');
    seedStorage();

    await AccountDeletionService.deleteAccount('avatars');

    expect(db.storage.listCalls).toEqual([]);
    expect(db.storage.removeCalls).toEqual([]);
  });
});

describe('isUserOwnedStoragePath', () => {
  it.each([
    ['food-logs', `${USER}/2026/09/e/i_original.jpg`],
    ['beverage-logs', `${USER}/2026/09/e/i_thumbnail.jpg`],
    ['fitcircle-media', `${USER}/general/1-a.png`],
    ['nutrition-training', `${USER}/abc123.jpg`],
    ['avatars', `avatars/${USER}_1700000000000.jpg`],
    ['checkin-photos', `checkin-photos/${USER}_1700000000000.heic`],
    ['food-logs', `${USER.toUpperCase()}/2026/09/e/i_original.jpg`],
  ])('accepts %s/%s', (bucket, path) => {
    expect(isUserOwnedStoragePath(bucket, path, USER)).toBe(true);
  });

  it.each([
    ['food-logs', `${FRIEND}/2026/09/e/i_original.jpg`],
    ['food-logs', `${FRIEND}/2026/09/e/${USER}_original.jpg`],
    ['food-logs', `${USER}0/2026/09/e/i_original.jpg`],
    ['food-logs', `${USER}`],
    ['food-logs', `${USER}/`],
    ['food-logs', `${USER}/../${FRIEND}/a.jpg`],
    ['food-logs', `${USER}//a.jpg`],
    ['food-logs', `/${USER}/a.jpg`],
    ['food-logs', ''],
    ['avatars', `avatars/${FRIEND}_1.jpg`],
    ['avatars', `avatars/x${USER}_1.jpg`],
    ['avatars', `avatars/${USER}.jpg`],
    ['avatars', `avatars/${USER}_1/nested.jpg`],
    ['avatars', `other/${USER}_1.jpg`],
    ['avatars', `${USER}_1.jpg`],
    ['avatars', `${USER}/a.jpg`],
    ['checkin-photos', `avatars/${USER}_1.jpg`],
    ['unknown-bucket', `${USER}/a.jpg`],
  ])('rejects %s/%s', (bucket, path) => {
    expect(isUserOwnedStoragePath(bucket, path, USER)).toBe(false);
  });

  it('rejects everything for a user id that is not a uuid', () => {
    expect(isUserOwnedStoragePath('food-logs', '/a.jpg', '')).toBe(false);
    expect(isUserOwnedStoragePath('avatars', 'avatars/_1.jpg', '')).toBe(false);
    expect(isUserOwnedStoragePath('food-logs', 'abc/a.jpg', 'abc')).toBe(false);
  });
});

describe('AccountDeletionService.deleteAccount: Sign in with Apple', () => {
  it('skips revocation when Apple is not configured', async () => {
    seedEverything(db);
    db.seed('apple_auth_tokens', { user_id: USER, refresh_token: 'refresh-1' });

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.timeline).not.toContain('db:select:apple_auth_tokens');
    expect(db.rows('apple_auth_tokens')).toHaveLength(0); // cascaded with the profile
    expectNoTraceOf(USER);
  });

  it('revokes the stored refresh token before the profile is deleted', async () => {
    seedEverything(db);
    configureApple();
    db.seed(
      'apple_auth_tokens',
      { user_id: USER, refresh_token: 'refresh-user' },
      { user_id: FRIEND, refresh_token: 'refresh-friend' }
    );

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://appleid.apple.com/auth/revoke');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('token')).toBe('refresh-user');
    expect(form.get('token_type_hint')).toBe('refresh_token');
    expect(form.get('client_id')).toBe('com.inov8rlabs.apps.fitcircle');

    expect(indexOf('apple:fetch')).toBeGreaterThan(-1);
    expect(indexOf('apple:fetch')).toBeLessThan(indexOf('db:delete:profiles'));
    expect(db.rows('apple_auth_tokens')).toEqual([{ user_id: FRIEND, refresh_token: 'refresh-friend' }]);
    expectNoTraceOf(USER);
  });

  it('does not call Apple for a user without a stored token', async () => {
    seedEverything(db);
    configureApple();

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(db.timeline).toContain('db:select:apple_auth_tokens');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tolerates the token table not existing yet', async () => {
    seedEverything(db);
    configureApple();
    db.failOn('apple_auth_tokens', 'select', {
      code: 'PGRST205',
      message: "Could not find the table 'public.apple_auth_tokens' in the schema cache",
    });

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoTraceOf(USER);
  });

  it.each([
    ['Apple answers with an error', () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })],
    [
      'Apple cannot be reached',
      () => {
        throw new Error('getaddrinfo ENOTFOUND appleid.apple.com');
      },
    ],
  ])('deletes the account even when %s', async (_name, respond) => {
    seedEverything(db);
    configureApple();
    db.seed('apple_auth_tokens', { user_id: USER, refresh_token: 'refresh-user' });
    fetchMock.mockImplementation(async () => respond());

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectNoTraceOf(USER);
  });

  it('deletes the account even when the private key is unusable', async () => {
    seedEverything(db);
    configureApple();
    process.env.APPLE_PRIVATE_KEY = 'not-a-key';
    db.seed('apple_auth_tokens', { user_id: USER, refresh_token: 'refresh-user' });

    const result = await AccountDeletionService.deleteAccount(USER);

    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoTraceOf(USER);
  });
});
