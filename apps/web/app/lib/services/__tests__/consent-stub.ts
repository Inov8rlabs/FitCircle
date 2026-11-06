/**
 * For route unit tests that mock the services around a route but not Supabase: replaces
 * ConsentService with an allow-all stub so the AI consent gate doesn't reach the network.
 * The real rule is covered by consent-service.test.ts and ai-consent-routes.test.ts.
 *
 *   vi.mock('@/lib/services/consent-service', async (orig) =>
 *     (await import('@/lib/services/__tests__/consent-stub')).allowAllConsentModule(orig));
 */
export async function allowAllConsentModule(importOriginal: () => Promise<any>) {
  const actual = await importOriginal();
  return {
    ...actual,
    ConsentService: {
      assertUserAi: async () => {},
      aiDecision: async () => ({ allowed: true, basis: 'record' }),
      serverAiAllowed: async () => true,
      serverAiAllowedSet: async (ids: string[]) => new Set(ids),
      current: async () => ({ health_data: null, ai_processing: null, marketing_email: null }),
      read: async () => ({ snapshot: { health_data: null, ai_processing: null, marketing_email: null }, ok: true }),
      effective: async () => ({ marketingEmail: true }),
      hasChatEvidence: async () => true,
    },
  };
}
