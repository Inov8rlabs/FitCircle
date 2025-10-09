import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, waitFor } from '../../utils/test-utils';
import { BackfillDataDialog } from '@/components/BackfillDataDialog';

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('BackfillDataDialog', () => {
  const mockOnSubmit = vi.fn();
  const mockOnOpenChange = vi.fn();

  const defaultProps = {
    open: true,
    onOpenChange: mockOnOpenChange,
    onSubmit: mockOnSubmit,
    unitSystem: 'metric' as const,
    weightUnit: 'kg',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);
  });

  describe('Rendering', () => {
    it('should render dialog when open', () => {
      render(<BackfillDataDialog {...defaultProps} />);

      expect(screen.getByText('Log Past Data')).toBeInTheDocument();
      expect(screen.getByText('Enter weight and steps for a previous date')).toBeInTheDocument();
    });

    it('should not render when closed', () => {
      render(<BackfillDataDialog {...defaultProps} open={false} />);

      expect(screen.queryByText('Log Past Data')).not.toBeInTheDocument();
    });

    it('should render date picker', () => {
      render(<BackfillDataDialog {...defaultProps} />);

      expect(screen.getByLabelText('Date')).toBeInTheDocument();
    });

    it('should render weight input', () => {
      render(<BackfillDataDialog {...defaultProps} />);

      expect(screen.getByLabelText(/Weight/)).toBeInTheDocument();
    });

    it('should render steps input', () => {
      render(<BackfillDataDialog {...defaultProps} />);

      expect(screen.getByLabelText('Steps')).toBeInTheDocument();
    });

    it('should display correct unit for weight', () => {
      render(<BackfillDataDialog {...defaultProps} weightUnit="kg" />);

      expect(screen.getByText(/kg/)).toBeInTheDocument();
    });

    it('should display imperial units when unit system is imperial', () => {
      render(<BackfillDataDialog {...defaultProps} unitSystem="imperial" weightUnit="lbs" />);

      expect(screen.getByText(/lbs/)).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('should require date selection', async () => {
      const user = userEvent.setup();
      const { toast } = await import('sonner');

      render(<BackfillDataDialog {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      await user.click(submitButton);

      expect(toast.error).toHaveBeenCalledWith('Please select a date');
    });

    it('should require at least weight or steps', async () => {
      const user = userEvent.setup();
      const { toast } = await import('sonner');

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-01');

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      await user.click(submitButton);

      expect(toast.error).toHaveBeenCalledWith('Please enter weight or steps');
    });

    it('should allow submitting with only weight', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-01');

      const weightInput = screen.getByPlaceholderText('70.0');
      await user.type(weightInput, '75');

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
      });
    });

    it('should allow submitting with only steps', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-01');

      const stepsInput = screen.getByPlaceholderText('10000');
      await user.type(stepsInput, '8500');

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
      });
    });

    it('should allow submitting with both weight and steps', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-01');

      const weightInput = screen.getByPlaceholderText('70.0');
      await user.type(weightInput, '75');

      const stepsInput = screen.getByPlaceholderText('10000');
      await user.type(stepsInput, '8500');

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
      });
    });
  });

  describe('Date Picker', () => {
    it('should not allow future dates', () => {
      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
      const maxDate = dateInput.max;
      const today = new Date().toISOString().split('T')[0];

      expect(maxDate).toBe(today);
    });

    it('should update tip box with selected date', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-15');

      await waitFor(() => {
        expect(screen.getByText(/Jan 15, 2025/)).toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('should call onSubmit with correct data', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-15');

      const weightInput = screen.getByPlaceholderText('70.0');
      await user.type(weightInput, '75');

      const stepsInput = screen.getByPlaceholderText('10000');
      await user.type(stepsInput, '8500');

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          date: '2025-01-15',
          weight: 75,
          steps: 8500,
        });
      });
    });

    it('should show loading state during submission', async () => {
      const user = userEvent.setup();
      let resolveSubmit: () => void;
      const submitPromise = new Promise<void>((resolve) => {
        resolveSubmit = resolve;
      });
      mockOnSubmit.mockReturnValue(submitPromise);

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-15');

      const weightInput = screen.getByPlaceholderText('70.0');
      await user.type(weightInput, '75');

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      await user.click(submitButton);

      expect(screen.getByText(/Saving.../i)).toBeInTheDocument();

      resolveSubmit!();
      await waitFor(() => {
        expect(screen.queryByText(/Saving.../i)).not.toBeInTheDocument();
      });
    });

    it('should reset form after successful submission', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
      await user.type(dateInput, '2025-01-15');

      const weightInput = screen.getByPlaceholderText('70.0') as HTMLInputElement;
      await user.type(weightInput, '75');

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
      });

      // Form should be reset
      expect(dateInput.value).toBe('');
      expect(weightInput.value).toBe('');
    });

    it('should close dialog after successful submission', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-15');

      const weightInput = screen.getByPlaceholderText('70.0');
      await user.type(weightInput, '75');

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('Cancel Action', () => {
    it('should close dialog when cancel button is clicked', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      await user.click(cancelButton);

      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });

    it('should reset form when cancel is clicked', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
      await user.type(dateInput, '2025-01-15');

      const weightInput = screen.getByPlaceholderText('70.0') as HTMLInputElement;
      await user.type(weightInput, '75');

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      await user.click(cancelButton);

      expect(dateInput.value).toBe('');
      expect(weightInput.value).toBe('');
    });
  });

  describe('Unit System', () => {
    it('should show metric placeholder for metric system', () => {
      render(<BackfillDataDialog {...defaultProps} unitSystem="metric" />);

      expect(screen.getByPlaceholderText('70.0')).toBeInTheDocument();
    });

    it('should show imperial placeholder for imperial system', () => {
      render(<BackfillDataDialog {...defaultProps} unitSystem="imperial" />);

      expect(screen.getByPlaceholderText('154.0')).toBeInTheDocument();
    });
  });

  describe('Tip Box', () => {
    it('should display helpful tip', () => {
      render(<BackfillDataDialog {...defaultProps} />);

      expect(screen.getByText(/You can enter just weight, just steps, or both/i)).toBeInTheDocument();
    });

    it('should update tip with selected date', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-15');

      await waitFor(() => {
        expect(screen.getByText(/Jan 15, 2025/)).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have accessible form labels', () => {
      render(<BackfillDataDialog {...defaultProps} />);

      expect(screen.getByLabelText('Date')).toBeInTheDocument();
      expect(screen.getByLabelText(/Weight/)).toBeInTheDocument();
      expect(screen.getByLabelText('Steps')).toBeInTheDocument();
    });

    it('should have accessible button labels', () => {
      render(<BackfillDataDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /Cancel/i })).toHaveAccessibleName();
      expect(screen.getByRole('button', { name: /Save Data/i })).toHaveAccessibleName();
    });

    it('should disable submit button when form is invalid', () => {
      render(<BackfillDataDialog {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      expect(submitButton).toBeDisabled();
    });

    it('should enable submit button when form is valid', async () => {
      const user = userEvent.setup();

      render(<BackfillDataDialog {...defaultProps} />);

      const dateInput = screen.getByLabelText('Date');
      await user.type(dateInput, '2025-01-15');

      const weightInput = screen.getByPlaceholderText('70.0');
      await user.type(weightInput, '75');

      const submitButton = screen.getByRole('button', { name: /Save Data/i });
      expect(submitButton).toBeEnabled();
    });
  });
});
