/**
 * Server-side AI consent on every user-initiated AI route + the consents endpoints
 * (docs/PRIVACY_COMPLIANCE_SPEC.md §3–4). For each route:
 *   - consented (server record)            → the AI service runs
 *   - consents_v1 client, no record        → 403 AI_CONSENT_REQUIRED, the AI service never runs
 *   - shipped client (no consents_v1)      → compat pass (legacy_client), except Plan my week
 *   - withdrawn record                     → 403 even for a shipped client
 * The AI services are mocked; the consent rule and storage are real (fake DB).
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralFakeDb, getReferralDb, setReferralDb } from '@/lib/services/__tests__/referral-fake-db';

const ai = vi.hoisted(() => ({ calls: [] as string[], trainingEnabled: true }));

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: () => {} }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    const auth = request.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer user:')) throw new Error('Unauthorized');
    return { id: auth.slice('Bearer user:'.length) };
  },
}));
vi.mock('@/lib/utils/after-response', () => ({ runAfterResponse: () => {} }));
vi.mock('@/lib/services/journey-service', () => ({ JourneyService: { markFitzyOpened: async () => {} } }));
vi.mock('@/lib/services/usage-service', async (orig) => {
  const actual = await orig<any>();
  return { ...actual, UsageService: { fitzyTier: async () => 'pro' } };
});
vi.mock('@/lib/services/fitzy-service', () => ({
  FitzyService: {
    chat: async (_u: string, _m: unknown, _c: unknown, opts: any) => {
      await opts?.assertAiConsent?.();
      ai.calls.push('fitzy_chat');
      return { answer: 'ok', disclaimer: 'd' };
    },
    streamChat: async (_u: string, input: any, emit: (e: any) => void) => {
      await input.assertAiConsent?.();
      ai.calls.push('fitzy_stream');
      emit({ event: 'done', data: { messageId: 'm', answer: 'ok', suggestions: [], actions: [], disclaimer: 'd', remaining: null } });
    },
    grounding: async () => 'G',
    guard: () => false,
  },
}));
vi.mock('@/lib/services/fitzy-plan-service', () => ({
  FitzyPlanService: {
    create: async () => {
      ai.calls.push('fitzy_plan');
      return { id: 'p' };
    },
    preview: async () => ({ goal: 'g' }),
    current: async () => null,
  },
}));
vi.mock('@/lib/services/nutrition-coach-service', () => ({
  NutritionCoachService: {
    ask: async (_u: string, _q: string, _c: unknown, opts: any) => {
      await opts?.assertAiConsent?.();
      ai.calls.push('coach');
      return { answer: 'ok', disclaimer: 'd' };
    },
  },
}));
vi.mock('@/lib/services/nutrition-intelligence-service', () => ({
  NutritionIntelligenceService: {
    parsePhoto: async () => {
      ai.calls.push('photo');
      return { items: [], totals: {}, overallConfidence: 0.9 };
    },
    parseVoice: async () => {
      ai.calls.push('voice');
      return { items: [], totals: {}, overallConfidence: 0.9 };
    },
    estimateItem: async () => {
      ai.calls.push('estimate');
      return { name: 'x' };
    },
    saveUnparsedPhoto: async () => ({ entryId: 'saved-photo', reused: false }),
    saveUnparsedVoice: async () => ({ entryId: 'saved-voice' }),
    unparsedPhotoKey: () => 'k',
    attachFallbackImages: async () => {},
    ownsFoodLogEntry: async () => false,
  },
}));
vi.mock('@/lib/services/nutrition-training-service', () => ({
  NutritionTrainingService: {
    get enabled() {
      return ai.trainingEnabled;
    },
    captureDraft: async () => {},
    capture: async () => {
      ai.calls.push('training');
    },
  },
}));
vi.mock('@/lib/services/body-comp-photo-service', () => ({
  BodyCompPhotoService: {
    parseScan: async () => {
      ai.calls.push('bodycomp');
      return { segmental: null, overallConfidence: 0.9 };
    },
  },
}));
vi.mock('@/lib/services/entitlement-service', () => ({ EntitlementService: { requireFeature: async () => {}, isFeatureAllowed: async () => true } }));

import { GET as getConsentsWeb, POST as postConsentsWeb } from '../../consents/route';
import { POST as bodyComp } from '../body-comp/photo-parse/route';
import { GET as getConsents, POST as postConsents } from '../consents/route';
import { POST as fitzyChat } from '../fitzy/chat/route';
import { POST as fitzyStream } from '../fitzy/chat/stream/route';
import { POST as fitzyPlan } from '../fitzy/plan/route';
import { POST as estimateItem } from '../food/estimate-item/route';
import { POST as photoParse } from '../food/photo-parse/route';
import { POST as trainingSample } from '../food/training-sample/route';
import { POST as voiceParse } from '../food/voice-parse/route';
import { POST as coach } from '../nutrition-coach/route';

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db: ReferralFakeDb;

type Mode = 'new' | 'old';
const headers = (mode: Mode, extra: Record<string, string> = {}) => ({
  authorization: `Bearer user:${U}`,
  ...(mode === 'new' ? { 'x-client-features': 'icon_keys,consents_v1', 'x-app-platform': 'ios', 'x-app-version': '1.1.3' } : { 'x-app-platform': 'ios', 'x-app-version': '1.1.2' }),
  ...extra,
});
const jsonReq = (path: string, mode: Mode, body: unknown) =>
  new NextRequest(`https://www.fitcircle.ai${path}`, { method: 'POST', headers: { ...headers(mode), 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** Minimal form: the handlers only use getAll('image') / get(name) (jsdom File has no arrayBuffer). */
