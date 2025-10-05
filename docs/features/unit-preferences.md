# Unit Preference System

## Overview

FitCircle now supports both metric (kg) and imperial (lbs) units for weight tracking. Users can switch between unit systems at any time, and their preference is saved to their profile.

## Key Features

1. **Global Unit Preference**: Set once, applies everywhere
2. **Live Unit Toggle**: Change units directly in the check-in form
3. **Automatic Conversion**: All weights stored in kg, converted for display
4. **Chart Integration**: Weight charts display in user's preferred units
5. **Settings Page**: Dedicated settings page for managing preferences

## Implementation Details

### Database Storage

- **Storage Format**: All weights are stored in kilograms (`weight_kg` field)
- **User Preference**: Stored in `profiles.preferences.unitSystem` as JSONB
- **Default**: New users default to metric system

### Conversion Logic

```typescript
// Conversion constants
1 kg = 2.20462 lbs
1 lb = 0.453592 kg

// All conversions rounded to 1 decimal place for display
```

### Files Created/Modified

#### New Files

1. **`/apps/web/app/lib/utils/units.ts`**
   - Core conversion utilities
   - Formatting functions
   - Validation helpers

2. **`/apps/web/app/lib/services/preference-service.ts`**
   - Service layer for managing user preferences
   - Database operations for preference updates

3. **`/apps/web/app/hooks/useUnitPreference.ts`**
   - React hook for managing unit preference state
   - Handles API calls and local state updates

4. **`/apps/web/app/components/ui/unit-toggle.tsx`**
   - UI component for toggling between kg/lbs
   - Animated toggle with loading states

5. **`/apps/web/app/api/preferences/unit-system/route.ts`**
   - API endpoint for fetching/updating unit preferences
   - RESTful GET and PUT operations

6. **`/supabase/migrations/007_add_unit_preferences.sql`**
   - Database migration for preference defaults
   - Ensures existing users have proper preference structure

#### Modified Files

1. **`/apps/web/app/dashboard/page.tsx`**
   - Integrated unit toggle in check-in form
   - Updated weight displays to use formatWeight()
   - Chart tooltips show correct units
   - Weight input converts to kg before saving

2. **`/apps/web/app/settings/page.tsx`**
   - Added Units & Measurements section
   - Integrated unit toggle component
   - Settings persist automatically

3. **`/apps/web/app/components/DashboardNav.tsx`**
   - Added Settings link to navigation

## Usage Examples

### In Components

```typescript
import { useUnitPreference } from '@/hooks/useUnitPreference';
import { formatWeight, parseWeightToKg } from '@/lib/utils/units';

function MyComponent() {
  const { unitSystem, setUnitSystem } = useUnitPreference();

  // Display weight
  const displayWeight = formatWeight(weightKg, unitSystem); // "70 kg" or "154.3 lbs"

  // Parse input
  const weightInKg = parseWeightToKg(inputValue, unitSystem);

  // Toggle units
  await setUnitSystem('imperial');
}
```

### In Check-in Form

```tsx
<UnitToggle
  value={unitSystem}
  onChange={setUnitSystem}
  isLoading={isLoadingUnits}
  size="sm"
/>
<Input
  placeholder={getWeightPlaceholder(unitSystem)} // "70.5" or "155.4"
  value={checkInForm.weight}
  onChange={(e) => setCheckInForm({ ...checkInForm, weight: e.target.value })}
/>
```

### API Usage

```typescript
// GET current preference
const response = await fetch('/api/preferences/unit-system');
const { unitSystem } = await response.json();

// Update preference
await fetch('/api/preferences/unit-system', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ unitSystem: 'imperial' })
});
```

## User Experience

1. **First Time Users**: Default to metric system
2. **Existing Users**: Automatically migrated with metric as default
3. **Unit Toggle**: Available in check-in form for quick changes
4. **Settings Page**: Dedicated section for unit preferences
5. **Persistence**: Preference saved to profile, synced across devices

## Testing

Run unit tests:

```bash
npm test -- units.test.ts
```

## Future Enhancements

- [ ] Height units (cm/inches)
- [ ] Distance units (km/miles) for running/walking
- [ ] Temperature units (°C/°F) for weather-based workouts
- [ ] Locale-based defaults (US users default to imperial)
- [ ] Unit conversion calculator tool

## Migration Guide

For existing users:

1. Migration automatically adds default preferences
2. No action required - defaults to metric
3. Can change preference at any time via Settings or check-in form

## Troubleshooting

**Issue**: Weight not converting correctly
- **Solution**: Ensure you're using `parseWeightToKg()` before saving to DB

**Issue**: Unit preference not persisting
- **Solution**: Check that user is authenticated and profile exists

**Issue**: Charts showing wrong units
- **Solution**: Verify `weightKgToDisplay()` is used in chart data transformation