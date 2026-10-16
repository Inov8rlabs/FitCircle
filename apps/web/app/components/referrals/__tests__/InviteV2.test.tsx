import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AnalyticsModule from '@/lib/analytics';

const track = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>();
  return { ...actual, analytics: { ...actual.analytics, track: (...args: unknown[]) => track(...args) } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { FriendsList } from '../FriendsList';
import { InviteByContactForm } from '../InviteByContactForm';
import { RewardCelebration } from '../RewardCelebration';
import { UnsubscribeView } from '../UnsubscribeView';

const UUID = '22222222-2222-4222-8222-222222222222';
const fetchMock = vi.fn();

beforeEach(() => {
  track.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (data: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify({ success: status < 400, data, error: null, meta: null }), { status }));

describe('InviteByContactForm', () => {
  const setup = (onSent = vi.fn()) =>
    render(<InviteByContactForm smsBody="Join me on FitCircle: https://x/i/MAYA7K2" focusSignal={0} source="hub" onSent={onSent} />);

  it('collects chips, validates input and sends emails with per-contact results', async () => {
    const onSent = vi.fn();
    setup(onSent);
    const field = screen.getByLabelText('Email or phone number');
    fireEvent.focus(field);
    expect(track).toHaveBeenCalledWith({ name: 'Referral Invite Sheet Opened', properties: { source: 'hub' } });

    fireEvent.change(field, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an email or phone number');

    fireEvent.change(field, { target: { value: 'sam@x.com' } });
    fireEvent.change(screen.getByLabelText('First name (optional)'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.getByText('Sam · sam@x.com')).toBeInTheDocument();

    fetchMock.mockReturnValueOnce(
      json({
        results: [{ contact: 'sa•••@x.com', channel: 'email', name: 'Sam', status: 'sent', inviteId: UUID }],
        sentCount: 1,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /Send invite/ }));
    await waitFor(() => expect(screen.getByTestId('invite-results')).toHaveTextContent('Invite sent ✓'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/referrals/me/invites');
    expect(JSON.parse(init.body)).toEqual({ contacts: [{ email: 'sam@x.com', name: 'Sam', channel: 'email' }] });
    expect(track).toHaveBeenCalledWith({
      name: 'Referral Contacts Invited',
      properties: { channel: 'email', count: 1, source: 'hub' },
    });
    expect(onSent).toHaveBeenCalled();
  });

  it('shows the message with Copy and an sms: link for phone numbers, never sending from the server', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Email or phone number'), { target: { value: '(416) 555-0123' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    const panel = screen.getByTestId('sms-panel');
    expect(panel).toHaveTextContent('Join me on FitCircle');
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Messages/ }).getAttribute('href')).toMatch(/^sms:\+14165550123\?&body=/);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockReturnValueOnce(
      json({ results: [{ contact: '•••• 0123', channel: 'sms', name: null, status: 'sent', inviteId: UUID }], sentCount: 1 })
    );
    fireEvent.click(screen.getByRole('button', { name: /I texted them/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ contacts: [{ phone: '+14165550123', channel: 'sms' }] });
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith({
        name: 'Referral Contacts Invited',
        properties: { channel: 'sms', count: 1, source: 'hub' },
      })
    );
  });

  it('shows opted-out results gracefully', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Email or phone number'), { target: { value: 'gone@x.com' } });
    fetchMock.mockReturnValueOnce(
      json({ results: [{ contact: 'go•••@x.com', channel: 'email', name: null, status: 'opted_out', inviteId: null }], sentCount: 0 })
    );
    fireEvent.click(screen.getByRole('button', { name: /Send invite/ }));
    await waitFor(() => expect(screen.getByTestId('invite-results')).toHaveTextContent("Can't invite this address"));
  });
});

describe('FriendsList', () => {
  const invites = [
    { id: UUID, channel: 'email' as const, name: 'Sam', contact: 'sa•••@x.com', status: 'invited' as const, sentAt: 'x', lastNudgedAt: null, nudge: { available: true, nextAt: null, remaining: 2 } },
    { id: 'i2', channel: 'sms' as const, name: 'Jo', contact: '•••• 0123', status: 'invited' as const, sentAt: 'x', lastNudgedAt: null, nudge: { available: false, nextAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), remaining: 1 } },
  ];
  const invitees = [
    { id: 'r1', displayName: 'Lee', avatarUrl: null, status: 'pending' as const, joinedAt: 'x', qualifiedAt: null, circleName: null, nudge: { available: false, nextAt: null, remaining: 0 } },
    { id: 'r2', displayName: 'Ana', avatarUrl: null, status: 'review' as const, joinedAt: 'x', qualifiedAt: null, circleName: null },
  ];

  it('renders merged rows with chips and nudge states', () => {
    render(<FriendsList invites={invites} invitees={invitees} onChanged={vi.fn()} />);
    const rows = screen.getAllByTestId('friend-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Invited · email'),
      expect.stringContaining('Invited · text'),
      expect.stringContaining('Joined · waiting for first check-in'),
      expect.stringContaining('Checking…'),
    ]);
    expect(rows[0]).toHaveTextContent('Nudge');
    expect(rows[1]).toHaveTextContent('Nudged · again in 2d');
    expect(rows[2]).not.toHaveTextContent(/Nudge/);
  });

  it('nudges via the API and tracks it', async () => {
    const onChanged = vi.fn();
    fetchMock.mockReturnValueOnce(json({ status: 'sent', nextAt: null, remaining: 1, smsBody: null }));
    render(<FriendsList invites={invites} invitees={invitees} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nudge' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ inviteId: UUID });
    expect(track).toHaveBeenCalledWith({ name: 'Referral Nudge Sent', properties: { target: 'invited', channel: 'email' } });
  });

  it('shows the empty state', () => {
    render(<FriendsList invites={[]} invitees={[]} onChanged={vi.fn()} />);
    expect(screen.getByText('No friends yet')).toBeInTheDocument();
  });
});

describe('RewardCelebration', () => {
  const reward = { id: UUID, kind: 'inviter_week' as const, days: 7, friendName: 'Sam', createdAt: 'x' };

  it('leads with the invite CTA and keeps Done secondary', () => {
    const onInvite = vi.fn();
    const onDone = vi.fn();
    render(<RewardCelebration rewards={[reward]} weeksEarned={2} onDone={onDone} onInvite={onInvite} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite friends — earn a week for each' }));
    expect(onInvite).toHaveBeenCalledWith('inviter_week');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });
});

describe('UnsubscribeView', () => {
  it.each([
    ['done', "Done — you won't get FitCircle invites anymore"],
    ['invalid', 'This unsubscribe link is invalid or expired'],
    ['error', 'Something went wrong'],
  ] as const)('%s state', (state, text) => {
    render(<UnsubscribeView state={state} />);
    expect(screen.getByTestId(`unsubscribe-${state}`)).toHaveTextContent(text);
  });
});
