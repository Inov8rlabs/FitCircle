import { cn } from '@/lib/utils';

interface BeverageTypeCardProps {
    id: string;
    name: string;
    calories: number;
    caffeine: number;
    isSelected: boolean;
    onClick: () => void;
}

export function BeverageTypeCard({
    name,
    calories,
    caffeine,
    isSelected,
    onClick
}: BeverageTypeCardProps) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex flex-col items-start p-4 rounded-xl border text-left transition-all duration-200 w-full",
                "hover:border-primary/50",
                isSelected
                    ? "bg-primary/5 border-primary ring-1 ring-primary"
                    : "bg-card border-border"
            )}
        >
            <span className={cn(
                "font-semibold mb-1",
                isSelected ? "text-primary" : "text-foreground"
            )}>
                {name}
            </span>
            <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{calories} cal</span>
                <span>•</span>
                <span>{caffeine}mg caffeine</span>
            </div>
        </button>
    );
}
