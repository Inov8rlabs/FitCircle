import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

async function worker(enabled: boolean) {
  const listeners: Record<string, (event: any) => void> = {};
  const push = vi.fn(async () => false),
    click = vi.fn(async () => false),
    show = vi.fn(async () => {}),
    open = vi.fn(async () => {});
  const self = {
    engagePushHandler: null as null | {
      push: typeof push;
      click: typeof click;
    },
    addEventListener: (name: string, callback: (event: any) => void) => {
      listeners[name] = callback;
    },
    registration: { showNotification: show },
    clients: { openWindow: open },
  };
  runInNewContext(
    await readFile(
      new URL('../../../../public/sw.js', import.meta.url),
      'utf8',
    ),
    {
      self,
      importScripts: () => {
        if (enabled) self.engagePushHandler = { push, click };
      },
      URL,
      Date,
      clients: self.clients,
    },
  );
  return {
    push,
    click,
    show,
    open,
    fire: async (name: string, event: Record<string, unknown>) => {
      const pending: Promise<unknown>[] = [];
      listeners[name]!({
        ...event,
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      });
      await Promise.all(pending);
    },
  };
}
describe('FitCircle worker routing boundary', () => {
  it.each([true, false])(
    'never displays or opens a foreign Engage payload through the legacy fallback (enabled=%s)',
    async (enabled) => {
      const w = await worker(enabled),
        foreign = {
          app_id: 'other_app',
          environment: 'production',
          binding_id: 'foreign',
          title: 'private',
        };
      await w.fire('push', {
        data: { json: () => foreign, text: () => JSON.stringify(foreign) },
      });
      await w.fire('notificationclick', {
        action: 'open',
        notification: { data: foreign, close: vi.fn() },
      });
      expect(w.show).not.toHaveBeenCalled();
      expect(w.open).not.toHaveBeenCalled();
      expect(w.push).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(w.click).toHaveBeenCalledTimes(enabled ? 1 : 0);
    },
  );
  it('keeps the existing legacy text notification route', async () => {
    const w = await worker(true);
    await w.fire('push', {
      data: {
        json: () => {
          throw new Error('text');
        },
        text: () => 'Existing reminder',
      },
    });
    expect(w.show).toHaveBeenCalledWith(
      'FitCircle',
      expect.objectContaining({ body: 'Existing reminder' }),
    );
    expect(w.push).not.toHaveBeenCalled();
    await w.fire('notificationclick', {
      action: 'open',
      notification: { data: { primaryKey: 1 }, close: vi.fn() },
    });
    expect(w.open).toHaveBeenCalledWith('/');
  });
});
