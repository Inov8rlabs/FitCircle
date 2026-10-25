import { describe, expect, it } from 'vitest';

import { classifyTestUser } from '../test-users';

describe('classifyTestUser', () => {
  const env = {};
  it.each([
    ['qa.automation@fitcircle.ai', 'internal'],
    ['aniruddh+fcqa-offline1021@bajirao.me', 'internal'],
    ['someone@inov8rlabs.com', 'internal'],
    ['fitcircle.user@gmail.com', 'review'],
    ['PAMZC4RGEDYKWQK2AB3YPY-LVL-00@cloudtestlabaccounts.com', 'test_lab'],
    ['newtestuser12345@example.com', 'qa'],
    ['larrythornton.09170@gmail.com', 'play_testers'],
    ['KristenHampton.92835@gmail.com', 'play_testers'],
  ])('%s → %s', (email, reason) => {
    expect(classifyTestUser({ email }, env)).toBe(reason);
  });

  it.each(['jane.doe@gmail.com', 'ankijain.india@gmail.com', 'jainanki+fitcircle@gmail.com', 'wtrmtn76tw@privaterelay.appleid.com', 'bob.1234@gmail.com', 'al.12345@gmail.com', ''])(
    'real user %s → null',
    (email) => {
      expect(classifyTestUser({ email }, env)).toBeNull();
    }
  );

  it('admins are internal whatever their email', () => {
    expect(classifyTestUser({ email: 'jane.doe@gmail.com', isAdmin: true }, env)).toBe('internal');
  });

  it("Apple's mock attribution payload is excluded", () => {
    expect(classifyTestUser({ email: 'jane.doe@gmail.com', mockAttribution: true }, env)).toBe('mock_attribution');
  });

  it('ADS_TEST_EMAILS and ADS_TEST_EMAIL_DOMAINS add internal accounts', () => {
    const e = { ADS_TEST_EMAILS: 'Friend@Gmail.com', ADS_TEST_EMAIL_DOMAINS: 'agency.io' };
    expect(classifyTestUser({ email: 'friend@gmail.com' }, e)).toBe('internal');
    expect(classifyTestUser({ email: 'x@team.agency.io' }, e)).toBe('internal');
  });
});
