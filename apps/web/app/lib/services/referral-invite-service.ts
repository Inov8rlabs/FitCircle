/**
 * ReferralInviteService — invite friends by email or text, nudge them, and
 * unsubscribe (docs/REFERRALS_SPEC.md §9).
 *
 *  - email: we send a branded invitation via Resend, from the inviter's name.
 *  - sms:   the member texts from their own phone (native composer); we only
 *           record it — no server SMS (no provider; 10DLC + TCPA risk).
 *
 * Contacts are keyed by a salted hash; phones are never stored in plaintext,
 * emails only until the friend joins (or 45 days, cron).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { readBoundedBody } from '@inov8r/engage-adapters/bounded-body';
import { deliverLegacyEmail } from '../engage/legacy-email';

import {
  inviteEmail,
  reminderEmail,
  rewardEmail,
  smsInviteBody,
  smsReminderBody,
  type RenderedEmail,
  type RewardEmailInput,
} from '../email/referral-emails';
import { INVITE_HOST, circleInviteUrl, personalInviteUrl } from '../referrals/links';
import { inviteeRewardDays } from '../referrals/referral-policy';
import type {
  InviteContactsInput,
  InviteContactsResult,
  InviteResult,
  InviteView,
  NudgeResult,
  NudgeState,
} from '../referrals/types';
import { createAdminSupabase } from '../supabase-admin';

const HOUR = 60 * 60 * 1000;

export const INVITE_LIMITS = {
  perRequest: 10,
  emailsPer24h: 25,
  pendingTotal: 200,
  /** Invite reminders (email/text): count + spacing. */
  inviteReminders: 2,
  inviteReminderGapHours: 72,
  /** Push nudges to a joined friend who hasn't checked in yet. */
  joinedNudges: 3,
  joinedNudgeGapHours: 48,
  /** Email-match attribution only for invites this fresh. */
  matchWindowDays: 30,
  /** Plaintext emails of never-joined invites are purged after this. */
  retentionDays: 45,
} as const;

export interface InviteRow {
  id: string;
  inviter_id: string;
  channel: 'email' | 'sms';
  contact_hash: string;
  email: string | null;
  contact_display: string;
  name: string | null;
  circle_id: string | null;
  status: 'invited' | 'joined' | 'qualified' | 'failed';
  referral_id: string | null;
  nudge_count: number;
  last_nudged_at: string | null;
  sent_at: string;
  joined_at: string | null;
}

// ---------------------------------------------------------------------------
// Contact normalization (exported for tests and for the referral service)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? '').trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/** E.164-ish: keep a leading +, digits only; bare 10-digit numbers are NANP (+1). */
export function normalizePhone(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function contactHash(kind: 'email' | 'phone', value: string): string {
  const salt = process.env.REFERRAL_DEVICE_SALT || 'fitcircle-referrals';
  return createHash('sha256').update(`${salt}:${kind}:${value}`).digest('hex');
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, Math.min(2, local.length))}•••@${domain}`;
}

export function maskPhone(phone: string): string {
  return `•••• ${phone.slice(-4)}`;
}

function cleanName(name: string | null | undefined): string | null {
  const n = (name ?? '').replace(/[<>\r\n]/g, '').trim().slice(0, 60);
  return n || null;
}

// ---------------------------------------------------------------------------
// Unsubscribe tokens: `${emailHash}.${hmac}` (no expiry — an unsubscribe link must keep working)
// ---------------------------------------------------------------------------

function tokenSecret(): string {
  const secret=process.env.REFERRAL_UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(process.env.NODE_ENV==='production' && (!secret || Buffer.byteLength(secret)<32)) throw new Error('Referral unsubscribe signing is not configured');
  return secret || 'fitcircle-referrals-dev-secret';
}

export function unsubscribeToken(emailHash: string): string {
  const sig = createHmac('sha256', tokenSecret()).update(emailHash).digest('base64url');
  return `${emailHash}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const parts=(token ?? '').split('.');
  if(parts.length!==2) return null;
  const [hash, sig] = parts;
  if (!hash || !sig || !/^[a-f0-9]{64}$/.test(hash)) return null;
  const expected = createHmac('sha256', tokenSecret()).update(hash).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? hash : null;
}

