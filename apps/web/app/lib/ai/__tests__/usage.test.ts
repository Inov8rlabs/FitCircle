/** AI usage attribution + ledger (lib/ai/usage.ts). */
import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ calls: [] as any[], fail: null as any }));
vi.mock('ai', async (orig) => ({
  ...(await orig<any>()),
  embedMany: async (o: any) => {
    sdk.calls.push(o);
    if (sdk.fail) throw sdk.fail;
    return { embeddings: [[0.1]], usage: { tokens: 3 }, providerMetadata: { gateway: { cost: '0.00000006', gatewayCost: '0.00030006', marketCost: '0.00000006', generationId: 'gen_e' } } };
  },
}));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }));

import { embedTexts } from '../../embeddings';
import { gatewayCallOptions } from '../gateway-options';
import { aiEnvironment, recordAiUsage, setAiUsageWriter, trackAiCall, usageGatewayFields, usageRow, type AiUsageEventRow } from '../usage';

const USER = '11111111-1111-4111-8111-111111111111';
const written: AiUsageEventRow[] = [];
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  setAiUsageWriter(null);
  written.length = 0;
  sdk.calls.length = 0;
  sdk.fail = null;
});

// The exact provider metadata shape the gateway returned on 2026-11-10 (strings).
const LIVE_META = {
  gateway: {
    routing: { originalModelId: 'google/gemini-2.5-flash-lite', finalProvider: 'vertex' },
    cost: '0.0000011',
    marketCost: '0.0000011',
    surchargeCost: '0.0003',
    gatewayCost: '0.0003011',
    inferenceCost: '0.0000011',
    reportingTagWriteCost: '0.0003',
    generationId: 'gen_01M737901JBM0S4VQFYDB8C0QH',
  },
};
const LIVE_USAGE = {
  inputTokens: 7,
  inputTokenDetails: { noCacheTokens: 7, cacheReadTokens: 0 },
  outputTokens: 1,
  outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
  totalTokens: 8,
};

describe('attribution', () => {
  it('environment comes from VERCEL_ENV, else development', () => {
    expect(aiEnvironment({ VERCEL_ENV: 'production' })).toBe('production');
    expect(aiEnvironment({})).toBe('development');
  });

  it('gateway user is the profile id, or system:<job> without one; tags keep existing ones', () => {
    const ON = { AI_GATEWAY_REPORTING_TAGS: 'on' };
    expect(usageGatewayFields({ userId: USER, feature: 'food_photo' }, ['nutrition', 'source:photo'], { ...ON, VERCEL_ENV: 'production' })).toEqual({
      user: USER,
      tags: ['nutrition', 'source:photo', 'app:fitcircle', 'env:production', 'feature:food_photo'],
    });
    expect(usageGatewayFields({ userId: null, feature: 'food_embedding_index', job: 'embed-foods' }, undefined, ON).user).toBe('system:embed-foods');
    expect(usageGatewayFields({ userId: null, feature: 'eval' }, undefined, ON).user).toBe('system:eval');
  });

  it('reporting tags are off by default (tag writes are billed); the ledger carries attribution', () => {
    expect(usageGatewayFields({ userId: USER, feature: 'food_photo' }, ['nutrition'], { VERCEL_ENV: 'production' })).toEqual({});
    expect(gatewayCallOptions(undefined, { VERCEL_ENV: 'production' }, { userId: USER, feature: 'fitzy_chat' })).toEqual({ providerOptions: { gateway: { zeroDataRetention: true } } });
    expect(gatewayCallOptions(undefined, { AI_GATEWAY_ZDR: 'false' }, { userId: USER, feature: 'fitzy_chat' })).toEqual({});
  });

  it('gatewayCallOptions adds user + tags only with a usage context (ZDR unchanged)', () => {
    expect(gatewayCallOptions(undefined, {})).toEqual({ providerOptions: { gateway: { zeroDataRetention: true } } });
    expect(gatewayCallOptions(undefined, { AI_GATEWAY_ZDR: 'false', AI_GATEWAY_REPORTING_TAGS: 'on', VERCEL_ENV: 'preview' }, { userId: USER, feature: 'nutrition_coach' })).toEqual({
      providerOptions: { gateway: { user: USER, tags: ['app:fitcircle', 'env:preview', 'feature:nutrition_coach'] } },
    });
  });
});

