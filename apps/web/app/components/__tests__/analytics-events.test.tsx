import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PricingCards } from '@/components/billing/PricingCards';
import { StoreButton } from '@/components/marketing/StoreButton';
import type * as AnalyticsModule from '@/lib/analytics';

const track = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>();
  return { ...actual, analytics: { ...actual.analytics, track: (...args: unknown[]) => track(...args) } };
});
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

describe('landing store badges', () => {
  beforeEach(() => track.mockClear());

  it('tracks App Store Link Clicked with store and placement', () => {
    render(
      <StoreButton
        href="https://apps.apple.com/app/id1"
        eyebrow="Download on the"
        label="App Store"
        comingSoon={false}
        icon={null}
        store="app_store"
        placement="landing_download_section"
      />
    );
    fireEvent.click(screen.getByRole('link'));
    expect(track).toHaveBeenCalledWith({
      name: 'App Store Link Clicked',
      properties: { store: 'app_store', placement: 'landing_download_section' },
    });
  });

  it('renders no link (and tracks nothing) while a listing is coming soon', () => {
    render(
      <StoreButton
        href=""
        eyebrow="Get it on"
        label="Google Play"
        comingSoon
        icon={null}
        store="play_store"
        placement="landing_download_section"
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});

describe('pricing paywall', () => {
  const originalLocation = window.location;
  const assign = vi.fn();

  beforeEach(() => {
    track.mockClear();
    assign.mockClear();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.unstubAllGlobals();
  });

  it('tracks plan selection and Purchase Started, then remembers the checkout source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ url: 'https://checkout.stripe.com/x' }), { status: 200 })))
    );
    render(<PricingCards source="streak_shield" />);

    fireEvent.click(screen.getByRole('button', { name: /Monthly/ }));
    expect(track).toHaveBeenCalledWith({
      name: 'Paywall Plan Selected',
      properties: { source: 'streak_shield', plan: 'monthly', product_id: 'stripe_pro_monthly' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Continue to checkout/ }));
    expect(track).toHaveBeenCalledWith({
      name: 'Purchase Started',
      properties: { source: 'streak_shield', plan: 'monthly', product_id: 'stripe_pro_monthly', store: 'stripe' },
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/x'));
    expect(JSON.parse(sessionStorage.getItem('fc_checkout_context') ?? '{}')).toMatchObject({
      plan: 'monthly',
      source: 'streak_shield',
    });
  });

  it('tracks Purchase Failed when checkout cannot start', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: 'x' }), { status: 500 }))));
    render(<PricingCards />);

    fireEvent.click(screen.getByRole('button', { name: /Continue to checkout/ }));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith({
        name: 'Purchase Failed',
        properties: {
          source: 'pricing_page',
          plan: 'annual',
          product_id: 'stripe_pro_annual',
          store: 'stripe',
          error_kind: 'server',
        },
      })
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
