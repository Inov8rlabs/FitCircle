/** Web Fitzy chat: trial-first pre-send gate (docs/TRIAL_FIRST_SPEC.md §7). */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  entitlements: null as any,
  trialDays: 0,
  chat: vi.fn(),
}));

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ entitlements: state.entitlements, isPro: state.entitlements?.tier === 'premium', isLoading: false }) }));
vi.mock('@/hooks/useWebTrial', () => ({ useWebTrial: () => ({ trialDays: state.trialDays, loading: false }) }));
vi.mock('@/lib/api/nutrition-client', () => ({ nutritionClient: { fitzyChat: (...a: unknown[]) => state.chat(...a) } }));
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: any) => unknown) => sel({ user: { id: 'u1' } }) }));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => children }));
vi.mock('remark-gfm', () => ({ default: () => undefined }));

import { FitzyChat, fitzyGateCopy, isFitzyChatLocked } from '../FitzyChat';

const FREE = { tier: 'free', subscriptionsEnabled: true, features: { fitzy_unlimited: { allowed: false, requiredTier: 'premium' } }, limits: { fitzyMessagesPerDay: 0 } };

beforeEach(() => {
  (Element.prototype as any).scrollTo = vi.fn(); // jsdom has no element scrolling
  state.chat.mockReset();
  state.entitlements = FREE;
  state.trialDays = 3;
  try {
    window.localStorage.removeItem("fitzy.history.u1");
  } catch {
    // storage unavailable in this env
  }
});

describe('isFitzyChatLocked / copy', () => {
  it('locked only when the gate denies AND the free allowance is 0', () => {
    expect(isFitzyChatLocked(FREE)).toBe(true);
    expect(isFitzyChatLocked({ ...FREE, limits: { fitzyMessagesPerDay: 3 } })).toBe(false);
    expect(isFitzyChatLocked({ ...FREE, features: { fitzy_unlimited: { allowed: true } } })).toBe(false);
    expect(isFitzyChatLocked(null)).toBe(false);
    expect(fitzyGateCopy(3)).toEqual({ headline: 'Try Pro free for 3 days', sub: 'Cancel anytime. Start your free trial to chat with Fitzy.', cta: 'Start free trial' });
    expect(fitzyGateCopy(0)).toMatchObject({ headline: 'Unlock Fitzy Pro', cta: 'Continue with Pro' });
  });
});

describe('<FitzyChat />', () => {
  it('free user: sending shows the trial paywall, never calls the API, keeps the typed text', async () => {
    const user = userEvent.setup();
    render(<FitzyChat />);
    await user.type(screen.getByPlaceholderText('Message Fitzy…'), 'Dinner idea?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(state.chat).not.toHaveBeenCalled();
    const card = await screen.findByTestId('fitzy-paywall');
    expect(card).toHaveTextContent('Try Pro free for 3 days');
    expect(screen.getByRole('link', { name: 'Start free trial' })).toHaveAttribute('href', '/upgrade?source=fitzy_send');
    expect(screen.getByPlaceholderText('Message Fitzy…')).toHaveValue('Dinner idea?');
  });

  it('Pro / trial: sends normally', async () => {
    state.entitlements = { tier: 'premium', subscriptionsEnabled: true, features: { fitzy_unlimited: { allowed: true } }, limits: { fitzyMessagesPerDay: 200 } };
    state.chat.mockResolvedValue({ answer: 'Try salmon.', disclaimer: 'Not medical advice.' });
    const user = userEvent.setup();
    render(<FitzyChat />);
    await user.type(screen.getByPlaceholderText('Message Fitzy…'), 'Dinner idea?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Try salmon.')).toBeInTheDocument();
    expect(screen.queryByTestId('fitzy-paywall')).toBeNull();
  });

  it('server UPGRADE_REQUIRED (stale entitlements) → same paywall card, input restored', async () => {
    state.entitlements = { ...FREE, limits: { fitzyMessagesPerDay: 5 } };
    state.trialDays = 0;
    const err = Object.assign(new Error('Upgrade to Pro to chat with Fitzy.'), { code: 'UPGRADE_REQUIRED', details: {} });
    state.chat.mockRejectedValue(err);
    const user = userEvent.setup();
    render(<FitzyChat />);
    await user.type(screen.getByPlaceholderText('Message Fitzy…'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByTestId('fitzy-paywall')).toHaveTextContent('Unlock Fitzy Pro');
    expect(screen.getByPlaceholderText('Message Fitzy…')).toHaveValue('hi');
  });
});
