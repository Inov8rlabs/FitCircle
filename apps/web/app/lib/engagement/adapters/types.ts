/**
 * Adapter contracts, named after Engage's (ENGAGE_IMPLEMENTATION_PLAN §4.1):
 * UserFacts, Consent, EmailSender, PushSender, SendLedger, AnalyticsSink. The
 * dispatcher and the message definitions only see these; the FitCircle
 * implementations (fitcircle-*.ts, resend-*.ts, orchestrator-*.ts,
 * supabase-*.ts, amplitude-*.ts) are the only code that knows FitCircle tables
 * or vendors. Lifting the module into Engage = re-implementing these against
 * Engage's adapter API.
 */
import type { LifecycleFacts, WeeklyReportFacts } from '../facts';
import type { RenderedEmail } from '../render/email';
import type { RenderedPush } from '../render/push';
import type { Channel, MessageKey, SkipReason } from '../types';

export interface CandidateUser {
  userId: string;
  timezone: string | null;
  createdAt: string;
}

export interface UserFactsProvider {
  /** Users to consider for lifecycle messages, keyset-paged by user id. */
  lifecycleCandidates(opts: { afterUserId?: string | null; limit: number; onlyUserIds?: string[] | null }): Promise<CandidateUser[]>;
  /** Users to consider for the weekly report, keyset-paged by user id. */
  weeklyReportCandidates(opts: { afterUserId?: string | null; limit: number; onlyUserIds?: string[] | null }): Promise<CandidateUser[]>;
  lifecycleFacts(userId: string, now: Date): Promise<LifecycleFacts | null>;
  /** Facts for the ISO week starting `weekStart` (local Monday). */
  weeklyReportFacts(userId: string, weekStart: string, now: Date): Promise<WeeklyReportFacts | null>;
}

export type ConsentDecision = { allowed: true; email: string } | { allowed: false; reason: SkipReason };

/** Engagement email streams a person can unsubscribe from individually. */
export type EmailStream = 'weekly_report' | 'tips';

export interface ConsentProvider {
  /** May we send engagement email of this stream to this person (and where)? */
  emailAllowed(userId: string, stream: EmailStream): Promise<ConsentDecision>;
  /** Record an unsubscribe ('all' = every engagement email). */
  unsubscribe(userId: string, scope: EmailStream | 'all'): Promise<boolean>;
  /** Record a hard bounce / complaint so we stop emailing the address. */
  suppressEmail(userId: string, reason: 'bounced' | 'complained'): Promise<void>;
}

export interface EmailSendRequest {
  to: string;
  email: RenderedEmail;
  /** One-click unsubscribe URL (RFC 8058) — engagement email only. */
  unsubscribeUrl?: string;
  /** Resend tags (ASCII letters, digits, _ and - only). */
  tags: Record<string, string>;
  idempotencyKey: string;
}

export type SendResult = { ok: true; providerId: string | null } | { ok: false; error: string };

export interface EmailSender {
  send(req: EmailSendRequest): Promise<SendResult>;
}

export type PushResult = { sent: true } | { sent: false; reason: string };

export interface PushSender {
  send(userId: string, push: RenderedPush): Promise<PushResult>;
}

export interface LedgerClaim {
  userId: string;
  messageKey: MessageKey;
  periodKey: string;
  channel: Channel;
  variant: string;
  templateVersion: string;
  goalKey: string;
  status?: 'pending' | 'holdout' | 'skipped';
  meta?: Record<string, string | number | boolean>;
}

export interface LedgerRow {
  id: string;
  user_id: string;
  message_key: string;
  period_key: string;
  channel: Channel;
  status: string;
  variant: string | null;
  template_version: string | null;
  provider_id: string | null;
  goal_key: string | null;
  created_at: string;
  sent_at: string | null;
  meta: Record<string, any>;
}

export type LedgerStampField = 'delivered_at' | 'opened_at' | 'clicked_at' | 'bounced_at' | 'complained_at' | 'unsubscribed_at' | 'converted_at';

export interface SendLedger {
  /** Is the ledger table reachable (migration 119 applied)? Crons refuse to send without it. */
  probe(): Promise<boolean>;
  /** Insert the row; null when it already exists (someone else claimed it). Throws when the table is unavailable. */
  claim(c: LedgerClaim): Promise<string | null>;
  /** Mark a claimed row's outcome. */
  complete(
    id: string,
    outcome: { status: 'sent' | 'failed' | 'suppressed'; providerId?: string | null; meta?: Record<string, string | number | boolean> }
  ): Promise<void>;
  /** Drop a claim so a later run may retry (transport error before handoff). */
  release(id: string): Promise<void>;
  /** Recent rows for a user (newest first). */
  recentForUser(userId: string, sinceIso: string): Promise<LedgerRow[]>;
  /**
   * Stamp a delivery/engagement timestamp the first time it happens (by
   * Resend email id, else by our send id). Returns the row when this call set
   * it, null when unknown or already stamped (replays are no-ops).
   */
  stamp(ref: { providerId?: string | null; sendId?: string | null }, field: LedgerStampField, at: string, meta?: Record<string, string>): Promise<LedgerRow | null>;
  /** Already claimed? (cheap pre-check before loading facts) */
  exists(userId: string, messageKey: MessageKey, periodKey: string, channel: Channel): Promise<boolean>;
}

/** Server-side analytics (tracking plan events). Must never throw. */
export interface AnalyticsSink {
  track(userId: string, event: string, properties: Record<string, string | number | boolean>, insertId?: string): void;
}

export interface EngagementAdapters {
  facts: UserFactsProvider;
  consent: ConsentProvider;
  email: EmailSender;
  push: PushSender;
  ledger: SendLedger;
  analytics: AnalyticsSink;
}
