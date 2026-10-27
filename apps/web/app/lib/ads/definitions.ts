/**
 * One-line KPI definitions for UI tooltips (overview.definitions). Keys are
 * AdsMetrics fields. Full definitions: docs/ADS_METRICS_METHODOLOGY.md — keep
 * the two in sync.
 */
import type { AdsMetrics } from './types';

type MetricKey = Exclude<keyof AdsMetrics, 'currency' | 'mixedCurrency' | 'incomplete'>;

export const METRIC_DEFINITIONS: Record<MetricKey, string> = {
  spend: 'Network-reported spend for days in the range (Apple: localSpend, org time zone), campaign level, summed in the account currency.',
  impressions: 'Network-reported ad impressions for days in the range.',
  taps: 'Network-reported taps (Apple) / clicks (Meta, all clicks) for days in the range.',
  installs: 'Network-reported installs on days in the range. Apple: totalInstalls = tap- + view-through, new downloads + redownloads.',
  users: 'Sign-ups (profiles.created_at, report time zone) in the range attributed to this slice; test/internal accounts excluded. Totals count paid-channel users only.',
  activated: 'Users with a food log (not a Health import) or a manual check-in within 7×24 h of sign-up.',
  trials: 'Users whose PRODUCTION INITIAL_PURCHASE was a free trial (period_type TRIAL).',
  payers: 'Users with ≥1 paid PRODUCTION charge (purchase, renewal incl. trial conversion, lifetime) not cancelled out by a refund, to date.',
  revenueD7: 'Net revenue (price × (1 − tax − store commission), refunds subtracted) from events within 7×24 h of each user’s sign-up.',
  revenueD30: 'Net revenue from events within 30×24 h of each user’s sign-up.',
  revenueToDate: 'Net revenue of the cohort’s users from all events so far (cash basis: an annual plan counts in full at purchase).',
  cpt: 'Cost per tap = spend ÷ taps.',
  ttr: 'Tap-through rate = taps ÷ impressions.',
  cpi: 'Cost per install = spend ÷ network-reported installs (Apple totalAvgCPI basis).',
  costPerUser: 'Spend ÷ attributed sign-ups.',
  costPerActivated: 'Spend ÷ attributed activated users.',
  costPerPayer: 'CAC = spend ÷ attributed payers (to date).',
  roasD7: 'Revenue D7 ÷ spend. Incomplete until every cohort day is 7 days old.',
  roasD30: 'Revenue D30 ÷ spend. Incomplete until every cohort day is 30 days old.',
  roasToDate: 'Revenue to date ÷ spend (no LTV projection).',
  installToUser: 'Attributed sign-ups ÷ network installs (low while attribution coverage is partial).',
  userToActivated: 'Activated ÷ users.',
  userToPayer: 'Payers ÷ users.',
};

/**
 * Virality tooltips (virality.definitions). Keys are ViralityMetrics fields.
 * Full definitions: docs/ADS_METRICS_METHODOLOGY.md §8 — keep the two in sync.
 */
export const VIRALITY_DEFINITIONS: Record<string, string> = {
  users: 'Sign-ups in the range (report time zone), all channels; test/internal accounts excluded.',
  sociallyActivated: 'In a non-public circle with ≥ 1 other real (non-test) member, both in the circle at the same time, within 7×24 h of sign-up. Public circles (incl. the demo circle) never count.',
  invited: 'Invited by any route the database sees within 7×24 h of sign-up: sent an email/SMS invite, someone joined through their referral link/code, or someone joined a non-public circle with invited_by = them. Share-sheet shares are not in the database.',
  invitesPerInviter: 'Email/SMS invites sent in the window (delivery failures excluded) ÷ users who sent ≥ 1.',
  inviteJoinRate: 'Invites now joined/qualified whose invitee is a real account ÷ invites sent.',
  friendsBroughtIn: 'Distinct real accounts created after the inviter that joined through the inviter’s referral or into the inviter’s non-public circle within 7×24 h of the inviter’s sign-up. Each friend counts once (referral inviter first).',
  kFactor: 'Friends brought in ÷ sign-ups (window: 7 days after each sign-up).',
  kFactorToDate: 'Friends brought in so far (no window) ÷ sign-ups.',
  blendedCac: 'Spend ÷ (paid-channel users + friends those users brought in, 7-day window). — without spend.',
  circles: 'Circle state in the first 7 days: social, alone in a private circle, only in a public circle, or no circle.',
};