const imageForm = (extra: Record<string, string> = {}) => {
  const file = { name: 'a.jpg', type: 'image/jpeg', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  return { getAll: (k: string) => (k === 'image' ? [file] : []), get: (k: string) => extra[k] ?? null } as unknown as FormData;
};
// Multipart parsing isn't reliable in the test env; the handlers only call formData() + headers
// (same approach as the photo-parse route tests).
const formReq = (_path: string, mode: Mode, form: FormData) => ({ formData: async () => form, headers: new Headers(headers(mode)) }) as any;

interface RouteCase {
  name: string;
  call: string;
  run: (mode: Mode) => Promise<Response>;
  /** Shipped clients (no consents_v1) without a record: pass (on-device consent) or need chat evidence. */
  legacy: 'allow' | 'evidence';
}

const ROUTES: RouteCase[] = [
  { name: 'POST /fitzy/chat', call: 'fitzy_chat', legacy: 'allow', run: (m) => fitzyChat(jsonReq('/api/mobile/fitzy/chat', m, { messages: [{ role: 'user', content: 'hi' }] })) },
  { name: 'POST /fitzy/chat/stream', call: 'fitzy_stream', legacy: 'allow', run: (m) => fitzyStream(jsonReq('/api/mobile/fitzy/chat/stream', m, { message: 'hi' })) },
  { name: 'POST /fitzy/plan (Plan my week)', call: 'fitzy_plan', legacy: 'evidence', run: (m) => fitzyPlan(jsonReq('/api/mobile/fitzy/plan', m, {})) },
  { name: 'POST /nutrition-coach', call: 'coach', legacy: 'allow', run: (m) => coach(jsonReq('/api/mobile/nutrition-coach', m, { question: 'Is oatmeal good?' })) },
  { name: 'POST /food/photo-parse', call: 'photo', legacy: 'allow', run: (m) => photoParse(formReq('/api/mobile/food/photo-parse', m, imageForm())) },
  { name: 'POST /food/photo-parse (re-analyze)', call: 'photo', legacy: 'allow', run: (m) => photoParse(formReq('/api/mobile/food/photo-parse', m, imageForm({ skip_fallback_save: 'true', existing_entry_id: '3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23' }))) },
  { name: 'POST /food/voice-parse (voice)', call: 'voice', legacy: 'allow', run: (m) => voiceParse(jsonReq('/api/mobile/food/voice-parse', m, { transcript: 'two eggs' })) },
  { name: 'POST /food/voice-parse (describe)', call: 'voice', legacy: 'allow', run: (m) => voiceParse(jsonReq('/api/mobile/food/voice-parse', m, { transcript: 'two eggs', source: 'text' })) },
  { name: 'POST /food/estimate-item', call: 'estimate', legacy: 'allow', run: (m) => estimateItem(jsonReq('/api/mobile/food/estimate-item', m, { name: 'banana' })) },
  { name: 'POST /body-comp/photo-parse', call: 'bodycomp', legacy: 'allow', run: (m) => bodyComp(formReq('/api/mobile/body-comp/photo-parse', m, imageForm())) },
];

/** Stream errors arrive as a single SSE `error` frame (HTTP 200). */
async function outcome(res: Response): Promise<{ status: number; code: string | null; details: any }> {
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const text = await res.text();
    const m = /event: error\ndata: (.*)\n/.exec(text);
    if (!m) return { status: res.status, code: null, details: null };
    const d = JSON.parse(m[1]);
    return { status: 403, code: d.code, details: d.details };
  }
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body?.error?.code ?? null, details: body?.error?.details ?? null };
}

