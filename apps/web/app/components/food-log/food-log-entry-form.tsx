'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { CategoryCard, CategoryId } from './category-card';
import { BeverageTypeCard } from './beverage-type-card';
import { NutritionPreview } from './nutrition-preview';
import { WaterPresetButton } from './water-preset-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ArrowLeft } from 'lucide-react';
import { FoodLogService } from '@/lib/services/food-log-service';
import { BeverageLogService } from '@/lib/services/beverage-log-service';
import { BeverageType, BeverageCustomizations } from '@/lib/types/beverage-log';

// Mock Data for Beverage Types (Should ideally come from a constant or API)
const BEVERAGE_TYPES: Record<string, any[]> = {
    coffee: [
        { id: 'drip', name: 'Drip Coffee', calories: 2, caffeine: 95 },
        { id: 'espresso', name: 'Espresso', calories: 1, caffeine: 63 },
        { id: 'americano', name: 'Americano', calories: 2, caffeine: 63 },
        { id: 'latte', name: 'Latte', calories: 190, caffeine: 63 },
        { id: 'cappuccino', name: 'Cappuccino', calories: 120, caffeine: 63 },
    ],
    tea: [
        { id: 'black', name: 'Black Tea', calories: 2, caffeine: 47 },
        { id: 'green', name: 'Green Tea', calories: 2, caffeine: 28 },
        { id: 'herbal', name: 'Herbal Tea', calories: 0, caffeine: 0 },
        { id: 'matcha', name: 'Matcha Latte', calories: 240, caffeine: 80 },
    ],
    soda: [
        { id: 'cola', name: 'Cola', calories: 140, caffeine: 34 },
        { id: 'diet_cola', name: 'Diet Cola', calories: 0, caffeine: 46 },
        { id: 'lemon_lime', name: 'Lemon Lime', calories: 140, caffeine: 0 },
    ],
    // Add others as needed
};

