import { z } from 'zod';

/** Native Sign in with Apple identity tokens use the iOS bundle id as `aud`. */
export const APPLE_NATIVE_BUNDLE_ID = 'com.inov8rlabs.apps.fitcircle';

const optionalText = z.string().nullish();

const appleAuthSchema = z.object({
  identityToken: optionalText,
  identity_token: optionalText,
  authorizationCode: optionalText,
  authorization_code: optionalText,
  userIdentifier: optionalText,
  user_identifier: optionalText,
  email: optionalText,
  full_name: z
    .object({
      given_name: optionalText,
      family_name: optionalText,
    })
    .nullish(),
  fullName: z
    .object({
      givenName: optionalText,
      familyName: optionalText,
    })
    .nullish(),
  user: z
    .object({
      email: optionalText,
      name: z
        .object({
          firstName: optionalText,
          lastName: optionalText,
        })
        .nullish(),
    })
    .nullish(),
});

export interface AppleAuthRequest {
  identityToken: string;
  userIdentifier: string;
  /** Present only when the client sent one. The identity token's email wins. */
  email?: string;
  firstName: string;
  lastName: string;
}

function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Audiences accepted for an Apple identity token.
 * The native bundle id is always included so a stale Services ID or the
 * pre-migration bundle id in the environment cannot reject the iOS app.
 */
export function appleTokenAudiences(): string[] {
  const configured = [process.env.APPLE_CLIENT_ID, process.env.APPLE_BUNDLE_ID]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set([APPLE_NATIVE_BUNDLE_ID, ...configured]));
}

/** Accept the iOS snake_case body and the older camelCase body. */
export function parseAppleAuthRequest(body: unknown): AppleAuthRequest {
  const parsed = appleAuthSchema.parse(body);
  const identityToken = text(parsed.identity_token) ?? text(parsed.identityToken);
  const userIdentifier = text(parsed.user_identifier) ?? text(parsed.userIdentifier);

  if (!identityToken || !userIdentifier) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: [identityToken ? 'user_identifier' : 'identity_token'],
        message: identityToken ? 'user_identifier is required' : 'identity_token is required',
      },
    ]);
  }

  const email = text(parsed.email) ?? text(parsed.user?.email);
  const firstName =
    text(parsed.full_name?.given_name) ??
    text(parsed.fullName?.givenName) ??
    text(parsed.user?.name?.firstName) ??
    '';
  const lastName =
    text(parsed.full_name?.family_name) ??
    text(parsed.fullName?.familyName) ??
    text(parsed.user?.name?.lastName) ??
    '';

  return {
    identityToken,
    userIdentifier,
    email: email && z.string().email().safeParse(email).success ? email : undefined,
    firstName,
    lastName,
  };
}
