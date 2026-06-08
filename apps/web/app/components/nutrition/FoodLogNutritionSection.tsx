'use client';

import { ChevronDown, Settings2 } from 'lucide-react';
import { useState } from 'react';

import { DietaryPreferencesForm } from './DietaryPreferencesForm';
import { InsightsList } from './InsightsList';
import { PlateScoreCard } from './PlateScoreCard';

/**
 * Nutrition section for the food-log surface: glanceable Plate Score, cross-signal
 * Insights, and (collapsible) Dietary preferences — mirrors the iOS nutrition home.
 */
export function FoodLogNutritionSection() {
  const [prefsOpen, setPrefsOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Plate Score</h2>
        <PlateScoreCard />
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Insights</h2>
        <InsightsList />
      </div>

      <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setPrefsOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-base font-semibold text-white">
            <Settings2 className="h-4 w-4 text-indigo-400" />
            Dietary preferences
          </span>
          <ChevronDown
            className={`h-4 w-4 text-gray-400 transition-transform ${prefsOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {prefsOpen && (
          <div className="border-t border-slate-800/60 p-4">
            <DietaryPreferencesForm />
          </div>
        )}
      </div>
    </div>
  );
}
