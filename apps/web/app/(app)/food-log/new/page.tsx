import { FoodLogEntryForm } from '@/components/food-log/food-log-entry-form';
import { QuickLogPanel } from '@/components/nutrition/QuickLogPanel';

export default function NewEntryPage() {
    return (
        <div className="container max-w-2xl py-8">
            <QuickLogPanel />
            <FoodLogEntryForm />
        </div>
    );
}
