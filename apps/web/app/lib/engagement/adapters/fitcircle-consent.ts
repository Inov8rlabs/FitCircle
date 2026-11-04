/**
 * Consent for engagement email, over FitCircle's existing stores (no new
 * column; the most restrictive setting wins, as in ENGAGE_V2_SPEC §10.1):
 *
 *   profiles.preferences.marketingEmails === false        → off (master; shared with campaign emails)
 *   profiles.preferences.engagementEmails[stream] === false → that stream off
 *   profiles.preferences.emailSuppressed                  → off (hard bounce / complaint)
 *   privacy_settings.marketing_enabled === false (row exists) → off
 *   user_consent(consent_type = 'marketing') latest withdrawn/false → off
 *   referral_email_optouts (hash of the address)          → off
 *
 * Absent everywhere = allowed (engagement email is opt-out with one-click
 * unsubscribe, the same policy campaign emails already use). Transactional
 * email (welcome, password reset) never asks this.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { contactHash, normalizeEmail } from '../../services/referral-invite-service';
import { createAdminSupabase } from '../../supabase-admin';

import type { ConsentDecision, ConsentProvider, EmailStream } from './types';

type Db = SupabaseClient<any, any, any>;

export function preferenceDecision(prefs: Record<string, any> | null | undefined, stream: EmailStream): 'allowed' | 'consent' | 'bounced' {
  const p = prefs ?? {};
  if (p.emailSuppressed) return 'bounced';
  if (p.marketingEmails === false) return 'consent';
  if (p.engagementEmails && p.engagementEmails[stream] === false) return 'consent';
  return 'allowed';
}

export class FitCircleConsent implements ConsentProvider {
  constructor(private readonly db: Db = createAdminSupabase() as Db) {}

  async emailAllowed(userId: string, stream: EmailStream): Promise<ConsentDecision> {
    const { data: p, error } = await this.db.from('profiles').select('email, preferences').eq('id', userId).maybeSingle();
    if (error) throw error;
    const email = normalizeEmail((p as any)?.email);
    if (!email) return { allowed: false, reason: 'no_email' };
    const pref = preferenceDecision((p as any)?.preferences, stream);
    if (pref !== 'allowed') return { allowed: false, reason: pref };

    const [privacy, consent, optout] = await Promise.all([
      this.db.from('privacy_settings').select('marketing_enabled').eq('user_id', userId).maybeSingle(),
      this.db
        .from('user_consent')
        .select('consent_given, withdrawn_at')
        .eq('user_id', userId)
        .eq('consent_type', 'marketing')
        .order('consent_timestamp', { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.db.from('referral_email_optouts').select('email_hash').eq('email_hash', contactHash('email', email)).maybeSingle(),
    ]);
    if ((privacy.data as any)?.marketing_enabled === false) return { allowed: false, reason: 'consent' };
    const c = consent.data as { consent_given?: boolean; withdrawn_at?: string | null } | null;
    if (c && (c.consent_given === false || c.withdrawn_at)) return { allowed: false, reason: 'consent' };
    if (optout.data) return { allowed: false, reason: 'consent' };
    return { allowed: true, email };
  }

  private async patchPreferences(userId: string, patch: (prefs: Record<string, any>) => Record<string, any>): Promise<boolean> {
    const { data, error } = await this.db.from('profiles').select('preferences').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!data) return false;
    const prefs = patch({ ...(((data as any).preferences as Record<string, any>) ?? {}) });
    const { error: upErr } = await this.db.from('profiles').update({ preferences: prefs }).eq('id', userId);
    if (upErr) throw upErr;
    return true;
  }

  unsubscribe(userId: string, scope: EmailStream | 'all'): Promise<boolean> {
    return this.patchPreferences(userId, (prefs) =>
      scope === 'all'
        ? { ...prefs, marketingEmails: false }
        : { ...prefs, engagementEmails: { ...(prefs.engagementEmails ?? {}), [scope]: false } }
    );
  }

  async suppressEmail(userId: string, reason: 'bounced' | 'complained'): Promise<void> {
    await this.patchPreferences(userId, (prefs) => ({
      ...prefs,
      emailSuppressed: { reason, at: new Date().toISOString() },
      // A spam complaint is an unsubscribe from everything non-transactional.
      ...(reason === 'complained' ? { marketingEmails: false } : {}),
    }));
  }
}
