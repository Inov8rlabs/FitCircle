/**
 * Response shaping for the profile row returned by PUT /api/mobile/profile.
 *
 * Additive only: every key and value of the stored row is returned as it is;
 * this only FILLS IN what is missing.
 *
 * Why: the route returns the raw `profiles` row. `preferences` defaults to `{}`
 * in Postgres, and the iOS `User` model (Core/Models/User.swift) needs
 * `preferences.notifications`, `.privacy` and `.display` with every key present
 * (synthesized Swift Codable does not apply property defaults). Without them the
 * save succeeds on the server and iOS still reports a decoding error.
 */
import { isProfileGender } from '@/lib/validation/profile-validation';

type Json = Record<string, any>;

function asObject(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

/** `existing`, plus every key of `defaults` that is missing (or null) in it. */
function fillMissing(existing: Json, defaults: Json): Json {
  const out: Json = { ...existing };
  for (const [key, value] of Object.entries(defaults)) {
    if (out[key] === undefined || out[key] === null) out[key] = value;
  }
  return out;
}

const VISIBILITY = new Set(['public', 'friends', 'private']);

/**
 * Stored preferences plus the defaults the mobile clients expect. The defaults
 * are the ones GET /api/mobile/profile already returns
 * (MobileAPIService.getUserProfileWithStats).
 */
export function withPreferenceDefaults(stored: unknown): Json {
  const preferences = asObject(stored);
  const privacy = asObject(preferences.privacy);
  const legacyVisibility = VISIBILITY.has(privacy.profileVisibility) ? privacy.profileVisibility : undefined;

  return {
    ...preferences,
    notifications: fillMissing(asObject(preferences.notifications), {
      push: true,
      email: true,
      sms: false,
      challenge_invite: true,
      team_invite: true,
      check_in_reminder: true,
      achievement: true,
      comment: true,
      reaction: true,
      leaderboard_update: true,
      weekly_insights: true,
    }),
    privacy: fillMissing(privacy, {
      profile_visibility: legacyVisibility ?? 'public',
      show_weight: typeof privacy.showWeight === 'boolean' ? privacy.showWeight : true,
      show_progress: typeof privacy.showProgress === 'boolean' ? privacy.showProgress : true,
      allow_team_invites: typeof privacy.allowTeamInvites === 'boolean' ? privacy.allowTeamInvites : true,
      allow_challenge_invites:
        typeof privacy.allowChallengeInvites === 'boolean' ? privacy.allowChallengeInvites : true,
    }),
    display: fillMissing(asObject(preferences.display), {
      theme: 'dark',
      language: 'en',
      units: preferences.unitSystem === 'imperial' ? 'imperial' : 'metric',
    }),
  };
}

/**
 * `gender` as it may be sent to a client: one of the four known values or null.
 * iOS decodes it as a closed enum, so nothing else may ever go out.
 */
export function safeGender(value: unknown): string | null {
  return isProfileGender(value) ? value : null;
}

/** The updated profile row, decodable by the shipped clients. */
export function toProfileUpdateResponse(row: Json | null | undefined): Json | null | undefined {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    preferences: withPreferenceDefaults(row.preferences),
    // Present only once migration 088 is applied; absent before (clients treat it as optional).
    ...('gender' in row ? { gender: safeGender(row.gender) } : {}),
  };
}
