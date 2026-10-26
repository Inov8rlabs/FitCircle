/**
 * Promo kill switches (ACTIVATION_JOURNEY_SPEC §8, PROMO_CARD_SPEC §13).
 *
 *  PROMOS_ENABLED        default OFF. Only "true" | "1" | "on" | "yes" turns
 *                        promo@1 cards on. Off → no promo cards, and the legacy
 *                        cards (pro_upsell, …) come back for every client.
 *  PROMOS_DISABLED_KEYS  comma list of promo keys to pause (e.g. "pro_value").
 *                        Pausing pro_value also returns pro_upsell to promo@1
 *                        clients.
 */
type Env = Record<string, string | undefined>;

const ON = new Set(['true', '1', 'on', 'yes']);

export interface PromosConfig {
  enabled: boolean;
  disabledKeys: Set<string>;
}

export function promosConfig(env: Env = process.env): PromosConfig {
  return {
    enabled: ON.has((env.PROMOS_ENABLED ?? '').trim().toLowerCase()),
    disabledKeys: new Set(
      (env.PROMOS_DISABLED_KEYS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  };
}

export function isPromoLive(key: string, cfg: PromosConfig): boolean {
  return cfg.enabled && !cfg.disabledKeys.has(key);
}
