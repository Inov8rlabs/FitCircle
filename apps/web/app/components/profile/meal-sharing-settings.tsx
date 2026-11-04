'use client';

/**
 * Settings → Privacy → Meals (docs/FOOD_ENTRY_PRIVACY_SPEC.md §1, §2.4, §2.5):
 * - "Share new meals with my circles" — the default for new food entries
 *   (GET/PUT /api/mobile/food-log/sharing). Saved on toggle; never touches
 *   existing entries.
 * - "Make all past meals private" — with a confirmation
 *   (POST /api/mobile/food-log/sharing/bulk). "Share all" is deliberately not offered.
 */
import { Lock, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ToggleRow } from '@/components/profile/settings-shell';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ListGroup, ListRow } from '@/components/ui/ios';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { nutritionClient } from '@/lib/api/nutrition-client';
import { loadMealSharingDefault, setCachedMealSharingDefault } from '@/lib/food-sharing';

export function MealSharingSettings() {
  const [shareDefault, setShareDefault] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => {
    let live = true;
    void loadMealSharingDefault().then((v) => {
      if (!live) return;
      setShareDefault(v);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const changeDefault = async (next: boolean) => {
    const prev = shareDefault;
    setShareDefault(next);
    setSavingDefault(true);
    try {
      const saved = await nutritionClient.setMealSharingDefault(next);
      const value = saved?.share_meals_with_circles === true;
      setShareDefault(value);
      setCachedMealSharingDefault(value);
      analytics.track(AnalyticsEvents.mealSharingDefaultChanged({ enabled: value, source: 'settings' }));
      toast.success(value ? 'New meals will be shared with your circles' : 'New meals will be private');
    } catch {
      setShareDefault(prev);
      toast.error('Could not save. Try again.');
    } finally {
      setSavingDefault(false);
    }
  };

  const makeAllPrivate = async () => {
    setBulkRunning(true);
    try {
      const result = await nutritionClient.makeAllMealsPrivate();
      const count = result?.entries_made_private ?? 0;
      analytics.track(
        AnalyticsEvents.mealPrivacyChanged({ surface: 'settings_bulk', to: 'private', entry_count: count })
      );
      toast.success(
        count > 0 ? `${count} ${count === 1 ? 'meal is' : 'meals are'} now private` : 'All your meals were already private'
      );
      setConfirmOpen(false);
    } catch {
      toast.error('Could not make your meals private. Try again.');
    } finally {
      setBulkRunning(false);
    }
  };

  return (
    <>
      <ListGroup
        title="Meals"
        footer="Changing the default only affects meals you log from now on. You can change any meal later from its details."
      >
        <ToggleRow
          id="share_meals_with_circles"
          icon={Users}
          tone="green"
          title="Share new meals with my circles"
          description={
            shareDefault
              ? 'New meals start as Shared with circles'
              : 'New meals start as Private'
          }
          checked={shareDefault}
          disabled={!loaded || savingDefault}
          onCheckedChange={(v) => void changeDefault(v)}
        />
        <ListRow
          onClick={() => setConfirmOpen(true)}
          icon={Lock}
          tone="slate"
          title="Make all past meals private"
          subtitle="Removes your meals from every circle chat"
          testId="privacy-make-all-private"
        />
      </ListGroup>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !bulkRunning && setConfirmOpen(o)}>
        <AlertDialogContent data-testid="make-all-private-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Make all past meals private?</AlertDialogTitle>
            <AlertDialogDescription>
              Every meal you have logged becomes private and its posts are removed from your circle chats. Your
              default for new meals does not change. You can share a meal again from its details.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="make-all-private-confirm"
              disabled={bulkRunning}
              onClick={(e) => {
                e.preventDefault();
                void makeAllPrivate();
              }}
            >
              {bulkRunning ? 'Making private…' : 'Make all private'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
