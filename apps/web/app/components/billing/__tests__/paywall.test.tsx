import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AnalyticsModule from '@/lib/analytics';

const track = vi.fn();
vi.mock('@/lib/analytics', async (orig) => {
  const actual = await orig<typeof AnalyticsModule>();
  return { ...actual, analytics: { ...actual.analytics, track: (...a: unknown[]) => track(...a) } };
});

const entitlementsState = {
  entitlements: { subscriptionsEnabled: true } as Record<string, unknown> | null,
  isPro: false,
  isLoading: false,
};
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => entitlementsState }));
vi.mock('@/components/layout/navbar', () => ({ Navbar: () => null }));

import UpgradePage from '../../../upgrade/page';
import { PricingCards } from '../PricingCards';

describe('PricingCards (restyled iOS plan rows)', () => {
  const assign = vi.fn();
  beforeEach(() => {
    track.mockReset();
    assign.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.test/s' }) }) as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('pre-selects monthly and keeps the existing prices', () => {
    render(<PricingCards source="test" />);
    expect(screen.getByTestId('plan-monthly')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('plan-annual')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('plan-annual')).toHaveTextContent('$29.99');
    expect(screen.getByTestId('plan-monthly')).toHaveTextContent('$9.99');
  });

  it('checks out the selected plan through POST /api/billing/checkout and redirects to Stripe', async () => {
    const user = userEvent.setup();
    render(<PricingCards source="test" />);
    await user.click(screen.getByTestId('plan-monthly'));
    expect(screen.getByTestId('plan-monthly')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('checkout-button'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/s'));
    expect(global.fetch).toHaveBeenCalledWith('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly' }),
    });
    const names = track.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(names).toContain('Paywall Plan Selected');
    expect(names).toContain('Purchase Started');
  });
});

describe('/upgrade paywall layout', () => {
  beforeEach(() => {
    entitlementsState.entitlements = { subscriptionsEnabled: true };
    entitlementsState.isPro = false;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ trialDays: 0, eligible: false }) }) as unknown as typeof fetch;
  });

  it('trial-first (TRIAL_FIRST_SPEC §7): "Try Pro free for 7 days" + Cancel anytime + the trial CTA (monthly pre-selected) when checkout would carry the trial', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ trialDays: 7, eligible: true }) }) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<UpgradePage />);
    expect(await screen.findByText('Try Pro free for 7 days')).toBeInTheDocument();
    expect(screen.getByTestId('paywall-cancel-anytime')).toHaveTextContent('Cancel anytime');
    expect(screen.getByTestId('plan-monthly')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('checkout-button')).toHaveTextContent('Start free trial — $0 today, then $9.99/month after your 7-day trial. Cancel anytime.');
    expect(screen.getByTestId('trial-terms')).toHaveTextContent("Cancel anytime before the trial ends and you won't be charged.");
    await user.click(screen.getByTestId('plan-annual'));
    expect(screen.getByTestId('checkout-button')).toHaveTextContent('Start free trial — $0 today, then $29.99/year after your 7-day trial. Cancel anytime.');
    expect(global.fetch).toHaveBeenCalledWith('/api/billing/trial', { cache: 'no-store' });
  });

  it('the trial length in the CTA is whatever the server says (single source of truth)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ trialDays: 14, eligible: true }) }) as unknown as typeof fetch;
    render(<UpgradePage />);
    expect(await screen.findByText('Try Pro free for 14 days')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-button')).toHaveTextContent('then $9.99/month after your 14-day trial');
  });

  it('no trial → classic headline and checkout CTA (never promises a trial checkout will not give)', async () => {
    render(<UpgradePage />);
    expect(await screen.findByTestId('paywall-headline')).toHaveTextContent('Unlock FitCircle Pro');
    expect(screen.queryByTestId('paywall-cancel-anytime')).toBeNull();
    expect(screen.getByTestId('checkout-button')).toHaveTextContent('Continue to checkout');
  });

  it('shows the iOS paywall header, feature list, plans and comparison', async () => {
    render(<UpgradePage />);
    expect(await screen.findByTestId('paywall-header')).toHaveTextContent('Unlock FitCircle Pro');
    expect(screen.getByTestId('paywall-features')).toHaveTextContent('Unlimited AI logging');
    expect(await screen.findByTestId('plan-annual')).toBeInTheDocument();
    expect(screen.getByTestId('plan-comparison')).toBeInTheDocument();
  });

  it('tells Pro members they are already Pro instead of showing plans', async () => {
    entitlementsState.isPro = true;
    render(<UpgradePage />);
    expect(await screen.findByText(/already Pro/)).toBeInTheDocument();
    expect(screen.queryByTestId('plan-annual')).toBeNull();
  });

  it('shows coming soon when subscriptions are off', () => {
    entitlementsState.entitlements = { subscriptionsEnabled: false };
    render(<UpgradePage />);
    expect(screen.getByText('FitCircle Pro is coming soon')).toBeInTheDocument();
  });
});
