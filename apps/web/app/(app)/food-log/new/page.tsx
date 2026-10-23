import { FoodLogEntryForm } from '@/components/food-log/food-log-entry-form';
import { QuickLogPanel } from '@/components/nutrition/QuickLogPanel';
import { Screen } from '@/components/ui/ios';

/** Full-page add flow for deep links; the Food Log itself opens the same pieces in a sheet. */
export default function NewEntryPage() {
    return (
        <Screen>
            <FoodLogEntryForm header={<QuickLogPanel />} />
        </Screen>
    );
}
