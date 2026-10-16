/**
 * Web "Invite by email or phone" helpers (docs/REFERRALS_SPEC.md §9): smart-field
 * parsing, chip management, the merged friends list and nudge labels. Pure — no
 * React — so it's unit-tested directly.
 */

export const MAX_CONTACTS_PER_SEND = 10;

export type ParsedContact =
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string; display: string }
  | { kind: 'invalid'; input: string; reason: string };

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

/** Normalizes a phone number to E.164. Without a "+", only North American numbers are assumed. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function maskPhone(e164: string): string {
  return `•••• ${e164.slice(-4)}`;
}

/** One smart field: an email or a phone number. */
export function parseContact(raw: string): ParsedContact {
  const input = raw.trim().replace(/^mailto:/i, '').replace(/^(sms|tel):/i, '');
  if (!input) return { kind: 'invalid', input, reason: 'Enter an email or phone number' };
  if (input.includes('@')) {
    const email = input.toLowerCase();
    return EMAIL_RE.test(email) ? { kind: 'email', value: email } : { kind: 'invalid', input, reason: "That email doesn't look right" };
  }
  if (/\d/.test(input)) {
    const phone = normalizePhone(input);
    if (phone) return { kind: 'phone', value: phone, display: input };
    const digits = input.replace(/\D/g, '');
    return {
      kind: 'invalid',
      input,
      reason: !input.startsWith('+') && digits.length > 6 ? 'Add the country code, like +44…' : "That number doesn't look right",
    };
  }
  return { kind: 'invalid', input, reason: 'Enter an email or phone number' };
}

/** Splits a pasted list ("a@x.com, b@y.com\n+1 416…") into candidate entries. */
export function splitContactInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ContactChip {
  key: string;
  kind: 'email' | 'phone';
  value: string;
  label: string;
  name?: string;
}

/**
 * Adds parsed entries to the chip list: dedupes, caps at 10 and returns what
 * couldn't be added so the field can keep showing it.
 */
export function addChips(
  chips: ContactChip[],
  raw: string,
  name?: string
): { chips: ContactChip[]; rejected: Array<{ input: string; reason: string }> } {
  const next = [...chips];
  const rejected: Array<{ input: string; reason: string }> = [];
  const entries = splitContactInput(raw);
  const trimmedName = name?.trim() || undefined;
  for (const entry of entries) {
    const parsed = parseContact(entry);
    if (parsed.kind === 'invalid') {
      rejected.push({ input: parsed.input, reason: parsed.reason });
      continue;
    }
    const key = `${parsed.kind}:${parsed.value}`;
    if (next.some((c) => c.key === key)) continue;
    if (next.length >= MAX_CONTACTS_PER_SEND) {
      rejected.push({ input: entry, reason: `Up to ${MAX_CONTACTS_PER_SEND} at a time` });
      continue;
    }
    next.push({
      key,
      kind: parsed.kind,
      value: parsed.value,
      label: parsed.kind === 'email' ? parsed.value : parsed.display,
      // A name only makes sense for a single contact.
      ...(trimmedName && entries.length === 1 ? { name: trimmedName } : {}),
    });
  }
  return { chips: next, rejected };
}

/** Request body contacts for POST /api/referrals/me/invites (emails are sent; phones are record-only). */
export function chipsToContacts(chips: ContactChip[]) {
  return chips.map((c) =>
    c.kind === 'email'
      ? { email: c.value, ...(c.name ? { name: c.name } : {}), channel: 'email' as const }
      : { phone: c.value, ...(c.name ? { name: c.name } : {}), channel: 'sms' as const }
  );
}

