import { readAnalyticsConsent } from './consent';
import {
  ANALYTICS_EVENT_NAMES,
  USER_PROPERTIES_SET_ONCE,
  type AnalyticsEventPayload,
  type AnalyticsUserProperties,
} from './events.generated';
import { sanitizeProperties } from './privacy';
import type { AnalyticsGlobalProperties, AnalyticsProperties, AnalyticsProvider } from './types';

export interface AnalyticsClientOptions {
  /** Builds the enabled providers. Called once, on the first consented use. */
  createProviders: () => AnalyticsProvider[];
  globals: AnalyticsGlobalProperties;
  /** Reads the stored consent choice (defaults to the fc_consent cookie). */
  readConsent?: () => boolean;
  /** Server/SSR guard. Defaults to `typeof window !== 'undefined'`. */
  isBrowser?: () => boolean;
  /** Logs events missing from the tracking plan (development builds). */
  debug?: boolean;
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set(ANALYTICS_EVENT_NAMES);
const SET_ONCE_KEYS: ReadonlySet<string> = new Set(USER_PROPERTIES_SET_ONCE);

interface Identity {
  userId: string;
  set: AnalyticsProperties;
  setOnce: AnalyticsProperties;
}

/**
 * Provider-agnostic analytics facade (analytics/README.md).
 *
 * Consent (GDPR): providers are not constructed, started or called until the
 * visitor has granted analytics consent. Events tracked before that are
 * dropped, never queued. Revoking consent opts every started provider out.
 * The only thing remembered pre-consent is the signed-in user's identity (in
 * memory), so a mid-session grant attributes later events to the right user.
 */
export class AnalyticsClient {
  private providers: AnalyticsProvider[] | null = null;
  private consent: boolean | null = null;
  private identity: Identity | null = null;

  constructor(private readonly options: AnalyticsClientOptions) {}

  private get isBrowser(): boolean {
    return this.options.isBrowser ? this.options.isBrowser() : typeof window !== 'undefined';
  }

  /** Reads stored consent on first use and starts providers if granted. */
  private ensureBootstrapped(): void {
    if (this.consent !== null || !this.isBrowser) return;
    const read = this.options.readConsent ?? (() => readAnalyticsConsent());
    this.consent = read();
    if (this.consent) this.startProviders();
  }

  private startProviders(): void {
    if (this.providers) return;
    this.providers = [];
    let created: AnalyticsProvider[] = [];
    try {
      created = this.options.createProviders();
    } catch (error) {
      console.warn('[analytics] provider setup failed', error);
    }
    for (const provider of created) {
      try {
        provider.start();
        this.providers.push(provider);
      } catch (error) {
        console.warn(`[analytics] ${provider.name} failed to start`, error);
      }
    }
    if (this.identity) {
      const { userId, set, setOnce } = this.identity;
      this.fanOut((p) => p.identify(userId, set, setOnce));
    }
  }

  /** Returns true when events may be sent right now. */
  private get active(): boolean {
    this.ensureBootstrapped();
    return this.consent === true && this.providers !== null;
  }

  private fanOut(call: (provider: AnalyticsProvider) => void): void {
    for (const provider of this.providers ?? []) {
      try {
        call(provider);
      } catch (error) {
        console.warn(`[analytics] ${provider.name} call failed`, error);
      }
    }
  }

  /** Call once on app start; re-reads the consent cookie. Safe to call repeatedly. */
  init(): void {
    this.ensureBootstrapped();
  }

  get hasConsent(): boolean {
    this.ensureBootstrapped();
    return this.consent === true;
  }

  track(payload: AnalyticsEventPayload): void {
    if (!this.isBrowser) return;
    if (this.options.debug && !KNOWN_EVENTS.has(payload.name)) {
      console.error(`[analytics] "${payload.name}" is not in analytics/tracking-plan.json`);
    }
    if (!this.active) return; // pre-consent events are dropped, not queued
    const properties = { ...sanitizeProperties(payload.properties), ...this.options.globals };
    this.fanOut((p) => p.track(payload.name, properties));
  }

  /**
   * Associates events with the FitCircle profile UUID. Call on sign-up, login
   * and session restore BEFORE the matching Completed event.
   */
  identify(userId: string, userProperties: AnalyticsUserProperties = {}): void {
    if (!this.isBrowser || !userId) return;
    const { set, setOnce } = splitUserProperties(userProperties);
    const sameUser = this.identity?.userId === userId;
    this.identity = {
      userId,
      set: { ...(sameUser ? this.identity?.set : {}), ...set },
      setOnce: { ...(sameUser ? this.identity?.setOnce : {}), ...setOnce },
    };
    if (!this.active) return;
    this.fanOut((p) => p.identify(userId, set, setOnce));
  }

  setUserProperties(userProperties: AnalyticsUserProperties): void {
    if (!this.isBrowser) return;
    const { set, setOnce } = splitUserProperties(userProperties);
    if (this.identity) {
      this.identity = {
        ...this.identity,
        set: { ...this.identity.set, ...set },
        setOnce: { ...this.identity.setOnce, ...setOnce },
      };
    }
    if (!this.active) return;
    this.fanOut((p) => p.setUserProperties(set, setOnce));
  }

  /** The currently identified user id (in memory), if any. */
  get userId(): string | null {
    return this.identity?.userId ?? null;
  }

  /** Logout: track `Logout` first, then call reset(). */
  reset(): void {
    if (!this.isBrowser) return;
    this.identity = null;
    if (!this.active) return;
    this.fanOut((p) => p.reset());
  }

  flush(): void {
    if (!this.isBrowser || !this.active) return;
    this.fanOut((p) => void p.flush());
  }

  /**
   * The consent switch. `false` (consent granted) starts providers on first
   * grant or opts them back in; `true` (revoked) opts every started provider
   * out and drops all later events.
   */
  setOptOut(optOut: boolean): void {
    if (!this.isBrowser) return;
    this.consent = !optOut;
    if (optOut) {
      this.fanOut((p) => p.setOptOut(true));
      return;
    }
    if (this.providers) {
      this.fanOut((p) => p.setOptOut(false));
    } else {
      this.startProviders();
    }
  }
}

/** Splits canonical user properties into $set and $set_once and applies the privacy backstop. */
export function splitUserProperties(userProperties: AnalyticsUserProperties): {
  set: AnalyticsProperties;
  setOnce: AnalyticsProperties;
} {
  const clean = sanitizeProperties(userProperties as Record<string, unknown>);
  const set: AnalyticsProperties = {};
  const setOnce: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(clean)) {
    if (SET_ONCE_KEYS.has(key)) setOnce[key] = value;
    else set[key] = value;
  }
  return { set, setOnce };
}
