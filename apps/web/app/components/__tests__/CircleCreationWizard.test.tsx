import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CircleCreationWizard from '../CircleCreationWizard';
import { useAuthStore } from '@/stores/auth-store';

// Mock dependencies
vi.mock('@/stores/auth-store');
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: 'test-id' }, error: null }))
        }))
      }))
    }))
  }
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  }
}));

describe('CircleCreationWizard', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    });
  });

  describe('Progress Indicator', () => {
    it('should render all 4 step circles', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      // Check that all 4 step numbers are present
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('should render step labels correctly', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByText('Basic Info')).toBeInTheDocument();
      expect(screen.getByText('Timeline')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Invite')).toBeInTheDocument();
    });

    it('should highlight active step with orange color', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const basicInfoLabel = screen.getByText('Basic Info');
      expect(basicInfoLabel).toHaveClass('text-orange-400');
    });

    it('should show inactive steps with gray color', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const timelineLabel = screen.getByText('Timeline');
      expect(timelineLabel).toHaveClass('text-gray-500');
    });

    it('should render connecting lines between steps', () => {
      const { container } = render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      // Check for 3 connecting lines (between 4 steps)
      const lines = container.querySelectorAll('.h-1.w-12');
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should center labels under step circles', () => {
      const { container } = render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const labels = container.querySelectorAll('.text-center.whitespace-nowrap');
      expect(labels.length).toBe(4);
    });
  });

  describe('Form Field Layout', () => {
    it('should add padding to step content to prevent clipping', () => {
      const { container } = render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const stepContent = container.querySelector('.min-h-\\[320px\\]');
      expect(stepContent).toHaveClass('px-4');
    });

    it('should render Circle Name input on step 1', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByLabelText(/Circle Name/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Summer Shred Challenge/i)).toBeInTheDocument();
    });

    it('should render Description textarea on step 1', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/What's this challenge about/i)).toBeInTheDocument();
    });

    it('should show character count for Circle Name', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByText('0/50 characters')).toBeInTheDocument();
    });
  });

  describe('Step Navigation', () => {
    it('should disable Next button when Circle Name is empty', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const nextButton = screen.getByRole('button', { name: /Next/i });
      expect(nextButton).toBeDisabled();
    });

    it('should enable Next button when Circle Name is valid', async () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const nameInput = screen.getByLabelText(/Circle Name/i);
      fireEvent.change(nameInput, { target: { value: 'Test Circle' } });

      await waitFor(() => {
        const nextButton = screen.getByRole('button', { name: /Next/i });
        expect(nextButton).not.toBeDisabled();
      });
    });

    it('should show Cancel button on step 1', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    });

    it('should call onClose when Cancel is clicked', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Challenge Types', () => {
    it('should render all 4 challenge type cards', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByText('Weight Loss')).toBeInTheDocument();
      expect(screen.getByText('Daily Steps')).toBeInTheDocument();
      expect(screen.getByText('Workout Frequency')).toBeInTheDocument();
      expect(screen.getByText('Custom Goal')).toBeInTheDocument();
    });

    it('should select Weight Loss by default', () => {
      const { container } = render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const weightLossCard = screen.getByText('Weight Loss').closest('[class*="cursor-pointer"]');
      expect(weightLossCard).toHaveClass('border-orange-500');
    });
  });

  describe('Modal Visibility', () => {
    it('should not render when isOpen is false', () => {
      render(
        <CircleCreationWizard
          isOpen={false}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.queryByText('Create Your FitCircle')).not.toBeInTheDocument();
    });

    it('should render when isOpen is true', () => {
      render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByText('Create Your FitCircle')).toBeInTheDocument();
    });
  });

  describe('Responsive Design', () => {
    it('should have min-width constraint on step labels', () => {
      const { container } = render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const stepGroups = container.querySelectorAll('.min-w-\\[60px\\]');
      expect(stepGroups.length).toBe(4);
    });

    it('should use responsive line widths', () => {
      const { container } = render(
        <CircleCreationWizard
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      // Check for responsive width classes
      const lines = container.querySelectorAll('[class*="w-12"][class*="sm:w-16"]');
      expect(lines.length).toBeGreaterThan(0);
    });
  });
});
