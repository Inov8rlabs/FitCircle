import { redirect } from 'next/navigation';

import { AddEntrySheet } from '@/components/food-log/add-entry-sheet';
import { CalorieBudgetCard, DEFAULT_CALORIE_BUDGET } from '@/components/food-log/calorie-budget-card';
import { FoodLogFeed } from '@/components/food-log/food-log-feed';
import { FirstFoodLogPrompt } from '@/components/nutrition/FirstFoodLogPrompt';
import { FoodLogNutritionSection } from '@/components/nutrition/FoodLogNutritionSection';
import { Screen, ScreenHeader } from '@/components/ui/ios';
import { BeverageLogService } from '@/lib/services/beverage-log-service';
import { FoodLogImageService } from '@/lib/services/food-log-image-service';
import { FoodLogService } from '@/lib/services/food-log-service';
import { PlateScoreService } from '@/lib/services/plate-score-service';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function FoodLogPage() {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    // Fetch Food & Water Logs
    const { data: foodLogs } = await FoodLogService.getEntries(user.id, { limit: 50 }, supabase);

    // Fetch Beverage Logs
    const { data: beverageLogs } = await BeverageLogService.getEntries(user.id, { limit: 50 }, supabase);

    // Fetch Daily Stats
    const today = new Date().toISOString().split('T')[0];
    const { data: foodStats } = await FoodLogService.getStats(user.id, today, today, supabase);
    const { data: beverageStats } = await BeverageLogService.getStats(user.id, today, today, supabase);

    const totalCalories = (foodStats?.total_calories || 0) + (beverageStats?.total_calories || 0);
    const calorieBudget = await PlateScoreService.getForDay(user.id, today)
      .then((s) => (s.calorieTarget > 0 ? s.calorieTarget : DEFAULT_CALORIE_BUDGET))
      .catch(() => DEFAULT_CALORIE_BUDGET);

    // Get entry IDs that have images
    const foodEntryIds = (foodLogs || [])
        .filter((entry: any) => entry.has_images && entry.image_count > 0)
        .map((entry: any) => entry.id);

    // Fetch images for entries that have them
    const { data: imagesByEntry } = await FoodLogImageService.getImagesForEntries(foodEntryIds, supabase);

    // Attach images to food entries
    const foodLogsWithImages = (foodLogs || []).map((entry: any) => ({
        ...entry,
        images: imagesByEntry[entry.id] || [],
    }));

    // Combine and Sort
    const allEntries = [
        ...foodLogsWithImages,
        ...(beverageLogs || [])
    ].sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime());

    return (
        <Screen size="wide" className="lg:max-w-5xl">
            <ScreenHeader title="Food Log" subtitle="Track your nutrition and hydration." />
            <FoodLogFeed
                entries={allEntries}
                userId={user.id}
                summary={
                    <>
                        <CalorieBudgetCard consumed={totalCalories} budget={calorieBudget} />
                        {/* First-run nudge (§6.14) — only when the user has no logs yet */}
                        <FirstFoodLogPrompt hasLogs={allEntries.length > 0} />
                    </>
                }
                nutrition={<FoodLogNutritionSection />}
            />
            <AddEntrySheet />
        </Screen>
    );
}
