// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  user: '11111111-1111-4111-8111-111111111111' as string | null,
  clients: [] as any[],
  failures: 0,
  router: { push: vi.fn() },
  release: null as null | (() => void),
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: any) =>
    selector({ user: state.user ? { id: state.user } : null }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: state.user
            ? { user: { id: state.user }, access_token: 'test' }
            : null,
        },
      }),
    },
  },
}));
vi.mock('@inov8r/engage-web', () => ({
  EngageClient: class {
    identify = vi.fn(async () => {
      if (state.failures > 0) {
        state.failures--;
        throw new Error('offline');
      }
    });
    refresh = vi.fn(async () => {});
    webPushOpened = vi.fn(async () => false);
    logout = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          state.release = resolve;
        }),
    );
    constructor() {
      state.clients.push(this);
    }
  },
}));
import {
  EngageSessionProvider,
  useEngageSession,
} from '@/components/engage/EngageSessionProvider';
function Probe({ page }: { page: string }) {
  const session = useEngageSession();
  return (
    <span data-testid="session">
      {page}:{session?.user ?? 'none'}
    </span>
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  state.release?.();
  state.release = null;
  state.clients = [];
  state.failures = 0;
});
describe('root-owned Engage browser session', () => {
  it('survives route changes and Strict Mode, but clears old content and waits for unbind before changing accounts', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENGAGE_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_ENGAGE_ENVIRONMENT', 'test');
    state.user = '11111111-1111-4111-8111-111111111111';
    const view = (page: string) => (
      <StrictMode>
        <EngageSessionProvider>
          <Probe page={page} />
        </EngageSessionProvider>
      </StrictMode>
    );
    const tree = render(view('dashboard'));
    await waitFor(() =>
      expect(screen.getByTestId('session').textContent).toBe(
        `dashboard:${state.user}`,
      ),
    );
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].identify).toHaveBeenCalledTimes(1);
    tree.rerender(view('settings'));
    await waitFor(() =>
      expect(screen.getByTestId('session').textContent).toBe(
        `settings:${state.user}`,
      ),
    );
    expect(state.clients[0].logout).not.toHaveBeenCalled();
    state.user = '22222222-2222-4222-8222-222222222222';
    tree.rerender(view('settings'));
    await waitFor(() =>
      expect(state.clients[0].logout).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByTestId('session').textContent).toBe('settings:none');
    expect(state.clients).toHaveLength(1);
    state.release!();
    await waitFor(() =>
      expect(screen.getByTestId('session').textContent).toBe(
        `settings:${state.user}`,
      ),
    );
    expect(state.clients).toHaveLength(2);
    state.user = null;
    tree.rerender(view('login'));
    await waitFor(() =>
      expect(state.clients[1].logout).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByTestId('session').textContent).toBe('login:none');
  });
  it('recovers initial connection failure when the browser returns online', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENGAGE_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_ENGAGE_ENVIRONMENT', 'test');
    state.user = '11111111-1111-4111-8111-111111111111';
    state.failures = 1;
    render(
      <EngageSessionProvider>
        <Probe page="home" />
      </EngageSessionProvider>,
    );
    await waitFor(() =>
      expect(state.clients[0]?.identify).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByTestId('session').textContent).toBe('home:none');
    fireEvent.online(window);
    await waitFor(() =>
      expect(screen.getByTestId('session').textContent).toBe(
        `home:${state.user}`,
      ),
    );
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].identify).toHaveBeenCalledTimes(2);
  });
});
