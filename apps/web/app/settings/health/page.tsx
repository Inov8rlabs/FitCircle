'use client';

/**
 * Health & data sources settings.
 * Mirrors iOS `HealthKitSettingsView` — but for web, where the equivalent is
 * the list of connected mobile sources (iOS / Android) syncing into the
 * account, plus auto-claim preferences.
 */

import { Activity, Apple, Heart, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

import { GetAppButton } from '@/components/app-links/GetAppButton';
import { SettingsScreen, ToggleRow } from '@/components/profile/settings-shell';
import { ListGroup, ListRow, type Tone } from '@/components/ui/ios';
import { useAuthStore } from '@/stores/auth-store';

interface SyncSource {
  source: 'ios' | 'android' | 'manual';
  lastSyncedAt: string | null;
  count: number;
}

const SOURCE_META: Record<SyncSource['source'], { icon: typeof Apple; label: string; tone: Tone }> = {
  ios: { icon: Apple, label: 'Apple Health (iOS)', tone: 'slate' },
  android: { icon: Smartphone, label: 'Health Connect (Android)', tone: 'green' },
  manual: { icon: Activity, label: 'Manual entry', tone: 'orange' },
};

export default function HealthSettingsPage() {
  const { user } = useAuthStore();
  const [sources, setSources] = useState<SyncSource[]>([]);
  const [autoClaim, setAutoClaim] = useState(true);

  useEffect(() => {
    // Placeholder: in a full implementation we'd query sync history per source
    // from /api/mobile/tracking/sources or similar. For parity with iOS
    // HealthKit settings page, show the list of known sources.
    if (!user) return;
    setSources([
      { source: 'ios', lastSyncedAt: null, count: 0 },
      { source: 'android', lastSyncedAt: null, count: 0 },
      { source: 'manual', lastSyncedAt: new Date().toISOString(), count: 0 },
    ]);
  }, [user]);

  return (
    <SettingsScreen title="Health & Data" subtitle="Where your steps, workouts and weight come from">
      <ListGroup title="Streak">
        <ToggleRow
          id="auto-claim"
          icon={Heart}
          tone="red"
          title="Auto-claim streak"
          description="When new step data syncs from your phone, automatically claim today's streak."
          checked={autoClaim}
          onCheckedChange={setAutoClaim}
        />
      </ListGroup>

      <ListGroup
        title="Connected sources"
        footer="Connect FitCircle on your phone to start syncing steps and weight automatically."
      >
        {sources.map((src) => {
          const meta = SOURCE_META[src.source];
          return (
            <ListRow
              key={src.source}
              icon={meta.icon}
              tone={meta.tone}
              title={meta.label}
              subtitle={
                src.lastSyncedAt ? `Last sync ${new Date(src.lastSyncedAt).toLocaleDateString()}` : 'Not connected yet'
              }
            />
          );
        })}
      </ListGroup>

      <div className="flex justify-center">
        <GetAppButton placement="settings_health" variant="secondary" label="Get the phone app" />
      </div>
    </SettingsScreen>
  );
}