describe('ledger row', () => {
  it('reads the live gateway metadata (string costs; gatewayCost includes tag-write fees)', () => {
    const row = usageRow({ userId: USER, feature: 'fitzy_chat' }, { model: 'google/gemini-2.5-flash-lite', usage: LIVE_USAGE, providerMetadata: LIVE_META, ok: true, durationMs: 812.4 }, { VERCEL_ENV: 'production' });
    expect(row).toEqual({
      user_id: USER,
      feature: 'fitzy_chat',
      model: 'google/gemini-2.5-flash-lite',
      provider: 'vertex',
      environment: 'production',
      input_tokens: 7,
      output_tokens: 1,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
      cost_usd: 0.0003011,
      market_cost_usd: 0.0000011,
      generation_id: 'gen_01M737901JBM0S4VQFYDB8C0QH',
      ok: true,
      duration_ms: 812,
    });
  });

  it('tolerates missing usage / metadata; embeddings use usage.tokens; non-uuid users are not stored', () => {
    const row = usageRow({ userId: null, feature: 'food_embedding_index' }, { model: 'openai/text-embedding-3-small', usage: { tokens: 12 }, ok: false }, {});
    expect(row).toMatchObject({ user_id: null, input_tokens: 12, output_tokens: null, cost_usd: null, provider: 'openai', environment: 'development', ok: false, duration_ms: null });
    expect(usageRow({ userId: 'zdr-probe', feature: 'eval' }, { model: 'x', ok: true }, {}).user_id).toBeNull();
    // Older metadata without gatewayCost falls back to cost.
    expect(usageRow({ userId: USER, feature: 'food_item' }, { model: 'm', ok: true, providerMetadata: { gateway: { cost: '0.002' } } }, {}).cost_usd).toBe(0.002);
  });
});

describe('recording', () => {
  it('trackAiCall records success with usage + cost, and failures as ok=false, rethrowing', async () => {
    setAiUsageWriter(async (r) => void written.push(r));
    const res = await trackAiCall({ userId: USER, feature: 'food_text' }, 'm', async () => ({ text: 'x', usage: LIVE_USAGE, providerMetadata: LIVE_META }));
    expect(res.text).toBe('x');
    const boom = Object.assign(new Error('no object'), { usage: { inputTokens: 50, outputTokens: 2 } });
    await expect(trackAiCall({ userId: USER, feature: 'food_text' }, 'm', async () => Promise.reject(boom))).rejects.toBe(boom);
    await flush();
    expect(written.map((w) => [w.ok, w.cost_usd, w.input_tokens])).toEqual([
      [true, 0.0003011, 7],
      [false, null, 50],
    ]);
  });

  it('no context → no row; a failing writer never throws into the caller', async () => {
    setAiUsageWriter(async (r) => void written.push(r));
    recordAiUsage(undefined, { model: 'm', ok: true });
    await flush();
    expect(written).toHaveLength(0);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setAiUsageWriter(async () => {
      throw new Error('relation "ai_usage_events" does not exist');
    });
    expect(() => recordAiUsage({ userId: USER, feature: 'body_comp' }, { model: 'm', ok: true })).not.toThrow();
    await flush();
    warn.mockRestore();
  });

  it('embeddings record the call in the ledger without billed gateway tags', async () => {
    setAiUsageWriter(async (r) => void written.push(r));
    await embedTexts(['banana'], { userId: USER, feature: 'food_embedding' });
    await flush();
    expect(sdk.calls[0].providerOptions.gateway).toEqual({ zeroDataRetention: true });
    expect(written[0]).toMatchObject({ feature: 'food_embedding', user_id: USER, input_tokens: 3, cost_usd: 0.00030006, generation_id: 'gen_e' });
  });
});
