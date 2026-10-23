import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../sheet';

function Example({ hideClose }: { hideClose?: boolean }) {
  return (
    <Sheet>
      <SheetTrigger>Open</SheetTrigger>
      <SheetContent hideClose={hideClose}>
        <SheetHeader>
          <SheetTitle>Log water</SheetTitle>
          <SheetDescription>Pick an amount</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}

describe('Sheet', () => {
  it('opens as an accessible dialog and closes', async () => {
    const user = userEvent.setup();
    render(<Example />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog', { name: 'Log water' });
    expect(dialog).toHaveAccessibleDescription('Pick an amount');
    expect(dialog).toHaveClass('bottom-0', 'rounded-t-2xl');
    await user.click(screen.getByTestId('sheet-close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('can hide the close button', async () => {
    const user = userEvent.setup();
    render(<Example hideClose />);
    await user.click(screen.getByText('Open'));
    expect(screen.queryByTestId('sheet-close')).toBeNull();
  });
});