/** `sms:` link for mobile browsers. `?&body=` is understood by both iOS and Android. */
export function smsHref(body: string, phone?: string | null): string {
  return `sms:${phone ?? ''}?&body=${encodeURIComponent(body)}`;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type InviteResultStatus =
  | 'sent'
  | 'already_invited'
  | 'already_member'
  | 'opted_out'
  | 'invalid'
  | 'self'
  | 'rate_limited'
  | 'failed';

export const RESULT_COPY: Record<InviteResultStatus, { label: string; tone: 'good' | 'neutral' | 'bad' }> = {
  sent: { label: 'Invite sent ✓', tone: 'good' },
  already_invited: { label: 'Already invited · nudge them instead', tone: 'neutral' },
  already_member: { label: 'Already on FitCircle', tone: 'neutral' },
  opted_out: { label: "Can't invite this address", tone: 'bad' },
  invalid: { label: "That doesn't look right", tone: 'bad' },
  self: { label: "That's you!", tone: 'neutral' },
  rate_limited: { label: 'Daily invite limit reached, try tomorrow', tone: 'bad' },
  failed: { label: "Couldn't send, try again", tone: 'bad' },
};

export function resultCopy(status: string) {
  return RESULT_COPY[status as InviteResultStatus] ?? RESULT_COPY.failed;
}

// ---------------------------------------------------------------------------
// Merged friends list (§9.1: invites first, then invitees)
// ---------------------------------------------------------------------------

export interface NudgeState {
  available: boolean;
  nextAt: string | null;
  remaining: number;
}

export interface HubInviteRow {
  id: string;
  channel: 'email' | 'sms';
  name: string | null;
  contact: string;
  status: 'invited' | 'joined' | 'qualified';
  sentAt: string;
  lastNudgedAt: string | null;
  nudge?: NudgeState;
}

export interface HubInviteeRow {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'pending' | 'qualified' | 'review' | 'rejected';
  joinedAt: string;
  qualifiedAt: string | null;
  circleName: string | null;
  nudge?: NudgeState;
}

export type FriendStatus = 'invited_email' | 'invited_sms' | 'joined' | 'qualified' | 'review' | 'rejected';

export interface FriendRowModel {
  key: string;
  source: 'invite' | 'referral';
  id: string;
  name: string;
  subtitle: string | null;
  avatarUrl: string | null;
  status: FriendStatus;
  channel: 'email' | 'sms' | null;
  nudge: NudgeState | null;
}

export function mergeFriends(invites: HubInviteRow[] | undefined, invitees: HubInviteeRow[] | undefined): FriendRowModel[] {
  const fromInvites: FriendRowModel[] = (invites ?? [])
    .filter((i) => i.status === 'invited')
    .map((i) => ({
      key: `invite:${i.id}`,
      source: 'invite',
      id: i.id,
      name: i.name || i.contact,
      subtitle: i.name ? i.contact : null,
      avatarUrl: null,
      status: i.channel === 'sms' ? 'invited_sms' : 'invited_email',
      channel: i.channel,
      nudge: i.nudge ?? null,
    }));
  const fromInvitees: FriendRowModel[] = (invitees ?? []).map((f) => ({
    key: `referral:${f.id}`,
    source: 'referral',
    id: f.id,
    name: f.displayName,
    subtitle: f.circleName ? `in ${f.circleName}` : null,
    avatarUrl: f.avatarUrl,
    status: f.status === 'pending' ? 'joined' : f.status,
    channel: null,
    nudge: f.nudge ?? null,
  }));
  return [...fromInvites, ...fromInvitees];
}

export const FRIEND_STATUS_LABEL: Record<FriendStatus, string> = {
  invited_email: 'Invited · email',
  invited_sms: 'Invited · text',
  joined: 'Joined · waiting for first check-in',
  qualified: 'Week unlocked ✓',
  review: 'Checking…',
  rejected: 'Not eligible',
};

/** Short "2d" / "5h" / "a few min" until `iso`. */
export function untilLabel(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const hours = ms / 3_600_000;
  if (hours >= 24) return `${Math.ceil(hours / 24)}d`;
  if (hours >= 1) return `${Math.ceil(hours)}h`;
  return `${Math.max(1, Math.ceil(ms / 60_000))}m`;
}

/**
 * What the Nudge control shows: a button, a "Nudged · again in 2d" note, or
 * nothing (limit reached / not nudgeable).
 */
export function nudgeView(
  nudge: NudgeState | null,
  now: number = Date.now()
): { kind: 'button' } | { kind: 'wait'; label: string } | { kind: 'none' } {
  if (!nudge || nudge.remaining <= 0) return { kind: 'none' };
  if (nudge.available) return { kind: 'button' };
  if (nudge.nextAt) return { kind: 'wait', label: `Nudged · again in ${untilLabel(nudge.nextAt, now)}` };
  return { kind: 'none' };
}

/** Analytics target/channel for a nudge on this row. */
export function nudgeAnalytics(row: FriendRowModel): { target: 'invited' | 'joined'; channel: 'push' | 'email' | 'sms' } {
  if (row.source === 'referral') return { target: 'joined', channel: 'push' };
  return { target: 'invited', channel: row.channel === 'sms' ? 'sms' : 'email' };
}
