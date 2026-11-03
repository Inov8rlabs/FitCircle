import {
  createEngagePushHandler,
  indexedDbPushBindingStore,
} from '@inov8r/engage-web/worker';
// Replaced with a public app/environment constant by build-engage-worker.mjs.
const environment = __ENGAGE_ENVIRONMENT__;
self.engagePushHandler = null;
if (environment) {
  const tenant = { app_id: 'fitcircle', environment };
  const store = indexedDbPushBindingStore(tenant);
  const screens = {
    dashboard: '/dashboard',
    food_log: '/food-log',
    exercise_log: '/exercise-log',
    streaks: '/streaks',
    circles: '/fitcircles',
    challenges: '/challenges',
    fitzy_chat: '/dashboard',
  };
  self.engagePushHandler = createEngagePushHandler({
    tenant,
    origin: self.location.origin,
    current_binding: () => store.read(),
    show_notification: async ({ title, ...options }) =>
      self.registration.showNotification(title, {
        ...options,
        icon: '/icons/icon-192x192.png',
      }),
    close_notification: async (tag) => {
      for (const notification of await self.registration.getNotifications({
        tag,
      }))
        notification.close();
    },
    route: (action) =>
      action?.type === 'open_screen'
        ? (screens[action.screen] ?? null)
        : action?.type === 'open_url'
          ? action.url
          : action?.type === 'dismiss'
            ? null
            : '/dashboard',
    open_client: async (url, receipt) => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      let client = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (client) client = await client.navigate(url);
      else client = await self.clients.openWindow(url);
      if (!client) return;
      await client.focus();
      // Opening a window can precede React/auth hydration. Retry the same receipt until the
      // authenticated SDK acknowledges it; the client deduplicates repeated receipts.
      for (let n = 0; n < 20; n++) {
        const binding = await store.read();
        if (binding?.binding_id !== receipt.binding_id) return;
        const channel = new MessageChannel();
        const acknowledged = new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), 500);
          channel.port1.onmessage = (event) => {
            clearTimeout(timer);
            resolve(event.data?.accepted === true);
          };
        });
        client.postMessage(
          { type: 'ENGAGE_PUSH_OPENED', ...tenant, ...receipt },
          [channel.port2],
        );
        const accepted = await acknowledged;
        channel.port1.close();
        if (accepted) return;
      }
    },
  });
}
