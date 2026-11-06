/** Zero data retention on every AI Gateway call (docs/PRIVACY_COMPLIANCE_SPEC.md §4.5). */
import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock('ai', async (orig) => ({
  ...(await orig<any>()),
  generateText: async (o: any) => {
    sdk.calls.push(o);
    return { text: '{"ok":true}', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
  },
  embed: async (o: any) => {
    sdk.calls.push(o);
    return { embedding: [0.1] };
  },
  embedMany: async (o: any) => {
    sdk.calls.push(o);
    return { embeddings: [[0.1]] };
  },
}));

import { embedText, embedTexts } from '../../embeddings';
import { callOptions, generateWithFallback } from '../../fitzy/models';
import { gatewayCallOptions, gatewayZdrEnabled, withGatewayOptions } from '../gateway-options';

const saved = process.env.AI_GATEWAY_ZDR;
afterEach(() => {
  if (saved === undefined) delete process.env.AI_GATEWAY_ZDR;
  else process.env.AI_GATEWAY_ZDR = saved;
  sdk.calls.length = 0;
});

describe('gateway options', () => {
  it('ZDR is on by default; only an explicit false/0/off/no turns it off', () => {
    expect(gatewayZdrEnabled({})).toBe(true);
    expect(gatewayZdrEnabled({ AI_GATEWAY_ZDR: 'true' })).toBe(true);
    for (const v of ['false', 'FALSE', '0', 'off', 'no']) expect(gatewayZdrEnabled({ AI_GATEWAY_ZDR: v })).toBe(false);
  });

  it('merges into existing provider options without dropping them', () => {
    expect(withGatewayOptions({ anthropic: { thinking: { type: 'disabled' } }, gateway: { sort: 'ttft' } }, {})).toEqual({
      anthropic: { thinking: { type: 'disabled' } },
      gateway: { sort: 'ttft', zeroDataRetention: true },
    });
    expect(gatewayCallOptions(undefined, {})).toEqual({ providerOptions: { gateway: { zeroDataRetention: true } } });
    expect(gatewayCallOptions(undefined, { AI_GATEWAY_ZDR: 'false' })).toEqual({});
  });
});

describe('call sites send ZDR', () => {
  it('Fitzy callOptions (Anthropic thinking off + ZDR; Gemini ZDR only)', () => {
    expect(callOptions('anthropic/claude-haiku-5.5', { system: [], messages: [], thinking: false }).providerOptions).toEqual({
      anthropic: { thinking: { type: 'disabled' } },
      gateway: { zeroDataRetention: true },
    });
    expect(callOptions('google/gemini-3.8-flash', { system: [], messages: [] }).providerOptions).toEqual({ gateway: { zeroDataRetention: true } });
  });

  it('generateWithFallback and embeddings pass it through to the SDK', async () => {
    await generateWithFallback({ primary: 'anthropic/claude-haiku-5.5', system: [], messages: [{ role: 'user', content: 'x' }] });
    await embedText('banana');
    await embedTexts(['a']);
    expect(sdk.calls).toHaveLength(3);
    for (const c of sdk.calls) expect(c.providerOptions?.gateway?.zeroDataRetention).toBe(true);
  });

  it('AI_GATEWAY_ZDR=false is an explicit emergency switch', async () => {
    process.env.AI_GATEWAY_ZDR = 'false';
    await embedText('banana');
    expect(sdk.calls[0].providerOptions).toBeUndefined();
  });
});
