/**
 * Test-device signal from the apps. The Android app sends `X-Test-Device: 1`
 * on every API request when it detects Firebase Test Lab (Google Play
 * pre-launch / review robots). Sign-in and onboarding routes record it once in
 * profiles.metadata.test_device so lifecycle jobs (OnboardingNudgeService) can
 * leave those accounts alone. No migration: profiles.metadata is server-owned
 * jsonb (see ConversionMilestoneService). Never throws.
 */
import { createAdminSupabase } from '../supabase-admin';

export const TEST_DEVICE_HEADER = 'x-test-device';

/** `X-Test-Device: 1` (also accepts `true`). */
export function isTestDeviceRequest(headers: Pick<Headers, 'get'>): boolean {
  const v = (headers.get(TEST_DEVICE_HEADER) ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** Flag the account when the request carries the header. Returns whether it is flagged now. */
export async function recordTestDeviceSignal(userId: string | null | undefined, headers: Pick<Headers, 'get'>): Promise<boolean> {
  if (!userId || !isTestDeviceRequest(headers)) return false;
  try {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('profiles').select('metadata').eq('id', userId).maybeSingle();
    if (error || !data) return false;
    const metadata = ((data as { metadata?: Record<string, any> | null }).metadata ?? {});
    if (metadata.test_device) return true;
    const next = { ...metadata, test_device: { at: new Date().toISOString(), source: 'header' } };
    const { error: upErr } = await supabase.from('profiles').update({ metadata: next }).eq('id', userId).is('metadata->test_device', null);
    if (upErr) {
      console.error('[TestDevice] flag failed:', userId, upErr.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[TestDevice] flag failed:', userId, err?.message ?? err);
    return false;
  }
}
