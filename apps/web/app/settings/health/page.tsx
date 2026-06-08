'use client';

/**
 * Health & data sources settings.
 * Mirrors iOS `HealthKitSettingsView` — but for web, where the equivalent is
 * the list of connected mobile sources (iOS / Android) syncing into the
 * account, plus auto-claim preferences.
 */

import { ArrowLeft, Heart, Smartphone, RefreshCcw, Apple, Activity } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Navbar } from '@/components/layout/navbar';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useAuthStore } from '@/stores/auth-store';

interface SyncSource {
  source: 'ios' | 'android' | 'manual';
  lastSyncedAt: string | null;
  count: number;
}

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
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <Link href="/settings" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to settings
        </Link>
        <h1 className="text-2xl font-bold">Health & Data</h1>

        {/* Auto-claim */}
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Heart className="h-5 w-5 text-red-400" />
            <div className="flex-1">
              <p className="font-semibold">Auto-claim streak</p>
              <p className="text-xs text-muted-foreground">
                When new step data syncs from your phone, automatically claim today&apos;s streak.
              </p>
            </div>
            <Switch checked={autoClaim} onCheckedChange={setAutoClaim} />
          </CardContent>
        </Card>

        {/* Sources */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <RefreshCcw className="h-4 w-4 text-cyan-400" /> Connected sources
            </h2>
            <div className="space-y-2">
              {sources.map(src => (
                <SourceRow key={src.source} source={src} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              Connect FitCircle on your phone to start syncing steps and weight automatically.
              Visit the App Store or Play Store to download the mobile app.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function SourceRow({ source }: { source: SyncSource }) {
  const meta = {
    ios:     { icon: <Apple className="h-4 w-4" />,     label: 'Apple Health (iOS)',    color: 'text-zinc-300' },
    android: { icon: <Smartphone className="h-4 w-4" />, label: 'Health Connect (Android)', color: 'text-emerald-400' },
    manual:  { icon: <Activity className="h-4 w-4" />,   label: 'Manual entry',          color: 'text-orange-400' },
  }[source.source];

  return (
    <div className="flex items-center gap-3 rounded-lg bg-zinc-800/40 px-3 py-2">
      <div className={`h-8 w-8 rounded-md bg-zinc-900 flex items-center justify-center ${meta.color}`}>
        {meta.icon}
      </div>
      <div className="flex-1">
        <p className="font-medium">{meta.label}</p>
        <p className="text-xs text-muted-foreground">
          {source.lastSyncedAt
            ? `Last sync ${new Date(source.lastSyncedAt).toLocaleDateString()}`
            : 'Not connected yet'}
        </p>
      </div>
    </div>
  );
}
