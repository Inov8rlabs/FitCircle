'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Trash2, Droplets, Utensils, Coffee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { FoodLogService } from '@/lib/services/food-log-service';
import { BeverageLogService } from '@/lib/services/beverage-log-service';

interface FoodLogListProps {
    entries: any[];
    userId: string;
}

export function FoodLogList({ entries, userId }: FoodLogListProps) {
    const [entryList, setEntryList] = useState(entries);
    const { toast } = useToast();

    const handleDelete = async (id: string, type: 'food' | 'water' | 'beverage') => {
        try {
            if (type === 'beverage') {
                await BeverageLogService.deleteEntry(id, userId, supabase as any);
            } else {
                await FoodLogService.deleteEntry(id, userId, supabase as any);
            }

            setEntryList(prev => prev.filter(e => e.id !== id));
            toast({ title: 'Entry deleted' });
        } catch (error) {
            toast({ title: 'Error deleting entry', variant: 'destructive' });
        }
    };

    // Group by date
    const groupedEntries = entryList.reduce((acc, entry) => {
        const date = entry.entry_date;
        if (!acc[date]) acc[date] = [];
        acc[date].push(entry);
        return acc;
    }, {} as Record<string, any[]>);

    if (entryList.length === 0) {
        return (
            <div className="text-center py-20 bg-muted/20 rounded-xl border border-dashed">
                <Utensils className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground">No entries yet</h3>
                <p className="text-muted-foreground">Start tracking your meals and hydration.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {Object.entries(groupedEntries).map(([date, items]) => (
                <div key={date} className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider sticky top-0 bg-background py-2 z-10">
                        {format(new Date(date), 'EEEE, MMMM d')}
                    </h3>

                    <div className="grid gap-3">
                        {(items as any[]).map((item) => (
                            <LogItem key={item.id} item={item} onDelete={handleDelete} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function formatFoodName(name: string): string {
    if (!name) return '';
    return name
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function LogItem({ item, onDelete }: { item: any, onDelete: (id: string, type: 'food' | 'water' | 'beverage') => void }) {
    const isBeverage = item.category && item.category !== 'water';
    const isWater = item.entry_type === 'water' || item.category === 'water';

    let Icon = Utensils;
    let color = 'text-orange-500';
    let bg = 'bg-orange-500/10';
    let title = item.title || 'Meal';
    let subtitle = item.meal_type;

    if (isWater) {
        Icon = Droplets;
        color = 'text-cyan-500';
        bg = 'bg-cyan-500/10';
        title = 'Water';
        subtitle = `${item.water_ml || item.volume_ml} ml`;
    } else if (isBeverage) {
        Icon = Coffee;
        color = 'text-amber-700';
        bg = 'bg-amber-700/10';
        title = item.beverage_type || item.category;
        subtitle = `${item.volume_ml} ml • ${item.calories} cal`;
    }

    // Format the title to remove underscores and capitalize
    title = formatFoodName(title);

    return (
        <div className="flex items-center justify-between p-4 rounded-xl border bg-card hover:shadow-sm transition-shadow group">
            <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${bg} ${color}`}>
                    <Icon size={20} />
                </div>
                <div>
                    <h4 className="font-medium capitalize">{title}</h4>
                    <p className="text-sm text-muted-foreground capitalize">{subtitle}</p>
                </div>
            </div>

            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                        <Trash2 size={18} />
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Entry?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => onDelete(item.id, isBeverage ? 'beverage' : (isWater ? 'water' : 'food'))}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
