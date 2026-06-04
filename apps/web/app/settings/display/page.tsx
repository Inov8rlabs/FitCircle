'use client';

/**
 * Display settings — units, theme, language.
 * Mirrors iOS `DisplaySettingsView`.
 */

import { ArrowLeft, Palette, Ruler, Globe, Salad } from 'lucide-react';
import Link from 'next/link';

import { Navbar } from '@/components/layout/navbar';
import { DietaryPreferencesForm } from '@/components/nutrition/DietaryPreferencesForm';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useUnitPreference } from '@/hooks/useUnitPreference';

export default function DisplaySettingsPage() {
  const { unitSystem, toggleUnitSystem, isLoading } = useUnitPreference();
  const isMetric = unitSystem === 'metric';

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <Link href="/settings" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to settings
        </Link>

        <h1 className="text-2xl font-bold">Display</h1>

        {/* Units */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <Ruler className="h-5 w-5 text-indigo-400" />
              <div>
                <h2 className="font-semibold">Units</h2>
                <p className="text-xs text-muted-foreground">Used for weight and distance throughout the app</p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-zinc-800/40 px-3 py-2">
              <div>
                <p className="font-medium">{isMetric ? 'Metric (kg, km)' : 'Imperial (lbs, mi)'}</p>
                <p className="text-xs text-muted-foreground">
                  Tap the switch to swap measurement systems.
                </p>
              </div>
              <Switch
                checked={!isMetric}
                onCheckedChange={() => void toggleUnitSystem()}
                disabled={isLoading}
              />
            </div>
          </CardContent>
        </Card>

        {/* Dietary preferences / nutrition units (§6.15) */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <Salad className="h-5 w-5 text-green-400" />
              <div>
                <h2 className="font-semibold">Diet &amp; nutrition</h2>
                <p className="text-xs text-muted-foreground">
                  Diet pattern, allergens, and how macros are shown
                </p>
              </div>
            </div>
            <DietaryPreferencesForm />
          </CardContent>
        </Card>

        {/* Theme — forced dark per project conventions */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-3">
              <Palette className="h-5 w-5 text-purple-400" />
              <div>
                <h2 className="font-semibold">Theme</h2>
                <p className="text-xs text-muted-foreground">FitCircle is dark-first.</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground bg-zinc-800/40 rounded-lg p-3">
              Dark mode is enabled by default and currently the only supported theme.
              Light mode is coming soon.
            </p>
          </CardContent>
        </Card>

        {/* Language */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-cyan-400" />
              <div>
                <h2 className="font-semibold">Language</h2>
                <p className="text-xs text-muted-foreground">FitCircle currently supports English.</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground bg-zinc-800/40 rounded-lg p-3">
              Localization is in progress. Reach out via the feedback channel if your language
              should be prioritised.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
