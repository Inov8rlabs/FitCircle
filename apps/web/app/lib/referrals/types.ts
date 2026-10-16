/** Wire types for the referral API — mirror docs/REFERRALS_SPEC.md §4 exactly. */

export type AttributionSource =
  | 'universal_link'
  | 'app_link'
  | 'play_referrer'
  | 'paste'
  | 'typed'
  | 'web'
  | 'circle_join'
  | 'email_invite';

/** Sources a client may send to POST claim (email_invite is server-only). */
export const ATTRIBUTION_SOURCES: readonly AttributionSource[] = [
  'universal_link',
  'app_link',
  'play_referrer',
  'paste',
  'typed',
  'web',
  'circle_join',
];

export interface NudgeState {
  available: boolean;
  nextAt: string | null;
  remaining: number;
}

export interface InviteView {
  id: string;
  channel: 'email' | 'sms';
  name: string | null;
  contact: string;
  status: 'invited' | 'joined' | 'qualified';
  sentAt: string;
  lastNudgedAt: string | null;
  nudge: NudgeState;
}

export type InviteResultStatus =
  | 'sent'
  | 'already_invited'
  | 'already_member'
  | 'opted_out'
  | 'invalid'
  | 'self'
  | 'rate_limited'
  | 'failed';

export interface InviteResult {
  contact: string;
  channel: 'email' | 'sms';
  name: string | null;
  status: InviteResultStatus;
  inviteId: string | null;
}

export interface InviteContactsInput {
  contacts: Array<{ email?: string; phone?: string; name?: string; channel?: 'email' | 'sms' }>;
  circleId?: string | null;
}

export interface InviteContactsResult {
  results: InviteResult[];
  sentCount: number;
}

export interface NudgeResult {
  status: 'sent' | 'too_soon' | 'limit_reached' | 'not_nudgeable';
  nextAt: string | null;
  remaining: number;
  smsBody: string | null;
}

export type ReferralStatus = 'pending' | 'qualified' | 'review' | 'rejected' | 'revoked';
export type RewardKind = 'inviter_week' | 'invitee_welcome' | 'lifetime';
export type ProSource = 'store' | 'referral' | 'complimentary' | 'none';

export interface InviterSummary {
  firstName: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ReferralPreview {
  valid: boolean;
  kind?: 'personal' | 'circle';
  code?: string;
  inviter?: InviterSummary;
  circle?: {
    name: string;
    inviteCode: string;
    memberCount: number;
    memberAvatars: string[];
    challengeType: string | null;
  } | null;
  inviteeRewardDays?: number;
}

export interface ClaimInput {
  code: string;
  ref?: string | null;
  source: AttributionSource;
  deviceId?: string | null;
}

export interface ClaimResult {
  status: ReferralStatus;
  inviter: { firstName: string; avatarUrl: string | null };
  circle: { id: string; name: string; inviteCode: string } | null;
  inviteeRewardDays: number;
}

export interface MilestoneView {
  count: number;
  key: string;
  title: string;
  blurb: string;
  reached: boolean;
}

export interface ReferralHub {
  enabled: boolean;
  code?: string;
  shareUrl?: string;
  shareMessage?: string;
  program?: {
    rewardDaysPerFriend: number;
    lifetimeThreshold: number;
    inviteeRewardDays: number;
    attributionWindowDays: number;
  };
  stats?: {
    invited: number;
    pending: number;
    qualified: number;
    daysEarned: number;
    daysBanked: number;
    hasLifetime: boolean;
    toLifetime: number;
  };
  milestones?: MilestoneView[];
  nextMilestone?: (Omit<MilestoneView, 'reached'> & { remaining: number }) | null;
  invitees?: Array<{
    id: string;
    displayName: string;
    avatarUrl: string | null;
    status: 'pending' | 'qualified' | 'review' | 'rejected';
    joinedAt: string;
    qualifiedAt: string | null;
    circleName: string | null;
    nudge: NudgeState;
  }>;
  invites?: InviteView[];
  smsBody?: string;
  emailPreview?: { subject: string; intro: string };
  pendingCircleInvite?: { circleId: string; name: string; inviteCode: string; ref: string | null } | null;
  pro?: { source: ProSource; expiresAt: string | null; lifetime: boolean; bankedDays: number };
  unseenRewards?: Array<{
    id: string;
    kind: RewardKind;
    days: number | null;
    friendName: string | null;
    createdAt: string;
  }>;
  starterCircle?: {
    id: string;
    name: string;
    inviteCode: string;
    memberCount: number;
    shareUrl: string;
    shareMessage: string;
  } | null;
  canClaimCode?: boolean;
  referredBy?: { firstName: string; avatarUrl: string | null } | null;
}

export type ReferralErrorCode =
  | 'INVALID_CODE'
  | 'SELF_REFERRAL'
  | 'ALREADY_ATTRIBUTED'
  | 'WINDOW_CLOSED'
  | 'DEVICE_INELIGIBLE'
  | 'PROGRAM_DISABLED';

const STATUS: Record<ReferralErrorCode, number> = {
  INVALID_CODE: 404,
  SELF_REFERRAL: 400,
  ALREADY_ATTRIBUTED: 409,
  WINDOW_CLOSED: 422,
  DEVICE_INELIGIBLE: 422,
  PROGRAM_DISABLED: 403,
};

export class ReferralError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ReferralErrorCode,
    message: string,
    public readonly data: unknown = null
  ) {
    super(message);
    this.status = STATUS[code];
  }
}