const grant = (granted: boolean) =>
  db.rows('user_consents').push({ user_id: U, consent_type: 'ai_processing', granted, policy_version: '2026-11', source: 'ios', app_version: null, granted_at: new Date().toISOString(), created_at: new Date().toISOString() });

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  db.addProfile({ id: U, created_at: '2026-01-01T00:00:00Z' });
  db.rows('user_consents');
  db.rows('fitzy_conversations');
  ai.calls.length = 0;
  ai.trainingEnabled = true;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe.each(ROUTES)('$name', (r) => {
  it('consented (server record) → runs', async () => {
    grant(true);
    const o = await outcome(await r.run('new'));
    expect(o.code).not.toBe('AI_CONSENT_REQUIRED');
    expect(ai.calls).toContain(r.call);
  });

  it('consents_v1 client without a record → 403 AI_CONSENT_REQUIRED, no AI call', async () => {
    db.rows('fitzy_conversations').push({ id: 'c', user_id: U }); // evidence never substitutes for a new client's record
    const o = await outcome(await r.run('new'));
    expect(o.status).toBe(403);
    expect(o.code).toBe('AI_CONSENT_REQUIRED');
    expect(o.details).toMatchObject({ consentType: 'ai_processing' });
    expect(ai.calls).not.toContain(r.call);
  });

  it(`shipped client without a record → ${r.legacy === 'allow' ? 'compat pass' : 'needs chat evidence'}`, async () => {
    const first = await outcome(await r.run('old'));
    if (r.legacy === 'allow') {
      expect(first.code).not.toBe('AI_CONSENT_REQUIRED');
      expect(ai.calls).toContain(r.call);
    } else {
      expect(first.code).toBe('AI_CONSENT_REQUIRED');
      expect(ai.calls).not.toContain(r.call);
      db.rows('fitzy_conversations').push({ id: 'c', user_id: U });
      expect((await outcome(await r.run('old'))).code).not.toBe('AI_CONSENT_REQUIRED');
      expect(ai.calls).toContain(r.call);
    }
  });

  it('withdrawn record → 403 even for a shipped client with chat history', async () => {
    db.rows('fitzy_conversations').push({ id: 'c', user_id: U });
    grant(false);
    const o = await outcome(await r.run('old'));
    expect(o.code).toBe('AI_CONSENT_REQUIRED');
    expect(ai.calls).not.toContain(r.call);
  });
});

