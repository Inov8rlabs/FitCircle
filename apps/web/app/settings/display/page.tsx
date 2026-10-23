'use client';

/**
 * Display settings — units, diet & nutrition, theme, language.
 * Mirrors iOS `DisplaySettingsView`.
 */

import { Globe, Moon, Ruler, Salad } from 'lucide-react';

import { DietaryPreferencesForm } from '@/components/nutrition/DietaryPreferencesForm';
import { SettingsScreen, ToggleRow } from '@/components/profile/settings-shell';
import { ListGroup, ListRow } from '@/components/ui/ios';
import { useUnitPreference } from '@/hooks/useUnitPreference';

export default function DisplaySettingsPage() {
  const { unitSystem, toggleUnitSystem, isLoading } = useUnitPreference();
  const isMetric = unitSystem === 'metric';

  return (
    <SettingsScreen title="Display" subtitle="Units, nutrition and appearance">
      <ListGroup title="Units" footer="Used for weight, distance and water throughout FitCircle.">
        <ToggleRow
          id="units-imperial"
          icon={Ruler}
          tone="indigo"
          title="Use imperial units"
          description={isMetric ? 'Showing metric (kg, km, ml)' : 'Showing imperial (lbs, mi, oz)'}
          checked={!isMetric}
          disabled={isLoading}
          onCheckedChange={() => void toggleUnitSystem()}
        />
      </ListGroup>

      {/* The form brings its own card, so it sits directly under the section header. */}
      <section className="mb-6" data-testid="diet-section">
        <h2 className="mb-2 flex items-center gap-1.5 px-4 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">
          <Salad className="h-3.5 w-3.5 text-brand-green" aria-hidden /> Diet &amp; nutrition
        </h2>
        <DietaryPreferencesForm />
        <p className="mt-2 px-4 text-footnote text-fg-tertiary">Diet pattern, allergens, and how macros are shown.</p>
      </section>

      <ListGroup title="Appearance" footer="Dark mode is the only supported theme for now. Light mode is coming soon.">
        <ListRow icon={Moon} tone="purple" title="Theme" value="Dark" />
        <ListRow icon={Globe} tone="cyan" title="Language" value="English" />
      </ListGroup>
    </SettingsScreen>
  );
}
