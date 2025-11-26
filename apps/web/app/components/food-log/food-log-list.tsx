'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import Image from 'next/image';
import { 
    Trash2, 
    Droplets, 
    Utensils, 
    Coffee, 
    Leaf, 
    Sparkles,
    Sun,
    Moon,
    Zap,
    Wine,
    CupSoda,
    Milk,
    Apple,
    ImageIcon
} from 'lucide-react';
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
import { cn } from '@/lib/utils';

interface FoodLogImage {
    id: string;
    thumbnail_url?: string;
    url?: string;
}

interface FoodLogListProps {
    entries: any[];
    userId: string;
}

// Beautiful beverage icon configurations with distinctive styling
const BEVERAGE_ICONS: Record<string, {
    icon: any;
    color: string;
    bg: string;
    gradient?: string;
}> = {
    // Tea varieties
    'green': { 
        icon: Leaf, 
        color: 'text-emerald-500', 
        bg: 'bg-gradient-to-br from-emerald-500/20 to-green-400/10',
        gradient: 'from-emerald-500 to-green-400'
    },
    'green_tea': { 
        icon: Leaf, 
        color: 'text-emerald-500', 
        bg: 'bg-gradient-to-br from-emerald-500/20 to-green-400/10',
        gradient: 'from-emerald-500 to-green-400'
    },
    'herbal': { 
        icon: Sparkles, 
        color: 'text-purple-400', 
        bg: 'bg-gradient-to-br from-purple-400/20 to-pink-300/10',
        gradient: 'from-purple-400 to-pink-300'
    },
    'herbal_tea': { 
        icon: Sparkles, 
        color: 'text-purple-400', 
        bg: 'bg-gradient-to-br from-purple-400/20 to-pink-300/10',
        gradient: 'from-purple-400 to-pink-300'
    },
    'black': { 
        icon: Sun, 
        color: 'text-amber-600', 
        bg: 'bg-gradient-to-br from-amber-600/20 to-orange-400/10',
        gradient: 'from-amber-600 to-orange-400'
    },
    'black_tea': { 
        icon: Sun, 
        color: 'text-amber-600', 
        bg: 'bg-gradient-to-br from-amber-600/20 to-orange-400/10',
        gradient: 'from-amber-600 to-orange-400'
    },
    'matcha': { 
        icon: Zap, 
        color: 'text-lime-500', 
        bg: 'bg-gradient-to-br from-lime-500/20 to-green-500/10',
        gradient: 'from-lime-500 to-green-500'
    },
    'matcha_latte': { 
        icon: Zap, 
        color: 'text-lime-500', 
        bg: 'bg-gradient-to-br from-lime-500/20 to-green-500/10',
        gradient: 'from-lime-500 to-green-500'
    },
    'chai': { 
        icon: Moon, 
        color: 'text-orange-500', 
        bg: 'bg-gradient-to-br from-orange-500/20 to-amber-400/10',
        gradient: 'from-orange-500 to-amber-400'
    },
    'oolong': { 
        icon: Leaf, 
        color: 'text-teal-500', 
        bg: 'bg-gradient-to-br from-teal-500/20 to-cyan-400/10',
        gradient: 'from-teal-500 to-cyan-400'
    },
    'white_tea': { 
        icon: Sparkles, 
        color: 'text-slate-400', 
        bg: 'bg-gradient-to-br from-slate-300/20 to-slate-100/10',
        gradient: 'from-slate-300 to-slate-100'
    },
    
    // Coffee varieties
    'drip': { 
        icon: Coffee, 
        color: 'text-amber-700', 
        bg: 'bg-gradient-to-br from-amber-700/20 to-amber-500/10',
        gradient: 'from-amber-700 to-amber-500'
    },
    'drip_coffee': { 
        icon: Coffee, 
        color: 'text-amber-700', 
        bg: 'bg-gradient-to-br from-amber-700/20 to-amber-500/10',
        gradient: 'from-amber-700 to-amber-500'
    },
    'espresso': { 
        icon: Zap, 
        color: 'text-stone-700', 
        bg: 'bg-gradient-to-br from-stone-700/20 to-stone-500/10',
        gradient: 'from-stone-700 to-stone-500'
    },
    'americano': { 
        icon: Coffee, 
        color: 'text-stone-600', 
        bg: 'bg-gradient-to-br from-stone-600/20 to-stone-400/10',
        gradient: 'from-stone-600 to-stone-400'
    },
    'latte': { 
        icon: Milk, 
        color: 'text-amber-500', 
        bg: 'bg-gradient-to-br from-amber-500/20 to-orange-300/10',
        gradient: 'from-amber-500 to-orange-300'
    },
    'cappuccino': { 
        icon: Coffee, 
        color: 'text-amber-600', 
        bg: 'bg-gradient-to-br from-amber-600/20 to-amber-400/10',
        gradient: 'from-amber-600 to-amber-400'
    },
    'cold_brew': { 
        icon: Coffee, 
        color: 'text-stone-800', 
        bg: 'bg-gradient-to-br from-stone-800/20 to-stone-600/10',
        gradient: 'from-stone-800 to-stone-600'
    },
    'mocha': { 
        icon: Coffee, 
        color: 'text-amber-800', 
        bg: 'bg-gradient-to-br from-amber-800/20 to-orange-600/10',
        gradient: 'from-amber-800 to-orange-600'
    },
    
    // Other beverages
    'water': { 
        icon: Droplets, 
        color: 'text-cyan-500', 
        bg: 'bg-gradient-to-br from-cyan-500/20 to-blue-400/10',
        gradient: 'from-cyan-500 to-blue-400'
    },
    'juice': { 
        icon: Apple, 
        color: 'text-orange-500', 
        bg: 'bg-gradient-to-br from-orange-500/20 to-yellow-400/10',
        gradient: 'from-orange-500 to-yellow-400'
    },
    'smoothie': { 
        icon: Apple, 
        color: 'text-pink-500', 
        bg: 'bg-gradient-to-br from-pink-500/20 to-purple-400/10',
        gradient: 'from-pink-500 to-purple-400'
    },
    'soda': { 
        icon: CupSoda, 
        color: 'text-red-500', 
        bg: 'bg-gradient-to-br from-red-500/20 to-orange-400/10',
        gradient: 'from-red-500 to-orange-400'
    },
    'cola': { 
        icon: CupSoda, 
        color: 'text-amber-900', 
        bg: 'bg-gradient-to-br from-amber-900/20 to-amber-700/10',
        gradient: 'from-amber-900 to-amber-700'
    },
    'diet_cola': { 
        icon: CupSoda, 
        color: 'text-slate-500', 
        bg: 'bg-gradient-to-br from-slate-500/20 to-slate-400/10',
        gradient: 'from-slate-500 to-slate-400'
    },
    'alcohol': { 
        icon: Wine, 
        color: 'text-rose-600', 
        bg: 'bg-gradient-to-br from-rose-600/20 to-red-400/10',
        gradient: 'from-rose-600 to-red-400'
    },
    'wine': { 
        icon: Wine, 
        color: 'text-rose-700', 
        bg: 'bg-gradient-to-br from-rose-700/20 to-red-500/10',
        gradient: 'from-rose-700 to-red-500'
    },
    'beer': { 
        icon: CupSoda, 
        color: 'text-amber-500', 
        bg: 'bg-gradient-to-br from-amber-500/20 to-yellow-400/10',
        gradient: 'from-amber-500 to-yellow-400'
    },
    'milk': { 
        icon: Milk, 
        color: 'text-slate-200', 
        bg: 'bg-gradient-to-br from-slate-200/30 to-slate-100/20',
        gradient: 'from-slate-200 to-slate-100'
    },
    'protein_shake': { 
        icon: Zap, 
        color: 'text-blue-500', 
        bg: 'bg-gradient-to-br from-blue-500/20 to-indigo-400/10',
        gradient: 'from-blue-500 to-indigo-400'
    },
    'energy_drink': { 
        icon: Zap, 
        color: 'text-lime-400', 
        bg: 'bg-gradient-to-br from-lime-400/20 to-green-400/10',
        gradient: 'from-lime-400 to-green-400'
    },
};

