import { createServerSupabase } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FoodLogList } from '@/components/food-log/food-log-list';
import { FoodLogService } from '@/lib/services/food-log-service';
import { BeverageLogService } from '@/lib/services/beverage-log-service';

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
    const totalWater = (foodStats?.total_water_ml || 0) + (beverageStats?.total_water_ml || 0);

    // Combine and Sort
    const allEntries = [
        ...(foodLogs || []),
        ...(beverageLogs || [])
    ].sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime());

    return (
        <div className="container max-w-2xl py-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Food & Drink</h1>
                    <p className="text-muted-foreground">Track your nutrition and hydration.</p>
                </div>
                <Link href="/food-log/new">
                    <Button className="rounded-full h-12 w-12 p-0 shadow-lg hover:shadow-xl transition-all hover:scale-105">
                        <Plus size={24} />
                    </Button>
                </Link>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
                    <div className="text-sm text-muted-foreground">Today's Calories</div>
                    <div className="text-2xl font-bold text-primary">{Math.round(totalCalories)}</div>
                </div>
                <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                    <div className="text-sm text-muted-foreground">Water Intake</div>
                    <div className="text-2xl font-bold text-cyan-600">{Math.round(totalWater)} ml</div>
                </div>
            </div>

            <div className="space-y-4">
                <h2 className="text-xl font-semibold">Recent Entries</h2>
                <FoodLogList entries={allEntries} userId={user.id} />
            </div>
        </div>
    );
}
