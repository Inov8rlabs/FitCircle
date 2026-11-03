'use client';
import { useEffect, useState } from 'react';
import {
  EngageClient,
  EngageFeed,
  EngageInApp,
  EngagePlacement,
} from '@inov8r/engage-web';
import { useEngageSession } from './EngageSessionProvider';
export function EngageDashboard() {
  const ready = useEngageSession();
  if (!ready) return null;
  return (
    <div className="flex flex-col gap-4" data-engage-app="fitcircle">
      {process.env.NEXT_PUBLIC_ENGAGE_QA_ENABLED === 'true' && (
        <TestDeviceEnrollment key={ready.user} client={ready.client} />
      )}
      {process.env.NEXT_PUBLIC_ENGAGE_WEB_PUSH_ENABLED === 'true' && (
        <BrowserNotifications
          key={`push:${ready.user}`}
          client={ready.client}
        />
      )}
      <EngagePlacement client={ready.client} id="home_banner" />
      <EngageFeed client={ready.client} />
      <EngageInApp client={ready.client} />
    </div>
  );
}

function TestDeviceEnrollment({ client }: { client: EngageClient }) {
  const [code, setCode] = useState(''),
    [acknowledge, setAcknowledge] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try {
      await fn();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border p-4">
      <summary>Test messages on this device</summary>
      <p className="my-3">
        This screen is for authorized QA accounts. Enrollment allows temporary
        campaign previews on this device. You can stop them here or by signing
        out.
      </p>
      <label className="block">
        One-time enrollment code
        <input
          className="block w-full rounded border p-2"
          autoComplete="off"
          value={code}
          maxLength={64}
          onChange={(e) => setCode(e.target.value.trim())}
        />
      </label>
      <label className="my-3 flex gap-2">
        <input
          type="checkbox"
          checked={acknowledge}
          onChange={(e) => setAcknowledge(e.target.checked)}
        />
        I agree to receive test messages on this device for the next 24 hours.
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded border px-3 py-2"
          disabled={busy || !acknowledge || !/^[a-f0-9]{64}$/.test(code)}
          onClick={() =>
            void run(async () => {
              await client.enrollTestDevice(code, true);
              setCode('');
              setAcknowledge(false);
              setStatus(
                'Test device enrolled. Keep this app open and refresh after requesting a preview.',
              );
            })
          }
        >
          Enroll this device
        </button>
        <button
          className="rounded border px-3 py-2"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await client.refresh();
              setStatus('Previews refreshed.');
            })
          }
        >
          Refresh previews
        </button>
        <button
          className="rounded border px-3 py-2"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await client.leaveTestDevice();
              setStatus('Test messages stopped for this device.');
            })
          }
        >
          Stop test messages
        </button>
      </div>
      <p role="status" className="mt-3">
        {status}
      </p>
    </details>
  );
}

function BrowserNotifications({ client }: { client: EngageClient }) {
  const [setup, setSetup] = useState<{
      registration: ServiceWorkerRegistration;
      key: string;
    } | null>(null),
    [status, setStatus] = useState('Checking browser notification support…'),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('indexedDB' in window)
    ) {
      setStatus('Browser notifications are not supported here.');
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const worker = new Promise<ServiceWorkerRegistration>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Worker unavailable')), 8000);
      navigator.serviceWorker.ready.then(resolve, reject);
    });
    void Promise.all([worker, client.webPushConfiguration()])
      .then(([registration, config]) => {
        if (active) {
          setSetup({ registration, key: config.public_key });
          setStatus('Choose whether to receive browser notifications.');
        }
      })
      .catch(() => {
        if (active) setStatus('Browser notifications are not available.');
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client]);
  async function enable() {
    if (!setup) return;
    setBusy(true);
    try {
      await client.enableWebPush(setup.registration, setup.key, true);
      setStatus(
        'Browser notifications enabled. Your notification preferences still apply.',
      );
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try {
      await client.disableWebPush();
      setStatus('Browser notifications stopped.');
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border p-4">
      <summary>Browser notifications</summary>
      <p className="my-3">
        Allow notifications on this browser. This does not change your marketing
        preferences.
      </p>
      <div className="flex gap-3">
        <button
          className="rounded border px-3 py-2"
          disabled={busy || !setup}
          onClick={() => void enable()}
        >
          Enable browser notifications
        </button>
        <button
          className="rounded border px-3 py-2"
          disabled={busy || !setup}
          onClick={() => void disable()}
        >
          Stop browser notifications
        </button>
      </div>
      <p role="status">{status}</p>
    </details>
  );
}
