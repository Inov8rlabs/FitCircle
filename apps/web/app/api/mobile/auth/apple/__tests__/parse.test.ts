import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  APPLE_NATIVE_BUNDLE_ID,
  appleTokenAudiences,
  parseAppleAuthRequest,
} from '../route';

describe('parseAppleAuthRequest', () => {
  it('accepts the iOS Sign in with Apple body', () => {
    const parsed = parseAppleAuthRequest({
      identity_token: 'header.payload.sig',
      authorization_code: 'code',
      user_identifier: '001234.apple',
      full_name: { given_name: 'Ani', family_name: 'Bajirao' },
      email: 'ani@bajirao.me',
    });

    expect(parsed).toEqual({
      identityToken: 'header.payload.sig',
      userIdentifier: '001234.apple',
      email: 'ani@bajirao.me',
      firstName: 'Ani',
      lastName: 'Bajirao',
    });
  });

  it('accepts a later sign-in that omits the name and authorization code', () => {
    const parsed = parseAppleAuthRequest({
      identity_token: 'header.payload.sig',
      user_identifier: '001234.apple',
    });

    expect(parsed.firstName).toBe('');
    expect(parsed.lastName).toBe('');
    expect(parsed.email).toBeUndefined();
  });

  it('still accepts the previous camelCase body', () => {
    const parsed = parseAppleAuthRequest({
      identityToken: 'header.payload.sig',
      authorizationCode: 'code',
      userIdentifier: '001234.apple',
      user: {
        email: 'ani@bajirao.me',
        name: { firstName: 'Ani', lastName: 'Bajirao' },
      },
    });

    expect(parsed.email).toBe('ani@bajirao.me');
    expect(parsed.firstName).toBe('Ani');
    expect(parsed.lastName).toBe('Bajirao');
  });

  it('rejects a body with no identity token', () => {
    expect(() => parseAppleAuthRequest({ user_identifier: '001234.apple' })).toThrow(ZodError);
  });
});

describe('appleTokenAudiences', () => {
  it('always includes the Inov8r Labs bundle id', () => {
    const previousClient = process.env.APPLE_CLIENT_ID;
    const previousBundle = process.env.APPLE_BUNDLE_ID;
    process.env.APPLE_CLIENT_ID = 'com.inov8rlabs.FitCircle';
    process.env.APPLE_BUNDLE_ID = 'com.example.services';

    try {
      expect(appleTokenAudiences()).toEqual([
        APPLE_NATIVE_BUNDLE_ID,
        'com.inov8rlabs.FitCircle',
        'com.example.services',
      ]);
    } finally {
      if (previousClient === undefined) delete process.env.APPLE_CLIENT_ID;
      else process.env.APPLE_CLIENT_ID = previousClient;
      if (previousBundle === undefined) delete process.env.APPLE_BUNDLE_ID;
      else process.env.APPLE_BUNDLE_ID = previousBundle;
    }
  });
});
