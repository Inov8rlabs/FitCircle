'use client';

/**
 * Reads the user's nutrition display units (§6.15) once and caches it in a
 * module-level promise so the many places that format grams/ml don't each fire
 * a request. Defaults to 'metric' until loaded / on error. Display-only.
 */

import { useEffect, useState } from 'react';

import { nutritionClient } from '@/lib/api/nutrition-client';
import type { DietaryUnits } from '@/lib/format/units';

let cached: DietaryUnits | null = null;
let inflight: Promise<DietaryUnits> | null = null;

async function loadUnits(): Promise<DietaryUnits> {
  if (cached) return cached;
  if (!inflight) {
    inflight = nutritionClient
      .getDietaryPreferences()
      .then((p) => {
        cached = p.units;
        return p.units;
      })
      .catch(() => 'metric' as DietaryUnits)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Lets a setter (e.g. the preferences form) refresh the cached value app-wide. */
export function primeDietaryUnits(units: DietaryUnits) {
  cached = units;
}

export function useDietaryUnits(): DietaryUnits {
  const [units, setUnits] = useState<DietaryUnits>(cached ?? 'metric');

  useEffect(() => {
    let active = true;
    void loadUnits().then((u) => {
      if (active) setUnits(u);
    });
    return () => {
      active = false;
    };
  }, []);

  return units;
}
