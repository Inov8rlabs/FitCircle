import { cn } from '@/lib/utils';
import { Droplets } from 'lucide-react';

interface WaterPresetButtonProps {
    title: string;
    subtitle: string;
    value: number;
    selectedValue: number;
    onClick: () => void;
}

export function WaterPresetButton({
    title,
    subtitle,
    value,
    selectedValue,
    onClick
}: WaterPresetButtonProps) {
    const isSelected = value === selectedValue;

    return (
        <button
            onClick={onClick}
            className={cn(
                "flex flex-col items-center justify-center p-3 rounded-xl border transition-all w-full h-full min-h-[100px]",
                isSelected
                    ? "bg-cyan-500/10 border-cyan-500 text-cyan-700 dark:text-cyan-400"
                    : "bg-card border-border hover:border-cyan-500/50 hover:bg-cyan-500/5"
            )}
        >
            <Droplets
                size={20}
                className={cn("mb-2", isSelected ? "text-cyan-500" : "text-muted-foreground")}
            />
            <span className="font-medium text-sm">{title}</span>
            <span className="text-xs text-muted-foreground mt-1">{subtitle}</span>
        </button>
    );
}