export function FoodLogEntryForm() {
    const router = useRouter();
    const { toast } = useToast();

    const [isLoading, setIsLoading] = useState(false);
    const [category, setCategory] = useState<CategoryId>('meal');
    const [notes, setNotes] = useState('');
    const [isPrivate, setIsPrivate] = useState(true);

    // Meal State
    const [mealType, setMealType] = useState('breakfast');

    // Water State
    const [waterAmount, setWaterAmount] = useState<number>(0);

    // Beverage State
    const [selectedBevType, setSelectedBevType] = useState<any>(null);
    const [customizations, setCustomizations] = useState<BeverageCustomizations>({});
    const [nutrition, setNutrition] = useState({ calories: 0, caffeine: 0, sugar: 0, volume: 0 });

    // Calculate nutrition when beverage selection changes
    useEffect(() => {
        if (selectedBevType) {
            // Simple calculation logic (mock)
            setNutrition({
                calories: selectedBevType.calories,
                caffeine: selectedBevType.caffeine,
                sugar: 0, // Mock
                volume: 240, // Mock standard size
            });
        }
    }, [selectedBevType, customizations]);

    const handleSubmit = async () => {
        setIsLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            if (category === 'meal' || category === 'snack') {
                const { error } = await FoodLogService.createEntry(user.id, {
                    entry_type: 'food',
                    meal_type: category === 'snack' ? 'snack' : (mealType as any),
                    title: category === 'snack' ? 'Snack' : 'Meal', // Simple title
                    notes,
                    is_private: isPrivate,
                    logged_at: new Date().toISOString(),
                }, supabase as any);
                if (error) throw error;
            } else if (category === 'water') {
                if (waterAmount <= 0) throw new Error('Please select water amount');
                const { error } = await FoodLogService.createEntry(user.id, {
                    entry_type: 'water',
                    water_ml: waterAmount,
                    notes,
                    is_private: isPrivate,
                    logged_at: new Date().toISOString(),
                }, supabase as any);
                if (error) throw error;
            } else {
                // Beverage
                if (!selectedBevType) throw new Error('Please select a beverage type');
                const { error } = await BeverageLogService.createEntry(user.id, {
                    category: category as any, // Cast to BeverageCategory
                    beverage_type: selectedBevType.name,
                    volume_ml: nutrition.volume,
                    calories: nutrition.calories,
                    caffeine_mg: nutrition.caffeine,
                    sugar_g: nutrition.sugar,
                    notes,
                    is_private: isPrivate,
                    logged_at: new Date().toISOString(),
                }, supabase as any);
                if (error) throw error;
            }

            toast({ title: 'Entry saved!', description: 'Your log has been added.' });
            router.push('/food-log');
            router.refresh();
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message,
                variant: 'destructive'
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8 pb-20">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ArrowLeft size={20} />
                </Button>
                <h1 className="text-2xl font-bold">New Entry</h1>
            </div>

            {/* Category Selection */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold">What are you logging?</h2>

                <div className="space-y-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meals</span>
                    <div className="grid grid-cols-2 gap-3">
                        {['meal', 'snack'].map((id) => (
                            <CategoryCard
                                key={id}
                                id={id as CategoryId}
                                label={id.charAt(0).toUpperCase() + id.slice(1)}
                                isSelected={category === id}
                                onClick={() => setCategory(id as CategoryId)}
                            />
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Beverages</span>
                    <div className="grid grid-cols-3 gap-3">
                        {['water', 'coffee', 'tea', 'soda', 'juice', 'alcohol'].map((id) => (
                            <CategoryCard
                                key={id}
                                id={id as CategoryId}
                                label={id.charAt(0).toUpperCase() + id.slice(1)}
                                isSelected={category === id}
                                onClick={() => setCategory(id as CategoryId)}
                            />
                        ))}
                    </div>
                </div>
            </section>

            {/* Dynamic Content */}
            <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {category === 'water' && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold">How much water?</h2>
                        <div className="grid grid-cols-3 gap-3">
                            <WaterPresetButton title="Half Glass" subtitle="120 ml" value={120} selectedValue={waterAmount} onClick={() => setWaterAmount(120)} />
                            <WaterPresetButton title="Glass" subtitle="240 ml" value={240} selectedValue={waterAmount} onClick={() => setWaterAmount(240)} />
                            <WaterPresetButton title="Bottle" subtitle="500 ml" value={500} selectedValue={waterAmount} onClick={() => setWaterAmount(500)} />
                        </div>
                        <div className="pt-2">
                            <Label>Custom Amount (ml)</Label>
                            <Input
                                type="number"
                                value={waterAmount || ''}
                                onChange={(e) => setWaterAmount(parseInt(e.target.value) || 0)}
                                placeholder="Enter amount in ml"
                            />
                        </div>
                    </div>
                )}

                {(category === 'coffee' || category === 'tea' || category === 'soda') && (
                    <div className="space-y-6">
                        <h2 className="text-lg font-semibold">Select Type</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {(BEVERAGE_TYPES[category] || []).map((type) => (
                                <BeverageTypeCard
                                    key={type.id}
                                    id={type.id}
                                    name={type.name}
                                    calories={type.calories}
                                    caffeine={type.caffeine}
                                    isSelected={selectedBevType?.id === type.id}
                                    onClick={() => setSelectedBevType(type)}
                                />
                            ))}
                        </div>

                        {selectedBevType && (
                            <div className="space-y-4 pt-4 border-t">
                                <h2 className="text-lg font-semibold">Nutrition Preview</h2>
                                <NutritionPreview
                                    calories={nutrition.calories}
                                    caffeineMg={nutrition.caffeine}
                                    sugarG={nutrition.sugar}
                                    volumeMl={nutrition.volume}
                                />
                            </div>
                        )}
                    </div>
                )}

                {(category === 'meal') && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold">Meal Details</h2>
                        <div className="grid grid-cols-3 gap-2">
                            {['breakfast', 'lunch', 'dinner'].map((type) => (
                                <Button
                                    key={type}
                                    variant={mealType === type ? 'default' : 'outline'}
                                    onClick={() => setMealType(type)}
                                    className="capitalize"
                                >
                                    {type}
                                </Button>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            {/* Common Fields */}
            <section className="space-y-4 pt-6 border-t">
                <div className="space-y-2">
                    <Label>Notes (Optional)</Label>
                    <Textarea
                        placeholder="Add any details..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </div>

                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
                    <div className="space-y-0.5">
                        <Label>Private Entry</Label>
                        <p className="text-xs text-muted-foreground">Only visible to you</p>
                    </div>
                    <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                </div>
            </section>

            <Button
                className="w-full h-12 text-lg"
                onClick={handleSubmit}
                disabled={isLoading}
            >
                {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                Save Entry
            </Button>
        </div>
    );
}
