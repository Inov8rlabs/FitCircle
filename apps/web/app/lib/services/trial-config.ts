/**
 * Resolves the live Pro free-trial length (remote config `trial_days`, lib/config/trial.ts).
 * Never throws: any failure → the code default.
 */
import { DEFAULT_TRIAL_DAYS, normalizeTrialDays } from '../config/trial';
import type { RcPlatform } from '../remote-config/audience';
import { RemoteConfigService } from '../remote-config/service';

export class TrialConfig {
  /**
   * Trial days for one user. `platform` undefined = take it from the current request's
   * headers (X-App-Platform), as every remote-config read does.
   */
  static async days(userId: string, opts: { platform?: RcPlatform | null } = {}): Promise<number> {
    try {
      const v = await RemoteConfigService.value('trial_days', { userId, ...(opts.platform !== undefined ? { platform: opts.platform } : {}) });
      return normalizeTrialDays(v);
    } catch {
      return DEFAULT_TRIAL_DAYS;
    }
  }

  /** The Stripe web checkout trial (platform 'web'). */
  static webDays(userId: string): Promise<number> {
    return this.days(userId, { platform: 'web' });
  }

  /**
   * For copy sent OUTSIDE a request (cron pushes) to a mobile user whose platform we don't know:
   * the SHORTER of the iOS and Android values, so a push never promises more days than the
   * store will give while the two store offers differ.
   */
  static async mobileDays(userId: string): Promise<number> {
    const [ios, android] = await Promise.all([this.days(userId, { platform: 'ios' }), this.days(userId, { platform: 'android' })]);
    return Math.min(ios, android);
  }
}
