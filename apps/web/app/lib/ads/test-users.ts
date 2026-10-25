/**
 * Which sign-ups are not real customers, so the ads console can leave them out
 * of users / activation / payers / revenue (docs/ADS_CONSOLE_SPEC.md §5).
 *
 * Pure. Rules, first match wins:
 *  - internal:   profiles.is_admin, our own domains, ADS_TEST_EMAILS
 *  - review:     the App Store reviewer demo account
 *  - test_lab:   Firebase Test Lab / Play pre-launch report devices
 *  - qa:         example.com style throwaway addresses
 *  - play_testers: Google's generated `firstnamelastname.12345@gmail.com`
 *                accounts that sign up in batches after each Play release
 *                (heuristic; real users essentially never use this shape)
 *  - mock_attribution: Apple's AdServices mock payload (TestFlight / dev builds)
 */

export type TestUserReason = 'internal' | 'review' | 'test_lab' | 'qa' | 'play_testers' | 'mock_attribution';

export const TEST_USER_REASONS: TestUserReason[] = ['internal', 'review', 'test_lab', 'qa', 'play_testers', 'mock_attribution'];

const INTERNAL_DOMAINS = ['fitcircle.ai', 'inov8rlabs.com', 'bajirao.me'];
const REVIEW_EMAILS = ['fitcircle.user@gmail.com'];
const TEST_LAB_DOMAINS = ['cloudtestlabaccounts.com'];
const QA_DOMAINS = ['example.com', 'example.org', 'example.net', 'test.com'];
const PLAY_TESTER_RE = /^[a-z]{4,}\.\d{5}@gmail\.com$/;

export interface TestUserInput {
  email: string | null | undefined;
  isAdmin?: boolean | null;
  mockAttribution?: boolean;
}

function listEnv(name: string, env: Record<string, string | undefined>): string[] {
  return (env[name] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1);
}

function matchesDomain(domain: string, list: string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Null for a real user, else why the user is excluded. */
export function classifyTestUser(user: TestUserInput, env: Record<string, string | undefined> = process.env): TestUserReason | null {
  const email = (user.email ?? '').trim().toLowerCase();
  const domain = email.includes('@') ? domainOf(email) : '';

  if (user.isAdmin) return 'internal';
  if (email && listEnv('ADS_TEST_EMAILS', env).includes(email)) return 'internal';
  if (domain && matchesDomain(domain, [...INTERNAL_DOMAINS, ...listEnv('ADS_TEST_EMAIL_DOMAINS', env)])) return 'internal';
  if (REVIEW_EMAILS.includes(email)) return 'review';
  if (domain && matchesDomain(domain, TEST_LAB_DOMAINS)) return 'test_lab';
  if (domain && matchesDomain(domain, QA_DOMAINS)) return 'qa';
  if (PLAY_TESTER_RE.test(email)) return 'play_testers';
  if (user.mockAttribution) return 'mock_attribution';
  return null;
}
