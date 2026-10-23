'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { QuickLogPanel } from '@/components/nutrition/QuickLogPanel';
import { Fab } from '@/components/ui/ios';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import { FoodLogEntryForm } from './food-log-entry-form';

/**
 * iOS add-entry flow: the floating + opens a sheet with the quick paths
 * (photo / voice / search) above the manual form, the same pieces
 * /food-log/new renders full-page. A save closes the sheet; the form already
 * refreshes the server-rendered list.
 */
export function AddEntrySheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Fab icon={Plus} label="Log food or drink" onClick={() => setOpen(true)} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="md:max-w-xl" data-testid="add-entry-sheet">
          <SheetHeader>
            <SheetTitle>New entry</SheetTitle>
            <SheetDescription>Snap a photo, say what you ate, or fill it in.</SheetDescription>
          </SheetHeader>
          {open && (
            <>
              <QuickLogPanel />
              <FoodLogEntryForm variant="sheet" onSaved={() => setOpen(false)} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
