/**
 * Server-side evidence that a user allowed AI data sharing (App Store Guideline 5.1.2(i),
 * UK GDPR / health-data rules): required before any SERVER-INITIATED model call that sends the
 * user's logs to a third-party AI (daily focus, free plan teaser, AI push copy).
 *
 * FINAL RULE (docs/PRIVACY_COMPLIANCE_SPEC.md §4): a server consent record decides when one
 * exists (user_consents, migration 130: `ai_processing` granted → allowed; withdrawn → NOT
 * allowed, whatever the chat history). Only without a record does the hotfix evidence count:
 * the user has sent Fitzy a chat message. Both apps refuse to send a Fitzy message until the user taps "Allow" on the AI
 * consent sheet, and a fitzy_conversations row is only ever created together with the user's
 * first message (FitzyConversationService.create in prepareTurn). profiles.fitzy_opened_at is
 * NOT evidence: it is stamped when the Fitzy tab is opened, before any consent prompt.
 *
 * Fails closed: a query error means "no evidence" (no model call).
 */
import { ConsentService } from '../services/consent-service';
import { createAdminSupabase } from '../supabase-admin';

const CHUNK = 200;

/** True when the user may get server-initiated AI: a granted record, or (no record) a Fitzy conversation. */
export async function hasAiConsentEvidence(userId: string): Promise<boolean> {
  try {
    return await ConsentService.serverAiAllowed(userId, 'fitzy_focus');
  } catch (err: any) {
    console.error('[AiConsent] consent check failed (treated as no consent):', err?.message ?? err);
    return false;
  }
}

/** The subset of `userIds` allowed server-initiated AI (record first, then conversation evidence). */
export async function usersWithAiConsentEvidence(userIds: string[]): Promise<Set<string>> {
  try {
    return await ConsentService.serverAiAllowedSet(userIds, await usersWithFitzyConversation(userIds));
  } catch (err: any) {
    console.error('[AiConsent] batched consent check failed (treated as no consent):', err?.message ?? err);
    return new Set();
  }
}

/** Raw hotfix evidence: the user has a fitzy_conversations row. Fails closed. */
export async function hasFitzyConversation(userId: string): Promise<boolean> {
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

/** Raw hotfix evidence, batched: users with a fitzy_conversations row (fails closed per chunk). */
export async function usersWithFitzyConversation(userIds: string[]): Promise<Set<string>> {
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
