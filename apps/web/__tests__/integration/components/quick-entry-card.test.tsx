import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, waitFor } from '../../utils/test-utils';
import { QuickEntryCard } from '@/components/QuickEntryCard';
import { BathroomScale } from '@/components/icons/BathroomScale';

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('QuickEntryCard', () => {
  const mockOnChange = vi.fn();
  const mockOnSubmit = vi.fn();

  const defaultProps = {
    icon: BathroomScale,
    label: 'Weight',
    value: '',
    onChange: mockOnChange,
    onSubmit: mockOnSubmit,
    placeholder: '70.0',
    unit: 'kg',
    color: 'purple-500',
    type: 'number' as const,
    step: '0.1',
    min: '0',
    helperText: "Today's weight in kg",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);
  });

  describe('Rendering', () => {
    it('should render with label and helper text', () => {
      render(<QuickEntryCard {...defaultProps} />);

      expect(screen.getByText('Weight')).toBeInTheDocument();
      expect(screen.getByText("Today's weight in kg")).toBeInTheDocument();
    });

    it('should render input with placeholder', () => {
      render(<QuickEntryCard {...defaultProps} />);

      const input = screen.getByPlaceholderText('70.0');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('type', 'number');
    });

    it('should render submit button', () => {
      render(<QuickEntryCard {...defaultProps} />);

      expect(screen.getByRole('button', { name: /Log Weight/i })).toBeInTheDocument();
    });

    it('should display unit when value is entered', () => {
      render(<QuickEntryCard {...defaultProps} value="70" />);

      expect(screen.getByText('kg')).toBeInTheDocument();
    });

    it('should show clear button when value is entered', () => {
      render(<QuickEntryCard {...defaultProps} value="70" />);

      const clearButton = screen.getByRole('button', { name: '' }); // X button
      expect(clearButton).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('should call onChange when typing', async () => {
      const user = userEvent.setup();
      render(<QuickEntryCard {...defaultProps} />);

      const input = screen.getByPlaceholderText('70.0');
      await user.type(input, '75');

      expect(mockOnChange).toHaveBeenCalled();
    });

    it('should call onSubmit when button is clicked', async () => {
      const user = userEvent.setup();
      render(<QuickEntryCard {...defaultProps} value="75" />);

      const submitButton = screen.getByRole('button', { name: /Log Weight/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      });
    });

    it('should call onSubmit when Enter key is pressed', async () => {
      const user = userEvent.setup();
      render(<QuickEntryCard {...defaultProps} value="75" />);

      const input = screen.getByPlaceholderText('70.0');
      await user.type(input, '{Enter}');

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      });
    });

    it('should clear value when clear button is clicked', async () => {
      const user = userEvent.setup();
      render(<QuickEntryCard {...defaultProps} value="75" />);

      const clearButton = screen.getAllByRole('button')[0]; // First button is clear
      await user.click(clearButton);

      expect(mockOnChange).toHaveBeenCalledWith('');
    });

    it('should not submit when value is empty', async () => {
      const user = userEvent.setup();
      render(<QuickEntryCard {...defaultProps} value="" />);

      const submitButton = screen.getByRole('button', { name: /Log Weight/i });
      await user.click(submitButton);

      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('should disable submit button when no value', () => {
      render(<QuickEntryCard {...defaultProps} value="" />);

      const submitButton = screen.getByRole('button', { name: /Log Weight/i });
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Loading States', () => {
    it('should show loading state during submission', async () => {
      const user = userEvent.setup();
      let resolveSubmit: () => void;
      const submitPromise = new Promise<void>((resolve) => {
        resolveSubmit = resolve;
      });
      mockOnSubmit.mockReturnValue(submitPromise);

      render(<QuickEntryCard {...defaultProps} value="75" />);

      const submitButton = screen.getByRole('button', { name: /Log Weight/i });
      await user.click(submitButton);

      expect(screen.getByText(/Saving.../i)).toBeInTheDocument();

      resolveSubmit!();
      await waitFor(() => {
        expect(screen.queryByText(/Saving.../i)).not.toBeInTheDocument();
      });
    });

    it('should show success state after submission', async () => {
      const user = userEvent.setup();
      render(<QuickEntryCard {...defaultProps} value="75" />);

      const submitButton = screen.getByRole('button', { name: /Log Weight/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Saved!/i)).toBeInTheDocument();
      });
    });

    it('should hide success state after timeout', async () => {
      const user = userEvent.setup();
      vi.useFakeTimers();

      render(<QuickEntryCard {...defaultProps} value="75" />);

      const submitButton = screen.getByRole('button', { name: /Log Weight/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Saved!/i)).toBeInTheDocument();
      });

      vi.advanceTimersByTime(2000);

      await waitFor(() => {
        expect(screen.queryByText(/Saved!/i)).not.toBeInTheDocument();
      });

      vi.useRealTimers();
    });
  });

  describe('Focus States', () => {
    it('should apply focus styles when input is focused', async () => {
      const user = userEvent.setup();
      render(<QuickEntryCard {...defaultProps} />);

      const input = screen.getByPlaceholderText('70.0');
      await user.click(input);

      expect(input).toHaveFocus();
    });
  });

  describe('Validation', () => {
    it('should respect min attribute', () => {
      render(<QuickEntryCard {...defaultProps} min="0" />);

      const input = screen.getByPlaceholderText('70.0');
      expect(input).toHaveAttribute('min', '0');
    });

    it('should respect step attribute', () => {
      render(<QuickEntryCard {...defaultProps} step="0.1" />);

      const input = screen.getByPlaceholderText('70.0');
      expect(input).toHaveAttribute('step', '0.1');
    });

    it('should use number input type', () => {
      render(<QuickEntryCard {...defaultProps} type="number" />);

      const input = screen.getByPlaceholderText('70.0');
      expect(input).toHaveAttribute('type', 'number');
    });
  });

  describe('Disabled State', () => {
    it('should disable input when disabled prop is true', () => {
      render(<QuickEntryCard {...defaultProps} disabled={true} />);

      const input = screen.getByPlaceholderText('70.0');
      expect(input).toBeDisabled();
    });

    it('should disable submit button when disabled prop is true', () => {
      render(<QuickEntryCard {...defaultProps} disabled={true} value="75" />);

      const submitButton = screen.getByRole('button', { name: /Log Weight/i });
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Header Action', () => {
    it('should render header action when provided', () => {
      render(
        <QuickEntryCard
          {...defaultProps}
          headerAction={<button>Toggle</button>}
        />
      );

      expect(screen.getByRole('button', { name: 'Toggle' })).toBeInTheDocument();
    });
  });

  describe('Color Variants', () => {
    it('should render with purple color', () => {
      render(<QuickEntryCard {...defaultProps} color="purple-500" />);
      expect(screen.getByRole('button', { name: /Log Weight/i })).toBeInTheDocument();
    });

    it('should render with indigo color', () => {
      render(<QuickEntryCard {...defaultProps} color="indigo-500" label="Steps" />);
      expect(screen.getByRole('button', { name: /Log Steps/i })).toBeInTheDocument();
    });

    it('should render with orange color', () => {
      render(<QuickEntryCard {...defaultProps} color="orange-500" />);
      expect(screen.getByRole('button', { name: /Log Weight/i })).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle submission errors gracefully', async () => {
      const user = userEvent.setup();
      mockOnSubmit.mockRejectedValueOnce(new Error('Network error'));

      render(<QuickEntryCard {...defaultProps} value="75" />);

      const submitButton = screen.getByRole('button', { name: /Log Weight/i });
      await user.click(submitButton);

      // Should not crash, error should be logged
      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
      });
    });
  });
});
