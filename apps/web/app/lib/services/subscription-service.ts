import { createAdminSupabase } from '../supabase-admin';
import { ComplimentaryGrantService } from './complimentary-grant-service';

/**
 * SubscriptionService — the ONLY code that writes subscription state (MONETIZATION-PLAN.md).
 *
 * RevenueCat is the source of truth for purchases across App Store / Play / Stripe;
 * profiles.subscription_* is our entitlement cache, written exclusively by
 * `processRevenueCatEvent` (called from POST /api/webhooks/revenuecat and the daily
 * reconcile cron). The Stripe webhook never writes entitlement state — it only
 * forwards receipts to RevenueCat, which then emits the events handled here.
 *
 * Guarantees:
 *  - Idempotent: each RevenueCat event id is processed at most once
 *    (subscription_events PK insert is the check).
 *  - Ordered: events older than profiles.subscription_synced_at are skipped.
 *  - Fail-closed identity: app_user_id must be a UUID matching a profile row;
 *    anything else is recorded and skipped (200 to RevenueCat — retrying won't fix it).
 */

/** The subset of a RevenueCat webhook body's `event` object we consume. */
export interface RevenueCatEvent {
  id: string;
  type: string;
  app_user_id: string;
  product_id?: string;
  period_type?: string; // NORMAL | TRIAL | INTRO | PROMOTIONAL
  event_timestamp_ms?: number;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  grace_period_expiration_at_ms?: number | null;
  store?: string; // APP_STORE | MAC_APP_STORE | PLAY_STORE | STRIPE | PROMOTIONAL | AMAZON
  environment?: string; // SANDBOX | PRODUCTION
  cancel_reason?: string; // UNSUBSCRIBE | BILLING_ERROR | DEVELOPER_INITIATED | PRICE_INCREASE | CUSTOMER_SUPPORT | UNKNOWN
  new_product_id?: string;
  price?: number | null; // USD
  price_in_purchased_currency?: number | null;
  currency?: string | null;
  transaction_id?: string | null;
  transferred_from?: string[];
  transferred_to?: string[];
}

export type ProcessOutcome =
  | 'applied'
  | 'already_processed'
  | 'stale_event'
  | 'unknown_user'
  | 'ignored';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RevenueCatState {
  active: boolean;
  trialing: boolean;
  expiresAt: string | null;
  willRenew: boolean;
  platform: 'app_store' | 'play_store' | 'stripe' | 'promotional' | null;
  productId: string | null;
}

function mapStore(store: string | undefined): string | null {
  switch (store) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
      return 'play_store';
    case 'STRIPE':
      return 'stripe';
    case 'PROMOTIONAL':
      return 'promotional';
    default:
      return null;
  }
}

function toIso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

interface EntitlementPatch {
  subscription_tier?: 'free' | 'premium';
  subscription_status?: 'trialing' | 'active' | 'cancelled' | 'past_due';
  subscription_expires_at?: string | null;
  subscription_will_renew?: boolean;
  subscription_platform?: string | null;
  subscription_product_id?: string | null;
}

interface PaymentInsert {
  amount: number;
  status: 'succeeded' | 'refunded';
  type: 'subscription' | 'refund';
  description: string;
}

