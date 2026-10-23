import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { getAppCalls } = vi.hoisted(() => ({ getAppCalls: [] as Array<Record<string, unknown>> }));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (p: Record<string, unknown>) => <img src={String(p.src)} alt={String(p.alt ?? '')} />,
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' }),
}));
vi.mock('@/components/app-links/QrCode', () => ({
  QrCode: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}));
vi.mock('@/components/app-links/AppBanner', () => ({ AppBanner: () => null }));
vi.mock('@/components/app-links/GetAppButton', () => ({
  GetAppButton: (p: Record<string, unknown>) => {
    getAppCalls.push(p);
    return <a href="/get">{String(p.label ?? 'Get the app')}</a>;
  },
}));
vi.mock('@/components/app-links/StoreBadge', () => ({
  StoreBadge: ({ store, href }: { store: string; href: string }) => <a data-testid={`badge-${store}`} href={href} />,
}));
vi.mock('@/components/landing/LandingNav', () => ({ LandingNav: () => null, WebCta: () => <a href="/register">Use it on the web</a> }));
vi.mock('@/components/landing/HeroPhones', () => ({ HeroPhones: () => <div data-testid="hero-phones" /> }));
vi.mock('@/components/landing/PricingViewTracker', () => ({ PricingViewTracker: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/landing/Reveal', () => ({ Reveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { FAQ_ITEMS } from '../../app/components/landing/faq';
import LandingPage, { metadata } from '../../app/page';

async function renderLanding(search: Record<string, string> = {}) {
  getAppCalls.length = 0;
  render(await LandingPage({ searchParams: Promise.resolve(search) }));
}

describe('landing page', () => {
  it('carries invite and UTM params into every Get the app CTA, the store badges and the QR', async () => {
    await renderLanding({ ref: 'anki7qx', utm_source: 'meta', utm_campaign: 'htl', evil: '<x>' });
    expect(getAppCalls.length).toBe(2); // hero + final (the nav one is mocked out with LandingNav)
    for (const call of getAppCalls) {
      expect(call.params).toEqual({ ref: 'ANKI7QX', circle: null, utm: { utm_source: 'meta', utm_campaign: 'htl' } });
    }
    expect(screen.getByTestId('qr').getAttribute('data-value')).toContain('ref=ANKI7QX');
    const play = screen.getAllByTestId('badge-play_store')[0].getAttribute('href') ?? '';
    expect(decodeURIComponent(play)).toContain('fc_ref=ANKI7QX');
    expect(decodeURIComponent(play)).toContain('utm_source=meta');
  });

  it('shows the real prices and makes no social-proof claims', async () => {
    await renderLanding();
    const text = document.body.textContent ?? '';
    expect(text).toContain('$29.99');
    expect(text).toContain('$9.99');
    expect(text).toContain('$179.99');
    expect(text).not.toMatch(/testimonial|\breviews\b|\bratings?\b|\brated\b|★|\d+[kKmM]?\+? (users|downloads|people|members)|as seen in|loved by|trusted by/i);
  });


  it('has a canonical URL, OG and Twitter images', () => {
    expect(metadata.alternates?.canonical).toBe('/');
    expect(JSON.stringify(metadata.openGraph)).toContain('/landing/og.jpg');
    expect(JSON.stringify(metadata.twitter)).toContain('summary_large_image');
  });

  it('publishes the FAQ as FAQPage JSON-LD matching the visible questions', async () => {
    await renderLanding();
    const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}');
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity.map((q: { name: string }) => q.name)).toEqual(FAQ_ITEMS.map((f) => f.q));
    for (const f of FAQ_ITEMS) expect(screen.getByText(f.q)).toBeInTheDocument();
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(10);
  });

  it('never implies a refund on cancel and never promises lifetime as always available', async () => {
    await renderLanding();
    const text = document.body.textContent ?? '';
    // Every "cancel any time" is qualified with what cancelling actually does.
    for (const m of text.matchAll(/cancel any ?time/gi)) {
      expect(text.slice(m.index, m.index + 80)).toMatch(/stop the next renewal/i);
    }
    expect(text).toMatch(/no refunds for partial periods/i);
    expect(text).toMatch(/\$179\.99\) when it’s offered/);
    expect(text).not.toMatch(/unlimited AI/i);
  });
});
