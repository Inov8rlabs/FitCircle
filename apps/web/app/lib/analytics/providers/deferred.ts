import type { AnalyticsProperties, AnalyticsProvider } from '../types';

const MAX_PENDING = 200;

/**
 * Base for providers whose SDK is loaded with a dynamic import after consent.
 * Calls made while the SDK is loading are replayed in order once it is ready.
 * Nothing is queued before consent: the facade never calls a provider until then.
 */
export abstract class DeferredProvider<SDK> implements AnalyticsProvider {
  abstract readonly name: string;

  private sdk: SDK | null = null;
  private pending: Array<(sdk: SDK) => void> = [];
  private started = false;
  private failed = false;

  /** Load and initialise the vendor SDK. */
  protected abstract load(): Promise<SDK>;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.load()
      .then((sdk) => {
        this.sdk = sdk;
        const queued = this.pending;
        this.pending = [];
        for (const call of queued) this.safely(call, sdk);
      })
      .catch((error: unknown) => {
        this.failed = true;
        this.pending = [];
        console.warn(`[analytics] ${this.name} failed to load`, error);
      });
  }

  protected run(call: (sdk: SDK) => void): void {
    if (this.failed) return;
    if (this.sdk) {
      this.safely(call, this.sdk);
    } else if (this.pending.length < MAX_PENDING) {
      this.pending.push(call);
    }
  }

  private safely(call: (sdk: SDK) => void, sdk: SDK): void {
    try {
      call(sdk);
    } catch (error) {
      console.warn(`[analytics] ${this.name} call failed`, error);
    }
  }

  abstract track(name: string, properties: AnalyticsProperties): void;
  abstract identify(userId: string, set: AnalyticsProperties, setOnce: AnalyticsProperties): void;
  abstract setUserProperties(set: AnalyticsProperties, setOnce: AnalyticsProperties): void;
  abstract reset(): void;
  abstract flush(): Promise<void> | void;
  abstract setOptOut(optOut: boolean): void;
}
