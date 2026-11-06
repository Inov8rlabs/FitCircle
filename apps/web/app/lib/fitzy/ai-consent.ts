/**
 * Server-side evidence that a user allowed AI data sharing (App Store Guideline 5.1.2(i),
 * UK GDPR / health-data rules): required before any SERVER-INITIATED model call that sends the
 * user's logs to a third-party AI (daily focus, free plan teaser, AI push copy).
 *
 * The consent itself lives on the device (iOS AIConsentStore, Android AiConsentStore); the
 * server has no record yet. Until it does, the evidence is: the user has sent Fitzy a chat
 * message. Both apps refuse to send a Fitzy message until the user taps "Allow" on the AI
 * consent sheet, and a fitzy_conversations row is only ever created together with the user's
 * first message (FitzyConversationService.create in prepareTurn). profiles.fitzy_opened_at is
 * NOT evidence: it is stamped when the Fitzy tab is opened, before any consent prompt.
 *
 * Fails closed: a query error means "no evidence" (no model call).
 */
import { createAdminSupabase } from '../supabase-admin';

const CHUNK = 200;

/** True when the user has server-side evidence of AI consent. */
export async function hasAiConsentEvidence(userId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminSupabase().from('fitzy_conversations').select('id').eq('user_id', userId).limit(1);
    if (error) {
      console.error('[AiConsent] evidence lookup failed (treated as no consent):', error.message);
      return false;
    }
    return (data ?? []).length > 0;
  } catch (err: any) {
    console.error('[AiConsent] evidence lookup failed (treated as no consent):', err?.message ?? err);
    return false;
  }
}

/** The subset of `userIds` with server-side evidence of AI consent (batched; fails closed per chunk). */
export async function usersWithAiConsentEvidence(userIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const supabase = createAdminSupabase();
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const part = userIds.slice(i, i + CHUNK);
    try {
      // One row per user is enough; the per-user limit keeps a heavy chatter from crowding others out.
      const { data, error } = await supabase.from('fitzy_conversations').select('user_id').in('user_id', part).limit(part.length * 50);
      if (error) {
        console.error('[AiConsent] batched evidence lookup failed (treated as no consent):', error.message);
        continue;
      }
      for (const r of (data ?? []) as Array<{ user_id: string }>) out.add(r.user_id);
    } catch (err: any) {
      console.error('[AiConsent] batched evidence lookup failed (treated as no consent):', err?.message ?? err);
    }
  }
  return out;
}
