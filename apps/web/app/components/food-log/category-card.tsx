import { cn } from '@/lib/utils';
import { Utensils, Coffee, GlassWater, Pill, Carrot, CupSoda, Wine, Leaf } from 'lucide-react';

export type CategoryId = 'meal' | 'snack' | 'water' | 'coffee' | 'tea' | 'soda' | 'juice' | 'alcohol' | 'supplement';

interface CategoryCardProps {
  id: CategoryId;
  label: String;
  isSelected: boolean;
  onClick: () => void;
}

const icons: Record<CategoryId, any> = {
  meal: Utensils,
  snack: Carrot,
  water: GlassWater,
  coffee: Coffee,
  tea: Leaf,
  soda: CupSoda,
  juice: CupSoda,
  alcohol: Wine,
  supplement: Pill,
};

const colors: Record<CategoryId, string> = {
  meal: 'text-orange-500',
  snack: 'text-pink-500',
  water: 'text-cyan-500',
  coffee: 'text-amber-700',
  tea: 'text-emerald-500',
  soda: 'text-purple-500',
  juice: 'text-yellow-500',
  alcohol: 'text-red-500',
  supplement: 'text-teal-500',
};

export function CategoryCard({ id, label, isSelected, onClick }: CategoryCardProps) {
  const Icon = icons[id] || Utensils;
  const colorClass = colors[id] || 'text-primary';

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center p-4 rounded-xl border transition-all duration-200",
        "hover:scale-105 active:scale-95",
        isSelected 
          ? "bg-primary/10 border-primary shadow-sm" 
          : "bg-card border-border hover:bg-accent/50"
      )}
    >
      <div className={cn(
        "p-3 rounded-full mb-2 transition-colors",
        isSelected ? "bg-primary text-primary-foreground" : "bg-muted " + colorClass
      )}>
        <Icon size={24} />
      </div>
      <span className={cn(
        "text-sm font-medium",
        isSelected ? "text-primary" : "text-muted-foreground"
      )}>
        {label}
      </span>
    </button>
  );
}