export function unsubscribeUrl(emailHash: string): string {
  return `${INVITE_HOST}/invite/unsubscribe?t=${encodeURIComponent(unsubscribeToken(emailHash))}`;
}

// ---------------------------------------------------------------------------
// Mail transport (Resend). Returns false when unconfigured or rejected.
// ---------------------------------------------------------------------------

export class ReferralDeliveryUnknownError extends Error {
  constructor(){super('Email outcome is unknown; its durable invitation or reminder claim is retained');this.name='ReferralDeliveryUnknownError';}
}

export async function sendReferralEmail(
  to: string,
  email: RenderedEmail,
  opts: { fromName?: string; unsubscribe?: string; key?: string } = {}
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[ReferralInviteService] RESEND_API_KEY not configured; email skipped');
    return false;
  }
  if(!opts.key || !/^[A-Za-z0-9:_-]{1,160}$/.test(opts.key)) throw new Error('Stable referral occurrence key required');
  const fromName = (opts.fromName ?? 'FitCircle').replace(/[<>"\r\n]/g, '').slice(0, 40);
  try {
    const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`fitcircle:${process.env.ENGAGE_ENVIRONMENT || process.env.NODE_ENV || 'development'}:${opts.key}`},body:JSON.stringify({
      from: `${fromName} via FitCircle <team@fitcircle.ai>`,
      reply_to: 'team@fitcircle.ai',
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      // RFC 8058: mail clients POST to this URL for one-click unsubscribe.
      headers: opts.unsubscribe
        ? {
            'List-Unsubscribe': `<${opts.unsubscribe.replace('/invite/unsubscribe?', '/api/referrals/unsubscribe?')}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : undefined,
    })});
    if(!response.ok) {
      void response.body?.cancel().catch(()=>undefined);
      if(response.status>=400 && response.status<500 && ![408,409].includes(response.status)) return false;
      throw new ReferralDeliveryUnknownError();
    }
    const result=JSON.parse((await readBoundedBody(response,16384)).toString('utf8'));
    if(typeof result.id!=='string' || !/^[A-Za-z0-9_-]{1,512}$/.test(result.id)) throw new ReferralDeliveryUnknownError();
    return true;
  } catch {
    // Never collapse uncertain acceptance into a rejection: callers release
    // their durable invitation/nudge claim only for a definite rejection.
    throw new ReferralDeliveryUnknownError();
  }
}

// ---------------------------------------------------------------------------

interface InviterContext {
  firstName: string;
  avatarUrl: string | null;
  email: string | null;
  code: string;
  circle: { id: string; name: string; inviteCode: string; memberCount: number } | null;
}

function nudgeState(count: number, last: string | null, limit: number, gapHours: number): NudgeState {
  const remaining = Math.max(0, limit - count);
  if (remaining === 0) return { available: false, nextAt: null, remaining: 0 };
  if (!last) return { available: true, nextAt: null, remaining };
  const next = new Date(last).getTime() + gapHours * HOUR;
  return next <= Date.now()
    ? { available: true, nextAt: null, remaining }
    : { available: false, nextAt: new Date(next).toISOString(), remaining };
}

export function inviteNudgeState(row: Pick<InviteRow, 'nudge_count' | 'last_nudged_at' | 'sent_at' | 'status'>): NudgeState {
  if (row.status !== 'invited') return { available: false, nextAt: null, remaining: 0 };
  return nudgeState(row.nudge_count, row.last_nudged_at ?? row.sent_at, INVITE_LIMITS.inviteReminders, INVITE_LIMITS.inviteReminderGapHours);
}

export function joinedNudgeState(row: { status: string; nudge_count?: number | null; last_nudged_at?: string | null }): NudgeState {
  if (row.status !== 'pending') return { available: false, nextAt: null, remaining: 0 };
  return nudgeState(row.nudge_count ?? 0, row.last_nudged_at ?? null, INVITE_LIMITS.joinedNudges, INVITE_LIMITS.joinedNudgeGapHours);
}

export class ReferralInviteService {
  /** Invite up to 10 friends: emails are sent now, texts are recorded (already sent from the phone). */
  static async inviteContacts(
    userId: string,
    input: InviteContactsInput,
    getCode: (userId: string) => Promise<string>
  ): Promise<InviteContactsResult> {
    const supabase = createAdminSupabase();
    const ctx = await this.inviterContext(userId, input.circleId ?? null, getCode);
    const results: InviteResult[] = [];
    let sentCount = 0;

    const since = new Date(Date.now() - 24 * HOUR).toISOString();
    const [emailCount,pendingCount] = await Promise.all([
      supabase
        .from('referral_invites')
        .select('id', { count: 'exact', head: true })
        .eq('inviter_id', userId)
        .eq('channel', 'email')
        .gte('sent_at', since),
      supabase
        .from('referral_invites')
        .select('id', { count: 'exact', head: true })
        .eq('inviter_id', userId)
        .eq('status', 'invited'),
    ]);
    if(emailCount.error || pendingCount.error) throw new Error('Invite limits are temporarily unavailable');
    const emailsToday=emailCount.count,pending=pendingCount.count;
    let emailBudget = INVITE_LIMITS.emailsPer24h - (emailsToday ?? 0);
    let pendingBudget = INVITE_LIMITS.pendingTotal - (pending ?? 0);
    const seen = new Set<string>();

    for (const raw of input.contacts.slice(0, INVITE_LIMITS.perRequest)) {
      const name = cleanName(raw.name);
      const wantsSms = raw.channel === 'sms' || (!raw.email && !!raw.phone);
      if (wantsSms) {
        const phone = normalizePhone(raw.phone);
        if (!phone) {
          results.push({ contact: (raw.phone ?? '').slice(0, 24), channel: 'sms', name, status: 'invalid', inviteId: null });
          continue;
        }
        const hash = contactHash('phone', phone);
        const display = maskPhone(phone);
        if (seen.has(hash)) continue;
        seen.add(hash);
        if (pendingBudget <= 0) {
          results.push({ contact: display, channel: 'sms', name, status: 'rate_limited', inviteId: null });
          continue;
        }
        const row = await this.insertInvite({ inviter_id: userId, channel: 'sms', contact_hash: hash, email: null, contact_display: display, name, circle_id: ctx.circle?.id ?? null });
        if (typeof row === 'string') { results.push({contact:display,channel:'sms',name,status:row,inviteId:null}); continue; }
        if (!row) {
          results.push({ contact: display, channel: 'sms', name, status: 'already_invited', inviteId: null });
          continue;
        }
        pendingBudget--;
        sentCount++;
        results.push({ contact: display, channel: 'sms', name, status: 'sent', inviteId: row.id });
        continue;
      }

      const email = normalizeEmail(raw.email);
      if (!email) {
        results.push({ contact: (raw.email ?? '').slice(0, 64), channel: 'email', name, status: 'invalid', inviteId: null });
        continue;
      }
      const hash = contactHash('email', email);
      const display = maskEmail(email);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const push = (status: InviteResult['status'], inviteId: string | null = null) =>
        results.push({ contact: display, channel: 'email', name, status, inviteId });

      if (ctx.email && email === ctx.email.toLowerCase()) { push('self'); continue; }
      const { data: optout,error:optoutError } = await supabase.from('referral_email_optouts').select('email_hash').eq('email_hash', hash).maybeSingle();
      if(optoutError) throw new Error('Invite preferences are temporarily unavailable');
      if (optout) { push('opted_out'); continue; }
      const literalEmail=email.replace(/[\\%_]/g,'\\$&');
      const { data: member,error:memberError } = await supabase.from('profiles').select('id').ilike('email', literalEmail).limit(1).maybeSingle();
      if(memberError) throw new Error('Invite membership is temporarily unavailable');
      if (member) { push('already_member'); continue; }
      if (emailBudget <= 0 || pendingBudget <= 0) { push('rate_limited'); continue; }

      const row = await this.insertInvite({ inviter_id: userId, channel: 'email', contact_hash: hash, email, contact_display: display, name, circle_id: ctx.circle?.id ?? null });
      if (typeof row === 'string') { push(row); continue; }
      if (!row) { push('already_invited'); continue; }
      emailBudget--;
      const delivered = await sendReferralEmail(email, inviteEmail(this.emailInput(ctx, name, hash)), {
        fromName: ctx.firstName,
        unsubscribe: unsubscribeUrl(hash),
        key:`invite:${row.id}`,
      });
      if (!delivered) {
        // Free the slot so the member can retry once email is healthy.
        await supabase.from('referral_invites').delete().eq('id', row.id);
        push('failed');
        continue;
      }
      pendingBudget--;
      sentCount++;
      push('sent', row.id);
    }
    return { results, sentCount };
  }

  /** Remind an invited friend (email resend / composer text). */
  static async nudgeInvite(userId: string, inviteId: string, getCode: (u: string) => Promise<string>): Promise<NudgeResult> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('referral_invites')
      .select('*')
      .eq('id', inviteId)
      .eq('inviter_id', userId)
      .maybeSingle();
    const row = data as InviteRow | null;
    if (!row || row.status !== 'invited') return { status: 'not_nudgeable', nextAt: null, remaining: 0, smsBody: null };
    const state = inviteNudgeState(row);
    if (state.remaining === 0) return { status: 'limit_reached', nextAt: null, remaining: 0, smsBody: null };
    if (!state.available) return { status: 'too_soon', nextAt: state.nextAt, remaining: state.remaining, smsBody: null };

    // Claim the nudge slot first (CAS on nudge_count) so double taps send once.
    const now = new Date().toISOString();
    const { data: claimed, error:claimError } = await supabase
      .from('referral_invites')
      .update({ nudge_count: row.nudge_count + 1, last_nudged_at: now })
      .eq('id', row.id)
      .eq('nudge_count', row.nudge_count)
      .select('id');
    if (claimError?.code === 'P0102') return {status:'not_nudgeable',nextAt:null,remaining:0,smsBody:null};
    if (claimError) throw new Error('Invite reminder authorization is temporarily unavailable');
    if ((claimed ?? []).length !== 1) return { status: 'too_soon', nextAt: null, remaining: state.remaining, smsBody: null };
    const after = inviteNudgeState({ ...row, nudge_count: row.nudge_count + 1, last_nudged_at: now });

    const ctx = await this.inviterContext(userId, row.circle_id, getCode);
    if (row.channel === 'sms') {
      return { status: 'sent', nextAt: after.nextAt, remaining: after.remaining, smsBody: smsReminderBody(ctx.circle?.name ?? null, this.link(ctx), inviteeRewardDays()) };
    }
    const { data: optout,error:optoutError } = await supabase.from('referral_email_optouts').select('email_hash').eq('email_hash', row.contact_hash).maybeSingle();
    if(optoutError) throw new Error('Invite preferences are temporarily unavailable');
    if (optout || !row.email) return { status: 'not_nudgeable', nextAt: null, remaining: 0, smsBody: null };
    const delivered = await sendReferralEmail(row.email, reminderEmail(this.emailInput(ctx, row.name, row.contact_hash)), {
      fromName: ctx.firstName,
      unsubscribe: unsubscribeUrl(row.contact_hash),
      key:`reminder:${row.id}:${row.nudge_count+1}`,
    });
    if (!delivered) {
      await supabase.from('referral_invites').update({ nudge_count: row.nudge_count, last_nudged_at: row.last_nudged_at }).eq('id', row.id).eq('nudge_count',row.nudge_count+1).eq('last_nudged_at',now);
      throw new Error('reminder email failed');
    }
    return { status: 'sent', nextAt: after.nextAt, remaining: after.remaining, smsBody: null };
  }

  /** Hub list: invites not yet converted into a referral. */
  static async listForHub(userId: string): Promise<InviteView[]> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('referral_invites')
      .select('*')
      .eq('inviter_id', userId)
      .eq('status', 'invited')
      .order('sent_at', { ascending: false })
      .limit(100);
    return ((data ?? []) as InviteRow[]).map((r) => ({
      id: r.id,
      channel: r.channel,
      name: r.name,
      contact: r.contact_display,
      status: 'invited' as const,
      sentAt: r.sent_at,
      lastNudgedAt: r.last_nudged_at,
      nudge: inviteNudgeState(r),
    }));
  }

  /** Earliest fresh email invite addressed to this person (for auto-attribution). */
  static async findInviteForEmail(email: string | null | undefined, excludeInviterId: string): Promise<InviteRow | null> {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const supabase = createAdminSupabase();
    const since = new Date(Date.now() - INVITE_LIMITS.matchWindowDays * 24 * HOUR).toISOString();
    const { data } = await supabase
      .from('referral_invites')
      .select('*')
      .eq('contact_hash', contactHash('email', normalized))
      .eq('status', 'invited')
      .gte('sent_at', since)
      .order('sent_at', { ascending: true })
      .limit(5);
    return ((data ?? []) as InviteRow[]).find((r) => r.inviter_id !== excludeInviterId) ?? null;
  }

  /** A friend joined: flip the inviter's matching invite rows (any channel) to joined. */
  static async markJoined(inviterId: string, referralId: string, invitee: { email: string | null; phone: string | null }): Promise<void> {
    const hashes: string[] = [];
    const email = normalizeEmail(invitee.email);
    if (email) hashes.push(contactHash('email', email));
    const phone = normalizePhone(invitee.phone);
    if (phone) hashes.push(contactHash('phone', phone));
    if (hashes.length === 0) return;
    const supabase = createAdminSupabase();
    await supabase
      .from('referral_invites')
      .update({ status: 'joined', referral_id: referralId, joined_at: new Date().toISOString(), email: null })
      .eq('inviter_id', inviterId)
      .in('contact_hash', hashes)
      .eq('status', 'invited');
  }

  static async markQualified(referralId: string): Promise<void> {
    const supabase = createAdminSupabase();
    await supabase.from('referral_invites').update({ status: 'qualified' }).eq('referral_id', referralId);
  }

  /** One-click unsubscribe. Idempotent; true when the token is valid. */
  static async unsubscribe(token: string): Promise<boolean> {
    const hash = verifyUnsubscribeToken(token);
    if (!hash) return false;
    const supabase = createAdminSupabase();
    const { error } = await supabase.from('referral_email_optouts').insert({ email_hash: hash });
    if (error && error.code !== '23505') throw new Error(`optout insert failed: ${error.message}`);
    // Stop any pending reminders and drop the stored address.
    const {error:cleanupError}=await supabase.from('referral_invites').update({ email: null, nudge_count: INVITE_LIMITS.inviteReminders }).eq('contact_hash', hash).eq('status', 'invited');
    if(cleanupError) throw new Error('Opt-out is recorded; invitation address cleanup must be retried');
    return true;
  }

  /** Cron: forget plaintext emails of invites that never converted. */
  static async purgeStale(): Promise<number> {
    const supabase = createAdminSupabase();
    const cutoff = new Date(Date.now() - INVITE_LIMITS.retentionDays * 24 * HOUR).toISOString();
    const { data } = await supabase
      .from('referral_invites')
      .update({ email: null })
      .eq('channel', 'email')
      .not('email', 'is', null)
      .lt('sent_at', cutoff)
      .select('id');
    return (data ?? []).length;
  }

  /** "You both earned a week" email. Best-effort; true when delivered. */
  static async sendRewardEmail(to: string | null | undefined, input: RewardEmailInput, identity?: {userId:string;rewardId:string}): Promise<boolean> {
    const email = normalizeEmail(to);
    if (!email) return false;
    const {nativeBridgeActive}=await import('../engage/server');
    if (await nativeBridgeActive()) {
      if (!identity) throw new Error('Reward email requires an account and reward identity');
      return deliverLegacyEmail(identity.userId,{key:`referral_reward:${identity.rewardId}`,category:'lifecycle',lifecycle_category:'celebration'},{to:email,...rewardEmail(input)});
    }
    if(!identity) throw new Error('Reward email requires a stable reward identity');
    return sendReferralEmail(email, rewardEmail(input),{key:`reward:${identity.rewardId}`});
  }

  /** Composer text + email preview for the hub. */
  static messages(inviterFirstName: string, code: string, starter: { name: string; inviteCode: string } | null) {
    const link = starter ? circleInviteUrl(starter.inviteCode, code) : personalInviteUrl(code);
    const days = inviteeRewardDays();
    const preview = inviteEmail({
      inviterFirstName,
      inviterAvatarUrl: null,
      friendName: null,
      circle: starter ? { name: starter.name, memberCount: 0 } : null,
      link,
      rewardDays: days,
      unsubscribeUrl: '',
    });
    return {
      smsBody: smsInviteBody(inviterFirstName, starter?.name ?? null, link, days),
      emailPreview: {
        subject: preview.subject,
        intro: starter
          ? `${inviterFirstName} wants you in “${starter.name}”, their circle on FitCircle.${days > 0 ? ' Check in on 3 different days and you both get a free week of Pro.' : ''}`
          : `${inviterFirstName} is using FitCircle to stay on track and wants you along.${days > 0 ? ' Check in on 3 different days and you both get a free week of Pro.' : ''}`,
      },
    };
  }

  // -------------------------------------------------------------------------

  private static link(ctx: InviterContext): string {
    return ctx.circle ? circleInviteUrl(ctx.circle.inviteCode, ctx.code) : personalInviteUrl(ctx.code);
  }

  private static emailInput(ctx: InviterContext, friendName: string | null, hash: string) {
    return {
      inviterFirstName: ctx.firstName,
      inviterAvatarUrl: ctx.avatarUrl,
      friendName,
      circle: ctx.circle ? { name: ctx.circle.name, memberCount: ctx.circle.memberCount } : null,
      link: this.link(ctx),
      rewardDays: inviteeRewardDays(),
      unsubscribeUrl: unsubscribeUrl(hash),
    };
  }

  private static async insertInvite(row: Omit<InviteRow, 'id' | 'status' | 'referral_id' | 'nudge_count' | 'last_nudged_at' | 'sent_at' | 'joined_at'>): Promise<InviteRow | 'rate_limited' | 'opted_out' | null> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('referral_invites').insert(row).select('*').single();
    if (error) {
      if (error.code === '23505') return null;
      if (error.code === 'P0101') return 'rate_limited';
      if (error.code === 'P0102') return 'opted_out';
      throw new Error(`invite insert failed: ${error.message}`);
    }
    return data as InviteRow;
  }

  private static async inviterContext(userId: string, circleId: string | null, getCode: (u: string) => Promise<string>): Promise<InviterContext> {
    const supabase = createAdminSupabase();
    const [{ data: me }, code] = await Promise.all([
      supabase.from('profiles').select('id, display_name, username, avatar_url, email').eq('id', userId).maybeSingle(),
      getCode(userId),
    ]);
    const firstName = ((me?.display_name || me?.username || '').trim().split(/\s+/)[0]) || 'Your friend';

    // The invite's circle: the requested one if the member belongs to it, else their newest own circle.
    let circle: InviterContext['circle'] = null;
    const pick = async (id: string) => {
      const { data: c } = await supabase.from('fitcircles').select('id, name, invite_code, status, end_date').eq('id', id).maybeSingle();
      if (!c?.invite_code || c.status === 'completed' || (c.end_date && new Date(c.end_date).getTime() < Date.now())) return null;
      const { count } = await supabase
        .from('fitcircle_members')
        .select('id', { count: 'exact', head: true })
        .eq('fitcircle_id', id)
        .eq('status', 'active');
      return { id: c.id, name: c.name, inviteCode: c.invite_code, memberCount: count ?? 1 };
    };
    if (circleId) {
      const { data: membership,error:membershipError } = await supabase
        .from('fitcircle_members')
        .select('id')
        .eq('fitcircle_id', circleId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
      if(membershipError) throw new Error('Circle membership is temporarily unavailable');
      if(!membership) throw new Error('Active circle membership is required');
      circle = await pick(circleId);
      if(!circle) throw new Error('The requested circle is unavailable');
    }
    if (!circle) {
      const { data: own } = await supabase
        .from('fitcircles')
        .select('id')
        .eq('creator_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);
      for (const c of (own ?? []) as Array<{ id: string }>) {
        circle = await pick(c.id);
        if (circle) break;
      }
    }
    return { firstName, avatarUrl: me?.avatar_url ?? null, email: me?.email ?? null, code, circle };
  }
}