// Category-level defaults for tea and coffee
const CATEGORY_DEFAULTS: Record<string, {
    icon: any;
    color: string;
    bg: string;
}> = {
    'tea': { 
        icon: Leaf, 
        color: 'text-green-500', 
        bg: 'bg-gradient-to-br from-green-500/20 to-emerald-400/10'
    },
    'coffee': { 
        icon: Coffee, 
        color: 'text-amber-700', 
        bg: 'bg-gradient-to-br from-amber-700/20 to-amber-500/10'
    },
};

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

function getBeverageIconConfig(category: string, beverageType: string) {
    // Normalize the beverage type for lookup
    const normalizedType = beverageType?.toLowerCase().replace(/\s+/g, '_') || '';
    const normalizedCategory = category?.toLowerCase() || '';
    
    // First try exact beverage type match
    if (BEVERAGE_ICONS[normalizedType]) {
        return BEVERAGE_ICONS[normalizedType];
    }
    
    // Try category + type combination
    const combinedKey = `${normalizedCategory}_${normalizedType}`;
    if (BEVERAGE_ICONS[combinedKey]) {
        return BEVERAGE_ICONS[combinedKey];
    }
    
    // Try category default
    if (CATEGORY_DEFAULTS[normalizedCategory]) {
        return CATEGORY_DEFAULTS[normalizedCategory];
    }
    
    // Try to match based on category in BEVERAGE_ICONS
    if (BEVERAGE_ICONS[normalizedCategory]) {
        return BEVERAGE_ICONS[normalizedCategory];
    }
    
    // Default coffee icon for unknown beverages
    return { 
        icon: Coffee, 
        color: 'text-amber-700', 
        bg: 'bg-amber-700/10'
    };
}

