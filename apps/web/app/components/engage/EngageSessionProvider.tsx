'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { EngageClient, indexedDbPushBindingStore } from '@inov8r/engage-web';
import { IdSchema, TenantSchema } from '@inov8r/engage-protocol';
import { supabase } from '@/lib/supabase';
import { registerEngageSession } from '@/lib/engage/browser-session';
import { useAuthStore } from '@/stores/auth-store';

const routes: Record<string, string> = {
  dashboard: '/dashboard',
  food_log: '/food-log',
  exercise_log: '/exercise-log',
  streaks: '/streaks',
  circles: '/fitcircles',
  challenges: '/challenges',
  fitzy_chat: '/dashboard',
};

const SessionContext = createContext<{
  user: string;
  client: EngageClient;
} | null>(null);
export function useEngageSession() {
  const session = useContext(SessionContext),
    user = useAuthStore((state) => state.user?.id);
  return session?.user === user ? session : null;
}
/** Lives above route transitions. Component unmount is not an account logout. */
export function EngageSessionProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id),
    router = useRouter();
  const [ready, setReady] = useState<{
    user: string;
    client: EngageClient;
  } | null>(null);
  const owner = useRef<{
    user: string;
    client: EngageClient;
    start: Promise<void>;
    retry: () => Promise<void>;
    failed: boolean;
    unregister: () => void;
  } | null>(null);
  const unbinding = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    setReady(null);
    if (owner.current && owner.current.user !== userId) {
      const previous = owner.current;
      owner.current = null;
      previous.unregister();
      // Clears memory immediately; finish the old authenticated unbind before reusing the installation.
      unbinding.current = previous.client.logout().catch(() => undefined);
    }
    const initialize = async () => {
      await unbinding.current;
      if (
        !active ||
        !userId ||
        process.env.NEXT_PUBLIC_ENGAGE_ENABLED !== 'true'
      )
        return;
      if (!owner.current) {
        const result = TenantSchema.safeParse({
          app_id: 'fitcircle',
          environment: process.env.NEXT_PUBLIC_ENGAGE_ENVIRONMENT,
        });
        if (!result.success)
          throw new Error('Engage requires an explicit environment');
        let storage: Storage | undefined;
        try {
          storage = window.localStorage;
        } catch {
          /* Restricted browser storage. */
        }
        const client = new EngageClient({
          tenant: result.data,
          base_url: `${window.location.origin}/api/engage`,
          storage,
          ...(process.env.NEXT_PUBLIC_ENGAGE_WEB_PUSH_ENABLED === 'true'
            ? {
                push_binding_store: indexedDbPushBindingStore(result.data),
                close_push_notifications: async (binding) => {
                  const registration =
                    await navigator.serviceWorker.getRegistration();
                  for (const notification of (await registration?.getNotifications()) ??
                    []) {
                    const data = notification.data;
                    if (
                      data?.app_id === binding.app_id &&
                      data?.environment === binding.environment &&
                      data?.binding_id === binding.binding_id
                    )
                      notification.close();
                  }
                },
              }
            : {}),
          visible: () => document.visibilityState === 'visible',
          headers: async () => {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            if (!session || session.user.id !== userId)
              throw new Error('Engage identity changed');
            return { authorization: `Bearer ${session.access_token}` };
          },
          on_action: (action) => {
            if (action.type === 'open_screen' && routes[action.screen])
              router.push(routes[action.screen]!);
            if (action.type === 'open_url') {
              const url = new URL(action.url);
              if (
                url.protocol === 'https:' &&
                ['fitcircle.ai', 'www.fitcircle.ai'].includes(url.hostname)
              )
                window.location.assign(url.href);
            }
          },
        });
        const key = `fitcircle:engage:${result.data.environment}:installation`;
        let install = crypto.randomUUID();
        try {
          const old = storage?.getItem(key);
          if (IdSchema.safeParse(old).success)
            install =
              old as `${string}-${string}-${string}-${string}-${string}`;
          else storage?.setItem(key, install);
        } catch {
          /* In-memory installation when storage is unavailable. */
        }

        const unregister = registerEngageSession(client);
        const retry = () =>
          client.identify(userId, {
            install_id: install,
            platform: 'web',
            app_version: '1.0.0',
            locale: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            push_permission:
              typeof Notification !== 'undefined' &&
              Notification.permission === 'granted'
                ? 'granted'
                : 'not_determined',
            layouts: ['card', 'hero', 'banner', 'modal', 'compact'],
            actions: ['open_screen', 'open_url', 'dismiss'],
            placements: ['home_banner', 'home_feed'],
          });
        owner.current = {
          user: userId,
          client,
          start: retry(),
          retry,
          failed: false,
          unregister,
        };
      }
      const session = owner.current;
      if (session.failed) {
        session.failed = false;
        session.start = session.retry();
      }
      try {
        await session.start;
      } catch (error) {
        if (owner.current === session) session.failed = true;
        throw error;
      }
      if (active && owner.current === session)
        setReady((current) =>
          current?.client === session.client
            ? current
            : { user: session.user, client: session.client },
        );
    };
    void initialize().catch(() => undefined);
    const retry = () => {
      if (
        active &&
        document.visibilityState === 'visible' &&
        owner.current?.failed
      )
        void initialize().catch(() => undefined);
    };
    const timer = setInterval(retry, 30_000);
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [userId, router]);
  useEffect(() => {
    if (!ready || ready.user !== userId) return;
    const { client } = ready;
    const pushMessage = (event: MessageEvent) => {
      if (
        !('serviceWorker' in navigator) ||
        event.source !== navigator.serviceWorker.controller ||
        event.data?.type !== 'ENGAGE_PUSH_OPENED' ||
        event.data?.app_id !== 'fitcircle' ||
        event.data?.environment !== process.env.NEXT_PUBLIC_ENGAGE_ENVIRONMENT
      )
        return;
      void client
        .webPushOpened({
          send_id: event.data.send_id,
          binding_id: event.data.binding_id,
        })
        .then((accepted) => event.ports[0]?.postMessage({ accepted }))
        .catch(() => event.ports[0]?.postMessage({ accepted: false }));
    };
    navigator.serviceWorker?.addEventListener('message', pushMessage);
    const refresh = () => {
      if (document.visibilityState === 'visible')
        void client.refresh().catch(() => undefined);
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', pushMessage);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [ready, userId]);
  return (
    <SessionContext.Provider value={ready?.user === userId ? ready : null}>
      {children}
    </SessionContext.Provider>
  );
}
