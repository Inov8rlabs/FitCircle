/**
 * Live probe: every model FitCircle uses still answers through the Vercel AI Gateway with
 * zero data retention on (lib/ai/gateway-options.ts; docs/PRIVACY_COMPLIANCE_SPEC.md §4.5).
 *
 *   cd apps/web && npx -y tsx scripts/ai-zdr-probe.ts   (AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN in .env.local,
 *   or ZDR_PROBE_ENV_FILE=<file from `vercel env pull`>)
 *
 * Minimal synthetic prompts only (no user data). For each model: a text call and, for vision
 * models, a call with a generated 64x64 PNG, both with providerOptions.gateway.zeroDataRetention.
 * A model that fails under ZDR is retried once WITHOUT ZDR to tell "not ZDR-capable" apart from
 * "model down". Prints the provider the gateway routed to when it reports one.
 */

import { Output, embed, generateText } from 'ai';
import { config } from 'dotenv';
import sharp from 'sharp';
import { z } from 'zod';

import { withGatewayOptions } from '../app/lib/ai/gateway-options';
import { generateWithFallback, systemMessages } from '../app/lib/fitzy/models';

// Env is read at call time by the AI SDK, so loading it after the (hoisted) imports is fine.
config({ path: process.env.ZDR_PROBE_ENV_FILE || '.env.local', quiet: true } as any);

const MODELS: Array<{ id: string; usedFor: string; vision?: boolean }> = [
  { id: process.env.NUTRITION_VISION_MODEL?.trim() || 'google/gemini-3.8-flash', usedFor: 'food photo/text primary (prod NUTRITION_VISION_MODEL)', vision: true },
  { id: process.env.NUTRITION_FALLBACK_MODEL?.trim() || 'anthropic/claude-haiku-5.5', usedFor: 'food fallback (prod NUTRITION_FALLBACK_MODEL); Fitzy chat; grounding picker', vision: true },
  { id: 'anthropic/claude-sonnet-5.5', usedFor: 'Fitzy deep (plans, recap)' },
  { id: 'anthropic/claude-sonnet-4.6', usedFor: 'voice parse, nutrition coach, body-comp escalation', vision: true },
  { id: 'anthropic/claude-haiku-4.5', usedFor: 'estimate-item, body-comp primary (code default vision)', vision: true },
  { id: 'google/gemini-3-flash', usedFor: 'code default food fallback (overridden in prod)' },
];
const EMBEDDING = 'openai/text-embedding-3-small'; // off in prod (NUTRITION_SEMANTIC_MATCH unset)

const routedTo = (meta: any): string | null => {
  const g = meta?.gateway;
  return g?.routing?.finalProvider ?? g?.routing?.resolvedProvider ?? null;
};

/** Tagged as eval spend (gateway user system:zdr-probe, feature:eval, env:development). */
const PROBE_USAGE = { userId: null, feature: 'eval', job: 'zdr-probe' } as const;

async function text(model: string, zdr: boolean) {
  const res = await generateText({
    model,
    prompt: 'Reply with exactly the word OK.',
    maxOutputTokens: 200,
    providerOptions: withGatewayOptions({}, { AI_GATEWAY_ZDR: zdr ? 'true' : 'false' }, PROBE_USAGE) ?? {},
    abortSignal: AbortSignal.timeout(60_000),
  });
  return { ok: /ok/i.test(res.text ?? ''), provider: routedTo(res.providerMetadata), text: (res.text ?? '').slice(0, 20) };
}

async function vision(model: string, png: Buffer) {
  const res = await generateText({
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'What single colour fills this image? One word.' }, { type: 'image', image: png, mediaType: 'image/png' }] }],
    maxOutputTokens: 200,
    providerOptions: withGatewayOptions({}, { AI_GATEWAY_ZDR: 'true' }, PROBE_USAGE),
    abortSignal: AbortSignal.timeout(60_000),
  });
  return { ok: (res.text ?? '').trim().length > 0, provider: routedTo(res.providerMetadata), text: (res.text ?? '').trim().slice(0, 20) };
}

async function main() {
  // Gateway auth: AI_GATEWAY_API_KEY, or a Vercel OIDC token (`vercel env pull` gives a fresh one).
  if (!process.env.AI_GATEWAY_API_KEY) delete process.env.AI_GATEWAY_API_KEY;
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) throw new Error('No AI Gateway credentials (AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN)');
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 30, b: 30 } } }).png().toBuffer();
  const rows: string[] = [];
  for (const m of MODELS) {
    for (const kind of m.vision ? (['text', 'vision'] as const) : (['text'] as const)) {
      try {
        const r = kind === 'text' ? await text(m.id, true) : await vision(m.id, png);
        rows.push(`PASS  ${m.id} [${kind}, ZDR] → "${r.text}"${r.provider ? ` via ${r.provider}` : ''}  (${m.usedFor})`);
      } catch (err: any) {
        let without = 'not retried';
        if (kind === 'text') {
          try {
            await text(m.id, false);
            without = 'WORKS without ZDR → model/provider not ZDR-capable';
          } catch (e2: any) {
            without = `also fails without ZDR (${String(e2?.message ?? e2).slice(0, 80)})`;
          }
        }
        rows.push(`FAIL  ${m.id} [${kind}, ZDR]: ${String(err?.message ?? err).slice(0, 160)} | ${without}  (${m.usedFor})`);
      }
    }
  }
  // Real production call builders: Fitzy (thinking off + gateway ZDR merged) and a structured
  // output call shaped like the food path (gateway sort/user/tags + ZDR).
  try {
    const r = await generateWithFallback({ primary: 'anthropic/claude-haiku-5.5', system: systemMessages('Reply with only JSON {"ok":true}.'), messages: [{ role: 'user', content: 'go' }], maxOutputTokens: 100, thinking: false, usage: PROBE_USAGE });
    rows.push(`PASS  fitzy generateWithFallback (thinking off + ZDR) → ${r.model}: ${r.text.slice(0, 20)}`);
  } catch (err: any) {
    rows.push(`FAIL  fitzy generateWithFallback: ${String(err?.message ?? err).slice(0, 160)}`);
  }
  for (const model of [MODELS[0].id, MODELS[1].id]) {
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: z.object({ food: z.string(), calories: z.number() }) }),
        prompt: 'A medium banana. Return its name and approximate calories.',
        maxOutputTokens: 2000,
        providerOptions: withGatewayOptions({ gateway: { sort: 'ttft', tags: ['probe'] } }, { AI_GATEWAY_ZDR: 'true' }, PROBE_USAGE),
      });
      rows.push(`PASS  ${model} [structured, gateway opts + ZDR] → ${JSON.stringify(output)}`);
    } catch (err: any) {
      rows.push(`FAIL  ${model} [structured]: ${String(err?.message ?? err).slice(0, 160)}`);
    }
  }
  try {
    const { embedding } = await embed({ model: EMBEDDING, value: 'banana', providerOptions: withGatewayOptions({}, { AI_GATEWAY_ZDR: 'true' }, PROBE_USAGE) });
    rows.push(`PASS  ${EMBEDDING} [embed, ZDR] → ${embedding.length} dims  (food semantic match; off in prod)`);
  } catch (err: any) {
    rows.push(`FAIL  ${EMBEDDING} [embed, ZDR]: ${String(err?.message ?? err).slice(0, 160)}  (food semantic match; off in prod)`);
  }
  console.log(rows.join('\n'));
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
