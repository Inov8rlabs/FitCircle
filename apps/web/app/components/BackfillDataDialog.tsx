'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar, Loader2, Check } from 'lucide-react';
import { BathroomScale } from '@/components/icons/BathroomScale';
import { Footprints } from 'lucide-react';
import { toast } from 'sonner';
import { parseWeightToKg } from '@/lib/utils/units';

interface BackfillDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { date: string; weight?: number; steps?: number }) => Promise<void>;
  unitSystem: 'metric' | 'imperial';
  weightUnit: string;
}

export function BackfillDataDialog({
  open,
  onOpenChange,
  onSubmit,
  unitSystem,
  weightUnit,
}: BackfillDataDialogProps) {
  const [date, setDate] = useState('');
  const [weight, setWeight] = useState('');
  const [steps, setSteps] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!date) {
      toast.error('Please select a date');
      return;
    }

    if (!weight && !steps) {
      toast.error('Please enter weight or steps');
      return;
    }

    setIsSubmitting(true);
    try {
      const weightInKg = weight ? parseWeightToKg(weight, unitSystem) : undefined;
      const stepsNum = steps ? parseInt(steps) : undefined;

      await onSubmit({
        date,
        weight: weightInKg,
        steps: stepsNum,
      });

      // Reset form
      setDate('');
      setWeight('');
      setSteps('');
      onOpenChange(false);
    } catch (error) {
      console.error('Error submitting backfill:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setDate('');
    setWeight('');
    setSteps('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900/95 border-slate-800 backdrop-blur-xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar className="h-5 w-5 text-indigo-400" />
            Log Past Data
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Enter weight and steps for a previous date
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          {/* Date Picker */}
          <div className="space-y-2">
            <Label htmlFor="backfill-date" className="text-sm font-medium text-gray-300">
              Date
            </Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                id="backfill-date"
                type="date"
                max={new Date().toISOString().split('T')[0]}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pl-10 h-12 bg-slate-800/50 border-slate-700 text-white"
                required
              />
            </div>
          </div>

          {/* Weight and Steps */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="backfill-weight" className="text-sm font-medium text-gray-300">
                Weight ({weightUnit})
              </Label>
              <div className="relative">
                <BathroomScale className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" size={16} />
                <Input
                  id="backfill-weight"
                  type="number"
                  step="0.1"
                  placeholder={unitSystem === 'metric' ? '70.0' : '154.0'}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="pl-10 h-12 bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="backfill-steps" className="text-sm font-medium text-gray-300">
                Steps
              </Label>
              <div className="relative">
                <Footprints className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  id="backfill-steps"
                  type="number"
                  placeholder="10000"
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  className="pl-10 h-12 bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
            <p className="text-xs text-indigo-300">
              💡 <strong>Tip:</strong> You can enter just weight, just steps, or both.
              {date && ` Data will be saved for ${new Date(date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })}.`}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="flex-1 border-slate-700 text-gray-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !date || (!weight && !steps)}
              className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Save Data
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
