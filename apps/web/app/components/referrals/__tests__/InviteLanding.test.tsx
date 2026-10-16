import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AnalyticsModule from '@/lib/analytics';
import type { ReferralPreview } from '@/lib/referrals/types';

const track = vi.fn();
let mockUser: { id: string; name: string } | null = null;

vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>();
  return { ...actual, analytics: { ...actual.analytics, track: (...args: unknown[]) => track(...args) } };
});
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector?: (s: { user: typeof mockUser }) => unknown) =>
    selector ? selector({ user: mockUser }) : { user: mockUser },
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { InviteLanding } from '../InviteLanding';

const personal: ReferralPreview = {
  valid: true,
  kind: 'personal',
  code: 'MAYA7K2',
  inviter: { firstName: 'Maya', displayName: 'Maya R.', avatarUrl: null },
  circle: null,
  inviteeRewardDays: 7,
};

const circle: ReferralPreview = {
  ...personal,
  kind: 'circle',
  code: 'FITAB12CD',
  circle: {
    name: 'Morning Movers',
    inviteCode: 'FITAB12CD',
    memberCount: 3,
    memberAvatars: [],
    challengeType: 'step_count',
  },
};

const base = { appStoreUrl: 'https://apps.apple.com/app/id1', playStoreLive: true, initialPlatform: 'desktop' as const };

function clearCookies() {
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
}

describe('InviteLanding', () => {
  beforeEach(() => {
    track.mockClear();
    mockUser = null;
    clearCookies();
  });

  it('renders a valid personal invite with reward, store buttons and web signup', async () => {
    render(<InviteLanding kind="personal" code="MAYA7K2" refCode={null} preview={personal} {...base} />);

    expect(screen.getByTestId('invite-headline')).toHaveTextContent('Maya saved you a seat');
    expect(screen.getByTestId('invite-reward')).toHaveTextContent('You and Maya both get a free week of Pro');
    expect(screen.getByTestId('invite-reward')).toHaveTextContent(/first check-in/);
    expect(screen.queryByTestId('invite-circle-card')).not.toBeInTheDocument();
    // jsdom's UA is desktop → both stores.
    expect(screen.getByRole('button', { name: /App Store/ })).toBeInTheDocument();
    const play = screen.getByRole('link', { name: /Google Play/ });
    expect(play.getAttribute('href')).toContain('referrer=fc_ref%3DMAYA7K2');
    expect(screen.getByRole('link', { name: /Continue on the web/ })).toHaveAttribute('href', '/register?ref=MAYA7K2');
    expect(document.body.textContent).not.toMatch(/download and get/i);

    await waitFor(() => expect(document.cookie).toContain('fc_ref='));
    const raw = document.cookie.split('; ').find((c) => c.startsWith('fc_ref='))!.slice('fc_ref='.length);
    expect(JSON.parse(decodeURIComponent(raw))).toMatchObject({ code: 'MAYA7K2', ref: 'MAYA7K2', circle: null });
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith({ name: 'Invite Link Opened', properties: { signed_in: false } })
    );
  });

  it('renders a valid circle invite with the circle card and circle-aware links', async () => {
    render(<InviteLanding kind="circle" code="FITAB12CD" refCode="MAYA7K2" preview={circle} {...base} />);

    const card = screen.getByTestId('invite-circle-card');
    expect(card).toHaveTextContent('Morning Movers');
    expect(card).toHaveTextContent('3 members');
    expect(card).toHaveTextContent('Steps');
    expect(card).toHaveTextContent('Your seat');
    expect(screen.getByRole('link', { name: /Continue on the web/ })).toHaveAttribute(
      'href',
      '/register?ref=MAYA7K2&circle=FITAB12CD'
    );
    expect(screen.getByRole('link', { name: /Google Play/ }).getAttribute('href')).toContain(
      encodeURIComponent('fc_ref=MAYA7K2&fc_circle=FITAB12CD')
    );
    await waitFor(() => expect(document.cookie).toContain('fc_ref='));
  });

  it('shows "Join circle" to signed-in users on a circle invite', async () => {
    mockUser = { id: 'u1', name: 'Sam' };
    render(<InviteLanding kind="circle" code="FITAB12CD" refCode="MAYA7K2" preview={circle} {...base} />);
    expect(await screen.findByRole('button', { name: /Join circle/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Continue on the web/ })).not.toBeInTheDocument();
  });

  it('tells signed-in users on a personal invite they are already on FitCircle', async () => {
    mockUser = { id: 'u1', name: 'Sam' };
    render(<InviteLanding kind="personal" code="MAYA7K2" refCode={null} preview={personal} {...base} />);
    expect(await screen.findByText(/You're already on FitCircle/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to your invite hub/ })).toHaveAttribute('href', '/invite');
  });

  it('hides the reward when the invitee reward is disabled', () => {
    render(
      <InviteLanding kind="personal" code="MAYA7K2" refCode={null} preview={{ ...personal, inviteeRewardDays: 0 }} {...base} />
    );
    expect(screen.queryByTestId('invite-reward')).not.toBeInTheDocument();
  });

  it('shows "Coming soon" when the App Store URL is not configured', () => {
    render(
      <InviteLanding kind="personal" code="MAYA7K2" refCode={null} preview={personal} {...base} appStoreUrl="" />
    );
    expect(screen.queryByRole('button', { name: /App Store/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0);
  });

  it('renders the friendly invalid state and sets no cookie', async () => {
    render(<InviteLanding kind="personal" code="NOPE1" refCode={null} preview={{ valid: false }} {...base} />);
    expect(screen.getByTestId('invite-invalid')).toHaveTextContent('This invite has expired or the code is wrong');
    expect(screen.getByRole('link', { name: /Go to FitCircle/ })).toHaveAttribute('href', '/');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.cookie).not.toContain('fc_ref=');
  });
});
