import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/food-log',
  useRouter: () => ({ replace, push }),
}));
vi.mock('@/components/layout/navbar', () => ({ Navbar: () => null }));

let resolveCheck: () => void = () => {};
const authState = { isAuthenticated: false, checkAuth: vi.fn() };
vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => authState }));
vi.mock('@/stores/ui-store', () => ({ useUIStore: () => ({ setBottomNavVisible: vi.fn() }) }));

import AppLayout from '../layout';

describe('(app) layout auth redirect', () => {
  beforeEach(() => {
    replace.mockReset();
    push.mockReset();
    authState.isAuthenticated = false;
    authState.checkAuth = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveCheck = r;
        })
    );
  });

  it('does not bounce a direct load to /login while the session check is pending', () => {
    render(
      <AppLayout>
        <p>food log</p>
      </AppLayout>
    );
    expect(screen.getByText('food log')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('stays put when the check finds a session', async () => {
    const { rerender } = render(
      <AppLayout>
        <p>food log</p>
      </AppLayout>
    );
    authState.isAuthenticated = true;
    await act(async () => resolveCheck());
    rerender(
      <AppLayout>
        <p>food log</p>
      </AppLayout>
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to login (with returnUrl) once the check finds no session', async () => {
    render(
      <AppLayout>
        <p>food log</p>
      </AppLayout>
    );
    await act(async () => resolveCheck());
    expect(replace).toHaveBeenCalledWith('/login?returnUrl=%2Ffood-log');
  });
});
