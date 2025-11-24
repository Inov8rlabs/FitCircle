import { Flame, Coffee, Droplets, Cookie } from 'lucide-react';

interface NutritionPreviewProps {
    calories: number;
    caffeineMg: number;
    sugarG: number;
    volumeMl: number;
}

export function NutritionPreview({ calories, caffeineMg, sugarG, volumeMl }: NutritionPreviewProps) {
    return (
        <div className="grid grid-cols-2 gap-3 p-4 bg-muted/30 rounded-xl border border-border/50">
            <NutritionItem
                icon={Flame}
                label="Calories"
                value={`${calories}`}
                unit="kcal"
                color="text-orange-500"
            />
            <NutritionItem
                icon={Coffee}
                label="Caffeine"
                value={`${caffeineMg}`}
                unit="mg"
                color="text-amber-700"
            />
            <NutritionItem
                icon={Cookie}
                label="Sugar"
                value={`${sugarG}`}
                unit="g"
                color="text-pink-500"
            />
            <NutritionItem
                icon={Droplets}
                label="Volume"
                value={`${volumeMl}`}
                unit="ml"
                color="text-cyan-500"
            />
        </div>
    );
}

function NutritionItem({ icon: Icon, label, value, unit, color }: any) {
    return (
        <div className="flex items-center gap-3 p-2 bg-background rounded-lg border border-border/50">
            <div className={`p-2 rounded-full bg-muted ${color} bg-opacity-10`}>
                <Icon size={16} className={color} />
            </div>
            <div>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-semibold text-sm">
                    {value} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
                </div>
            </div>
        </div>
    );
}
