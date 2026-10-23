import fs from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

let pathname = '/food-log';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

import { BOTTOM_NAV_ITEMS, BottomNav, isNavItemActive } from '../bottom-nav';

const APP_DIR = path.resolve(__dirname, '../../..');

/** True when app/<route>/page.tsx exists directly or inside a route group like (app)/. */
function routeExists(href: string): boolean {
  const rel = href.replace(/^\//, '');
  const groups = fs.readdirSync(APP_DIR).filter((d) => d.startsWith('('));
  return ['', ...groups].some((g) => fs.existsSync(path.join(APP_DIR, g, rel, 'page.tsx')));
}

describe('BottomNav', () => {
  it('links only to routes that exist (no /checkin or /teams)', () => {
    for (const item of BOTTOM_NAV_ITEMS) {
      expect(routeExists(item.href), item.href).toBe(true);
    }
    const hrefs = BOTTOM_NAV_ITEMS.map((i) => i.href);
    expect(hrefs).not.toContain('/checkin');
    expect(hrefs).not.toContain('/teams');
  });

  it('marks the section of nested routes as current', () => {
    pathname = '/food-log/new/extra';
    expect(isNavItemActive(pathname, ['/food-log'])).toBe(true);
    expect(isNavItemActive('/food-logger', ['/food-log'])).toBe(false);
    pathname = '/settings/billing';
    render(<BottomNav />);
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /home/i })).not.toHaveAttribute('aria-current');
  });

  it('hides on full-screen flows', () => {
    pathname = '/onboarding';
    render(<BottomNav />);
    expect(screen.queryByTestId('bottom-nav')).toBeNull();
  });
});