export class SubscriptionService {
  /**
   * Apply one RevenueCat webhook event. Returns the outcome (all outcomes except
   * transient DB failures should be answered with HTTP 200 so RevenueCat stops retrying).
   * With `apply: false` the event is recorded for audit but no state changes
   * (used for SANDBOX events reaching production).
   */
  static async processRevenueCatEvent(
    event: RevenueCatEvent,
    options: { apply?: boolean } = {}
  ): Promise<ProcessOutcome> {
    const apply = options.apply !== false;
    const supabase = createAdminSupabase();

    // 0. Resolve the subject user up front. subscription_events.user_id has a FK to
    // profiles, so an app_user_id that is not (or no longer) a profile — RevenueCat's
    // "send test event" uses a random UUID — must be recorded with user_id = null
    // rather than failing the insert.
    const profile = UUID_RE.test(event.app_user_id)
      ? (
          await supabase
            .from('profiles')
            .select('id, subscription_synced_at')
            .eq('id', event.app_user_id)
            .maybeSingle()
        ).data
      : null;

    // 1. Idempotency: the PK insert is the check. A duplicate delivery conflicts and we stop.
    const { error: insertError } = await supabase.from('subscription_events').insert({
      id: event.id,
      user_id: profile?.id ?? null,
      type: event.type,
      store: event.store ?? null,
      environment: event.environment ?? null,
      event_timestamp: toIso(event.event_timestamp_ms),
      raw: event,
    });
    if (insertError) {
      if (insertError.code === '23505') return 'already_processed'; // unique_violation
      throw new Error(`subscription_events insert failed: ${insertError.message}`);
    }

    if (!apply || event.type === 'TEST') return 'ignored';

    // TRANSFER moves entitlements between app_user_ids and has no single subject user.
    if (event.type === 'TRANSFER') {
      return this.applyTransfer(event);
    }

    // 2. Resolve the user. app_user_id is always our profiles.id (clients call logIn(userId)
    // before purchase); anonymous RevenueCat ids ($RCAnonymousID:...) are recorded + skipped.
    if (!UUID_RE.test(event.app_user_id)) {
      console.warn('[SubscriptionService] non-UUID app_user_id, skipping:', event.app_user_id, event.type);
      return 'unknown_user';
    }
    if (!profile) {
      console.warn('[SubscriptionService] no profile for app_user_id, skipping:', event.app_user_id);
      return 'unknown_user';
    }

    // 3. Out-of-order guard: never apply an event older than what we've already applied.
    const eventIso = toIso(event.event_timestamp_ms);
    if (
      eventIso &&
      profile.subscription_synced_at &&
      new Date(eventIso).getTime() <= new Date(profile.subscription_synced_at).getTime()
    ) {
      return 'stale_event';
    }

    // 4. Map event type → entitlement patch (+ optional payments row).
    const mapped = this.mapEvent(event);
    if (!mapped) return 'ignored';

    const { patch, payment } = mapped;
    // A backend-issued complimentary grant outranks any store downgrade
    // (expiration, cancellation, refund): re-pin the grant and only record the
    // payment row, never drop the user to free.
    if (patch.subscription_tier === 'free' && (await ComplimentaryGrantService.holdIfGranted(profile.id))) {
      console.log('[SubscriptionService] downgrade held by complimentary grant:', profile.id, event.type);
      return 'applied';
    }
    // Strip undefined keys — they mean "leave unchanged", never "overwrite with null".
    const update: Record<string, unknown> = {
      subscription_synced_at: eventIso ?? new Date().toISOString(),
    };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) update[key] = value;
    }
    const { error: updateError } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', profile.id);
    if (updateError) throw new Error(`profiles update failed: ${updateError.message}`);

    if (payment) {
      const { error: paymentError } = await supabase.from('payments').insert({
        user_id: profile.id,
        amount: payment.amount,
        currency: event.currency ?? 'USD',
        status: payment.status,
        type: payment.type,
        description: payment.description,
        processed_at: toIso(event.purchased_at_ms) ?? new Date().toISOString(),
        metadata: {
          rc_event_id: event.id,
          rc_event_type: event.type,
          store: event.store ?? null,
          product_id: event.product_id ?? null,
          period_type: event.period_type ?? null,
          transaction_id: event.transaction_id ?? null,
        },
      });
      // A payments failure shouldn't lose the entitlement write; log loudly instead.
      if (paymentError) {
        console.error('[SubscriptionService] payments insert failed:', paymentError.message, event.id);
      }
    }

    return 'applied';
  }

  /**
   * The event-mapping table (see docs plan §A Phase 1). Returns null for event
   * types we deliberately ignore.
   */
  private static mapEvent(
    event: RevenueCatEvent
  ): { patch: EntitlementPatch; payment: PaymentInsert | null } | null {
    const platform = mapStore(event.store);
    const expiresAt = toIso(event.expiration_at_ms);
    const price = typeof event.price === 'number' ? event.price : 0;
    const common = {
      subscription_platform: platform,
      subscription_product_id: event.product_id ?? null,
    };

    switch (event.type) {
      case 'INITIAL_PURCHASE': {
        const isTrial = event.period_type === 'TRIAL';
        return {
          patch: {
            ...common,
            subscription_tier: 'premium',
            subscription_status: isTrial ? 'trialing' : 'active',
            subscription_expires_at: expiresAt,
            subscription_will_renew: true,
          },
          payment: {
            amount: isTrial ? 0 : price,
            status: 'succeeded',
            type: 'subscription',
            description: isTrial ? 'Pro trial started' : 'Pro subscription started',
          },
        };
      }

      case 'RENEWAL':
        return {
          patch: {
            ...common,
            subscription_tier: 'premium',
            subscription_status: 'active',
            subscription_expires_at: expiresAt,
            subscription_will_renew: true,
          },
          payment: {
            amount: price,
            status: 'succeeded',
            type: 'subscription',
            description: 'Pro subscription renewed',
          },
        };

      case 'CANCELLATION': {
        // UNSUBSCRIBE = auto-renew turned off: access is retained until expiry
        // (EXPIRATION downgrades later). Refund-shaped reasons downgrade immediately.
        const isRefund =
          event.cancel_reason === 'CUSTOMER_SUPPORT' || event.cancel_reason === 'DEVELOPER_INITIATED';
        if (!isRefund) {
          return { patch: { subscription_will_renew: false }, payment: null };
        }
        return {
          patch: {
            ...common,
            subscription_tier: 'free',
            subscription_status: 'cancelled',
            subscription_expires_at: new Date().toISOString(),
            subscription_will_renew: false,
          },
          payment: {
            amount: price,
            status: 'refunded',
            type: 'refund',
            description: 'Pro subscription refunded',
          },
        };
      }

      case 'UNCANCELLATION':
        return { patch: { subscription_will_renew: true }, payment: null };

      case 'EXPIRATION':
        return {
          patch: {
            subscription_tier: 'free',
            subscription_status: 'cancelled',
            subscription_will_renew: false,
          },
          payment: null,
        };

      case 'BILLING_ISSUE':
        return {
          patch: {
            subscription_status: 'past_due',
            subscription_will_renew: true,
            // While in grace the store keeps access alive until this date.
            subscription_expires_at: toIso(event.grace_period_expiration_at_ms) ?? undefined,
          },
          payment: null,
        };

      case 'PRODUCT_CHANGE':
        // Takes effect at next renewal (a RENEWAL event follows); record the pending product.
        return {
          patch: {
            subscription_product_id: event.new_product_id ?? event.product_id ?? null,
            subscription_will_renew: true,
          },
          payment: null,
        };

      case 'NON_RENEWING_PURCHASE':
        // Lifetime: premium forever (expires_at NULL), nothing to renew.
        return {
          patch: {
            ...common,
            subscription_tier: 'premium',
            subscription_status: 'active',
            subscription_expires_at: null,
            subscription_will_renew: false,
          },
          payment: {
            amount: price,
            status: 'succeeded',
            type: 'subscription',
            description: 'Pro lifetime purchased',
          },
        };

      case 'SUBSCRIPTION_PAUSED':
        return { patch: { subscription_will_renew: false }, payment: null };

      default:
        return null;
    }
  }

  /**
   * TRANSFER: entitlements moved between RevenueCat app_user_ids (e.g. the same
   * store account restored purchases into a second FitCircle account). The losing
   * side downgrades; the gaining side is recomputed from RevenueCat's REST API so
   * exactly one profile ends up Pro.
   */
  private static async applyTransfer(event: RevenueCatEvent): Promise<ProcessOutcome> {
    const supabase = createAdminSupabase();
    const from = (event.transferred_from ?? []).filter((id) => UUID_RE.test(id));
    const to = (event.transferred_to ?? []).filter((id) => UUID_RE.test(id));

    for (const userId of from) {
      // A complimentary grant on the source account survives the transfer.
      if (await ComplimentaryGrantService.holdIfGranted(userId)) continue;
      await supabase
        .from('profiles')
        .update({
          subscription_tier: 'free',
          subscription_status: 'cancelled',
          subscription_will_renew: false,
          subscription_synced_at: toIso(event.event_timestamp_ms) ?? new Date().toISOString(),
        })
        .eq('id', userId);
    }
    for (const userId of to) {
      await this.syncFromRevenueCat(userId);
    }
    return 'applied';
  }

  /**
   * Pull a user's current state from the RevenueCat REST API (v2) and re-apply
   * it. Used for TRANSFER targets, the daily reconcile cron, and the mobile
   * post-purchase sync fallback.
   *
   * Requires REVENUECAT_SECRET_API_KEY (a v2 secret key, `sk_…`) and
   * REVENUECAT_PROJECT_ID (`proj…`). The entitlement is matched by lookup key
   * (REVENUECAT_ENTITLEMENT, default "fitcircle_pro"). A customer RevenueCat has never
   * seen is simply free.
   */
  static async syncFromRevenueCat(userId: string): Promise<void> {
    const state = await this.fetchRevenueCatState(userId);
    const supabase = createAdminSupabase();
    const now = new Date().toISOString();

    if (!state.active) {
      // No store subscription — but a complimentary grant keeps the user premium.
      if (await ComplimentaryGrantService.holdIfGranted(userId)) return;
      await supabase
        .from('profiles')
        .update({
          subscription_tier: 'free',
          subscription_status: 'cancelled',
          subscription_will_renew: false,
          subscription_synced_at: now,
        })
        .eq('id', userId);
      return;
    }

    await supabase
      .from('profiles')
      .update({
        subscription_tier: 'premium',
        subscription_status: state.trialing ? 'trialing' : 'active',
        subscription_expires_at: state.expiresAt,
        subscription_will_renew: state.willRenew,
        subscription_platform: state.platform,
        subscription_product_id: state.productId,
        subscription_synced_at: now,
      })
      .eq('id', userId);
  }

  /**
   * Resolve the user's Pro state from RevenueCat v2: active subscriptions
   * (status trialing/active/in_grace_period/in_billing_retry give access) or an
   * unrevoked one-time purchase, filtered to the entitlement we care about.
   */
  static async fetchRevenueCatState(userId: string): Promise<RevenueCatState> {
    const apiKey = process.env.REVENUECAT_SECRET_API_KEY;
    const projectId = process.env.REVENUECAT_PROJECT_ID;
    if (!apiKey) throw new Error('REVENUECAT_SECRET_API_KEY is not configured');
    if (!projectId) throw new Error('REVENUECAT_PROJECT_ID is not configured');
    const entitlementKey = process.env.REVENUECAT_ENTITLEMENT || 'fitcircle_pro';
    const base = `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}`;
    const headers = { Authorization: `Bearer ${apiKey}` };
    const free: RevenueCatState = { active: false, trialing: false, expiresAt: null, willRenew: false, platform: null, productId: null };

    const get = async (path: string): Promise<any | null> => {
      const res = await fetch(`${base}${path}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`RevenueCat v2 ${path} failed: ${res.status}`);
      return res.json();
    };

    // RevenueCat customer ids are CASE-SENSITIVE and the apps log in with the
    // profile uuid in different casings (iOS uses UUID().uuidString = upper).
    // Resolve whichever casing RevenueCat knows; an unknown customer is free.
    const customerPath = await this.resolveCustomerPath(userId, get);
    if (!customerPath) return { ...free };

    // Subscriptions/purchases embed their entitlements inline; `expand` is not
    // supported on these endpoints (400).
    const [subs, purchases, products] = await Promise.all([
      get(`${customerPath}/subscriptions?limit=100`),
      get(`${customerPath}/purchases?limit=100`),
      get('/products?limit=100'),
    ]);

    const storeIdOf = (rcProductId: string | null | undefined): string | null => {
      const hit = (products?.items ?? []).find((p: any) => p.id === rcProductId);
      return hit?.store_identifier ?? rcProductId ?? null;
    };
    const grants = (item: any): boolean =>
      Array.isArray(item?.entitlements?.items) &&
      item.entitlements.items.some((e: any) => e.lookup_key === entitlementKey);

    // Lifetime: an unrevoked one-time purchase for the entitlement.
    const lifetime = (purchases?.items ?? []).find((p: any) => !p.revoked_at && grants(p));
    if (lifetime) {
      return {
        active: true,
        trialing: false,
        expiresAt: null,
        willRenew: false,
        platform: mapStore(String(lifetime.store ?? '').toUpperCase()) as RevenueCatState['platform'],
        productId: storeIdOf(lifetime.product_id),
      };
    }

    const ACCESS = new Set(['trialing', 'active', 'in_grace_period', 'in_billing_retry']);
    const live = (subs?.items ?? [])
      .filter((s: any) => grants(s) && (s.gives_access === true || ACCESS.has(s.status)))
      .sort((a: any, b: any) => (b.current_period_ends_at ?? 0) - (a.current_period_ends_at ?? 0));
    const sub = live[0];
    if (!sub) return { ...free };

    const endsMs: number | null = typeof sub.current_period_ends_at === 'number' ? sub.current_period_ends_at : null;
    return {
      active: true,
      trialing: sub.status === 'trialing',
      expiresAt: endsMs ? new Date(endsMs).toISOString() : null,
      willRenew: ['will_renew', 'will_change_product', 'has_already_renewed'].includes(sub.auto_renewal_status),
      platform: mapStore(String(sub.store ?? '').toUpperCase()) as RevenueCatState['platform'],
      productId: storeIdOf(sub.product_id),
    };
  }

  /** Try the id as given, then upper- and lower-case; returns the customer path or null. */
  private static async resolveCustomerPath(
    userId: string,
    get: (path: string) => Promise<any | null>
  ): Promise<string | null> {
    const candidates = [...new Set([userId, userId.toUpperCase(), userId.toLowerCase()])];
    for (const id of candidates) {
      const customer = await get(`/customers/${encodeURIComponent(id)}`);
      if (customer) return `/customers/${encodeURIComponent(id)}`;
    }
    return null;
  }

}