function LogItem({ item, onDelete }: { item: any, onDelete: (id: string, type: 'food' | 'water' | 'beverage') => void }) {
    const isBeverage = item.category && item.category !== 'water';
    const isWater = item.entry_type === 'water' || item.category === 'water';
    const hasImages = item.has_images && item.images && item.images.length > 0;

    let Icon = Utensils;
    let color = 'text-orange-500';
    let bg = 'bg-gradient-to-br from-orange-500/20 to-amber-400/10';
    let title = item.title || 'Meal';
    let subtitle = item.meal_type;

    if (isWater) {
        const waterConfig = BEVERAGE_ICONS['water'];
        Icon = waterConfig.icon;
        color = waterConfig.color;
        bg = waterConfig.bg;
        title = 'Water';
        subtitle = `${item.water_ml || item.volume_ml} ml`;
    } else if (isBeverage) {
        const config = getBeverageIconConfig(item.category, item.beverage_type);
        Icon = config.icon;
        color = config.color;
        bg = config.bg;
        title = item.beverage_type || item.category;
        subtitle = `${item.volume_ml} ml • ${item.calories || 0} cal`;
    }

    // Format the title to remove underscores and capitalize
    title = formatFoodName(title);

    // Get thumbnail image if available
    const thumbnailImage = hasImages ? item.images[0] : null;

    return (
        <div className={cn(
            "flex items-center justify-between p-4 rounded-xl border bg-card",
            "hover:shadow-md hover:border-primary/20 transition-all duration-200 group",
            hasImages && "ring-1 ring-primary/5"
        )}>
            <div className="flex items-center gap-4 flex-1 min-w-0">
                {/* Image or Icon */}
                {hasImages && thumbnailImage ? (
                    <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-primary/10 shadow-sm">
                        <Image
                            src={thumbnailImage.thumbnail_url || thumbnailImage.url}
                            alt={title}
                            fill
                            className="object-cover"
                            sizes="56px"
                        />
                        {item.images.length > 1 && (
                            <div className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-md backdrop-blur-sm">
                                +{item.images.length - 1}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className={cn(
                        "p-3 rounded-xl flex-shrink-0 transition-transform duration-200",
                        "group-hover:scale-105",
                        bg, color
                    )}>
                        <Icon size={22} strokeWidth={2} />
                    </div>
                )}
                
                <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-foreground truncate">{title}</h4>
                    <p className="text-sm text-muted-foreground capitalize truncate">{subtitle}</p>
                    
                    {/* Show time for better context */}
                    {item.logged_at && (
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                            {format(new Date(item.logged_at), 'h:mm a')}
                        </p>
                    )}
                </div>
            </div>

            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                    >
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
