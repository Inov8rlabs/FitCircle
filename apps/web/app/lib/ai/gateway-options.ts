/**
 * Vercel AI Gateway options applied to EVERY model call (food, Fitzy, coach, body-comp,
 * embeddings): zero data retention (docs/PRIVACY_COMPLIANCE_SPEC.md §4.5).
 *
 * `providerOptions.gateway.zeroDataRetention: true` makes the gateway route only to provider
 * endpoints with a zero-data-retention agreement, and fail rather than fall back to one without.
 * Controlled by AI_GATEWAY_ZDR: default ON; only the literal 'false' / '0' / 'off' turns it off
 * (an emergency switch, not a default). Pure.
 */
type Env = Record<string, string | undefined>;
type ProviderOptions = Record<string, Record<string, any>>;

export function gatewayZdrEnabled(env: Env = process.env): boolean {
  return !['false', '0', 'off', 'no'].includes((env.AI_GATEWAY_ZDR ?? '').trim().toLowerCase());
}

/** `providerOptions` with the gateway ZDR flag merged in (other providers' options kept). */
export function withGatewayOptions(providerOptions?: ProviderOptions, env: Env = process.env): ProviderOptions | undefined {
  if (!gatewayZdrEnabled(env)) return providerOptions;
  return { ...(providerOptions ?? {}), gateway: { ...(providerOptions?.gateway ?? {}), zeroDataRetention: true } };
}

/** Spread into a generateText / streamText / embed call: `{ ...gatewayCallOptions(existing) }`. */
export function gatewayCallOptions(providerOptions?: ProviderOptions, env: Env = process.env): { providerOptions?: ProviderOptions } {
  const merged = withGatewayOptions(providerOptions, env);
  return merged ? { providerOptions: merged } : {};
}