describe('photo/voice parse refused for consent: the meal is never lost', () => {
  it('photo-parse saves the photo (Option B) and returns savedEntryId with the 403', async () => {
    const res = await photoParse(formReq('/api/mobile/food/photo-parse', 'new', imageForm()));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.details).toMatchObject({ consentType: 'ai_processing', savedEntryId: 'saved-photo' });
    expect(body.error.message).toMatch(/saved your photo/);
  });
  it('voice-parse saves the note and returns savedEntryId with the 403', async () => {
    const res = await voiceParse(jsonReq('/api/mobile/food/voice-parse', 'new', { transcript: 'two eggs' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.details).toMatchObject({ savedEntryId: 'saved-voice', feature: 'food_voice' });
  });
});

describe('training-sample capture', () => {
  const sample = () => {
    const values: Record<string, string> = { sample: JSON.stringify({ inputMethod: 'photo', wasEdited: false, parsedItems: [], finalItems: [] }) };
    return { getAll: () => [], get: (k: string) => values[k] ?? null } as unknown as FormData;
  };
  it('without consent (new client) → 204 no-op, nothing captured', async () => {
    const res = await trainingSample(formReq('/api/mobile/food/training-sample', 'new', sample()));
    expect(res.status).toBe(204);
    expect(ai.calls).not.toContain('training');
  });
  it('with a granted record → captured', async () => {
    grant(true);
    const res = await trainingSample(formReq('/api/mobile/food/training-sample', 'new', sample()));
    expect(res.status).toBe(200);
    expect(ai.calls).toContain('training');
  });
});

describe('GET/POST /api/mobile/consents and /api/consents', () => {
  const req = (path: string, method: 'GET' | 'POST', body?: unknown, h: Record<string, string> = headers('new')) =>
    new NextRequest(`https://www.fitcircle.ai${path}`, { method, headers: { ...h, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  it('401 without auth', async () => {
    expect((await getConsents(req('/api/mobile/consents', 'GET', undefined, {}))).status).toBe(401);
    expect((await postConsents(req('/api/mobile/consents', 'POST', { consents: [] }, {}))).status).toBe(401);
  });

  it('GET: null per type before any record, plus effective + currentPolicyVersion', async () => {
    const body = await (await getConsents(req('/api/mobile/consents', 'GET'))).json();
    expect(body.data).toEqual({
      consents: { health_data: null, ai_processing: null, marketing_email: null },
      effective: { marketingEmail: true },
      currentPolicyVersion: '2026-11',
    });
    expect((await getConsents(req('/api/mobile/consents', 'GET'))).headers.get('cache-control')).toContain('no-store');
  });

  it('POST records several types (source + app version from headers) and GET reflects them', async () => {
    const res = await postConsents(
      req('/api/mobile/consents', 'POST', {
        consents: [
          { type: 'ai_processing', granted: true, policyVersion: 'ios-ai-1', grantedAt: '2026-06-01T10:00:00Z' },
          { type: 'health_data', granted: true, policyVersion: '2026-11' },
          { type: 'marketing_email', granted: false, policyVersion: '2026-11' },
        ],
      })
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.consents.ai_processing).toMatchObject({ granted: true, policyVersion: 'ios-ai-1', grantedAt: '2026-06-01T10:00:00.000Z', source: 'ios', appVersion: '1.1.3' });
    expect(data.consents.health_data).toMatchObject({ granted: true, source: 'ios' });
    expect(data.consents.marketing_email).toMatchObject({ granted: false });
    expect(data.effective).toEqual({ marketingEmail: false });
    const again = await (await getConsents(req('/api/mobile/consents', 'GET'))).json();
    expect(again.data.consents.ai_processing.granted).toBe(true);
  });

  it('a future grantedAt is clamped to now', async () => {
    const before = Date.now();
    const { data } = await (await postConsents(req('/api/mobile/consents', 'POST', { consents: [{ type: 'ai_processing', granted: true, policyVersion: 'v', grantedAt: '2099-01-01T00:00:00Z' }] }))).json();
    expect(Date.parse(data.consents.ai_processing.grantedAt)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(data.consents.ai_processing.grantedAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('400 VALIDATION_ERROR for unknown type / missing fields / empty list', async () => {
    for (const bad of [{ consents: [{ type: 'location', granted: true, policyVersion: 'v' }] }, { consents: [{ type: 'ai_processing', granted: 'yes', policyVersion: 'v' }] }, { consents: [] }, {}]) {
      const res = await postConsents(req('/api/mobile/consents', 'POST', bad));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(db.rows('user_consents')).toHaveLength(0);
  });

  it('web twin records source "web"', async () => {
    const res = await postConsentsWeb(req('/api/consents', 'POST', { consents: [{ type: 'ai_processing', granted: true, policyVersion: '2026-11' }] }, { authorization: `Bearer user:${U}` }));
    expect((await res.json()).data.consents.ai_processing.source).toBe('web');
    expect((await (await getConsentsWeb(req('/api/consents', 'GET', undefined, { authorization: `Bearer user:${U}` }))).json()).data.consents.ai_processing.granted).toBe(true);
  });

  it('503 CONSENT_STORE_UNAVAILABLE when the write fails', async () => {
    const client = db.client();
    vi.spyOn(db, 'client').mockReturnValue({ ...client, from: (t: string) => (t === 'user_consents' ? { insert: async () => ({ error: { message: 'down' } }) } : client.from(t)) } as any);
    const res = await postConsents(req('/api/mobile/consents', 'POST', { consents: [{ type: 'health_data', granted: true, policyVersion: 'v' }] }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('CONSENT_STORE_UNAVAILABLE');
  });
});
