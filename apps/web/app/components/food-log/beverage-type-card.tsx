import { cn } from '@/lib/utils';
import { 
    Coffee, 
    Leaf, 
    Sparkles, 
    Sun, 
    Zap, 
    Moon,
    CupSoda,
    Milk
} from 'lucide-react';

interface BeverageTypeCardProps {
    id: string;
    name: string;
    calories: number;
    caffeine: number;
    isSelected: boolean;
    onClick: () => void;
}

// Icon and color configurations for each beverage type
const BEVERAGE_TYPE_CONFIG: Record<string, {
    icon: any;
    color: string;
    bgColor: string;
    selectedBg: string;
}> = {
    // Tea types
    'black': {
        icon: Sun,
        color: 'text-amber-600',
        bgColor: 'bg-amber-500/10',
        selectedBg: 'bg-amber-500/20',
    },
    'green': {
        icon: Leaf,
        color: 'text-emerald-500',
        bgColor: 'bg-emerald-500/10',
        selectedBg: 'bg-emerald-500/20',
    },
    'herbal': {
        icon: Sparkles,
        color: 'text-purple-400',
        bgColor: 'bg-purple-400/10',
        selectedBg: 'bg-purple-400/20',
    },
    'matcha': {
        icon: Zap,
        color: 'text-lime-500',
        bgColor: 'bg-lime-500/10',
        selectedBg: 'bg-lime-500/20',
    },
    'chai': {
        icon: Moon,
        color: 'text-orange-500',
        bgColor: 'bg-orange-500/10',
        selectedBg: 'bg-orange-500/20',
    },
    'oolong': {
        icon: Leaf,
        color: 'text-teal-500',
        bgColor: 'bg-teal-500/10',
        selectedBg: 'bg-teal-500/20',
    },
    
    // Coffee types
    'drip': {
        icon: Coffee,
        color: 'text-amber-700',
        bgColor: 'bg-amber-700/10',
        selectedBg: 'bg-amber-700/20',
    },
    'espresso': {
        icon: Zap,
        color: 'text-stone-700',
        bgColor: 'bg-stone-700/10',
        selectedBg: 'bg-stone-700/20',
    },
    'americano': {
        icon: Coffee,
        color: 'text-stone-600',
        bgColor: 'bg-stone-600/10',
        selectedBg: 'bg-stone-600/20',
    },
    'latte': {
        icon: Milk,
        color: 'text-amber-500',
        bgColor: 'bg-amber-500/10',
        selectedBg: 'bg-amber-500/20',
    },
    'cappuccino': {
        icon: Coffee,
        color: 'text-amber-600',
        bgColor: 'bg-amber-600/10',
        selectedBg: 'bg-amber-600/20',
    },
    'cold_brew': {
        icon: Coffee,
        color: 'text-stone-800',
        bgColor: 'bg-stone-800/10',
        selectedBg: 'bg-stone-800/20',
    },
    'mocha': {
        icon: Coffee,
        color: 'text-amber-800',
        bgColor: 'bg-amber-800/10',
        selectedBg: 'bg-amber-800/20',
    },
    
    // Soda types
    'cola': {
        icon: CupSoda,
        color: 'text-amber-900',
        bgColor: 'bg-amber-900/10',
        selectedBg: 'bg-amber-900/20',
    },
    'diet_cola': {
        icon: CupSoda,
        color: 'text-slate-500',
        bgColor: 'bg-slate-500/10',
        selectedBg: 'bg-slate-500/20',
    },
};

// Default config for unknown types
const DEFAULT_CONFIG = {
    icon: Coffee,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    selectedBg: 'bg-primary/10',
};

export function BeverageTypeCard({
    id,
    name,
    calories,
    caffeine,
    isSelected,
    onClick
}: BeverageTypeCardProps) {
    const config = BEVERAGE_TYPE_CONFIG[id] || DEFAULT_CONFIG;
    const Icon = config.icon;

    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center gap-4 p-4 rounded-xl border text-left transition-all duration-200 w-full",
                "hover:border-primary/50 hover:shadow-sm",
                isSelected
                    ? `${config.selectedBg} border-primary ring-1 ring-primary`
                    : "bg-card border-border"
            )}
        >
            {/* Icon */}
            <div className={cn(
                "p-2.5 rounded-xl transition-all duration-200",
                isSelected ? config.selectedBg : config.bgColor,
                config.color
            )}>
                <Icon size={20} strokeWidth={2} />
            </div>
            
            {/* Content */}
            <div className="flex-1 min-w-0">
                <span className={cn(
                    "font-semibold block mb-0.5",
                    isSelected ? "text-primary" : "text-foreground"
                )}>
                    {name}
                </span>
                <div className="flex gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">{calories} cal</span>
                    <span>•</span>
                    <span>{caffeine}mg caffeine</span>
                </div>
            </div>
        </button>
    );
}
