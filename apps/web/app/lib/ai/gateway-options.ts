/**
 * Vercel AI Gateway options applied to EVERY model call (food, Fitzy, coach, body-comp,
 * embeddings): zero data retention (docs/PRIVACY_COMPLIANCE_SPEC.md §4.5).
 *
 * `providerOptions.gateway.zeroDataRetention: true` makes the gateway route only to provider
 * endpoints with a zero-data-retention agreement, and fail rather than fall back to one without.
 * Controlled by AI_GATEWAY_ZDR: default ON; only the literal 'false' / '0' / 'off' turns it off
 * (an emergency switch, not a default). Pure.
 */
import { type AiUsageContext, usageGatewayFields } from './usage';

type Env = Record<string, string | undefined>;
type ProviderOptions = Record<string, Record<string, any>>;

export function gatewayZdrEnabled(env: Env = process.env): boolean {
  return !['false', '0', 'off', 'no'].includes((env.AI_GATEWAY_ZDR ?? '').trim().toLowerCase());
}

/**
 * `providerOptions` with the gateway ZDR flag merged in (other providers' options kept). With a
 * usage context, also the gateway `user` + reporting tags (lib/ai/usage.ts; existing tags kept).
 */
export function withGatewayOptions(providerOptions?: ProviderOptions, env: Env = process.env, usage?: AiUsageContext | null): ProviderOptions | undefined {
  const zdr = gatewayZdrEnabled(env);
  const fields = usage ? usageGatewayFields(usage, providerOptions?.gateway?.tags, env) : {};
  if (!zdr && !fields.user && !fields.tags) return providerOptions;
  const gateway = { ...(providerOptions?.gateway ?? {}) };
  if (zdr) gateway.zeroDataRetention = true;
  Object.assign(gateway, fields);
  return { ...(providerOptions ?? {}), gateway };
}

/**
 * Spread into a generateText / streamText / embed call: `{ ...gatewayCallOptions(existing, env, usage) }`.
 * Every production call passes its AiUsageContext (aiCallOptions below).
 */
export function gatewayCallOptions(providerOptions?: ProviderOptions, env: Env = process.env, usage?: AiUsageContext | null): { providerOptions?: ProviderOptions } {
  const merged = withGatewayOptions(providerOptions, env, usage);
  return merged ? { providerOptions: merged } : {};
}

/** gatewayCallOptions with the usage context first (the common call-site form). */
export function aiCallOptions(usage: AiUsageContext | null | undefined, providerOptions?: ProviderOptions): { providerOptions?: ProviderOptions } {
  return gatewayCallOptions(providerOptions, process.env, usage);
}
