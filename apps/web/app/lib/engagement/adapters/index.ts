/** The FitCircle wiring of the engagement adapters (the only file crons/routes import). */
import { AmplitudeAnalyticsSink } from './amplitude-analytics';
import { FitCircleConsent } from './fitcircle-consent';
import { FitCircleFactsProvider } from './fitcircle-facts';
import { OrchestratorPushSender } from './orchestrator-push';
import { ResendEmailSender } from './resend-email';
import { SupabaseSendLedger } from './supabase-ledger';
import type { EngagementAdapters } from './types';

export function fitCircleAdapters(): EngagementAdapters {
  return {
    facts: new FitCircleFactsProvider(),
    consent: new FitCircleConsent(),
    email: new ResendEmailSender(),
    push: new OrchestratorPushSender(),
    ledger: new SupabaseSendLedger(),
    analytics: new AmplitudeAnalyticsSink(),
  };
}

export type { EngagementAdapters } from './types';
