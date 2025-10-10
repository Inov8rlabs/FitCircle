import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent } from '../../utils/test-utils';
import { DatePicker, DateRangeDisplay } from '@/components/ui/date-picker';

describe('DatePicker', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render with placeholder text', () => {
      render(
        <DatePicker
          value=""
          onChange={mockOnChange}
          placeholder="Select start date"
        />
      );

      expect(screen.getByText('Select start date')).toBeInTheDocument();
      expect(screen.getByText('Not selected')).toBeInTheDocument();
    });

    it('should render with label', () => {
      render(
        <DatePicker
          value=""
          onChange={mockOnChange}
          label="Start Date"
          placeholder="Select date"
        />
      );

      expect(screen.getByText('Start Date')).toBeInTheDocument();
    });

    it('should show required indicator when required prop is true', () => {
      render(
        <DatePicker
          value=""
          onChange={mockOnChange}
          label="Start Date"
          required
        />
      );

      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('should show error message when error prop is provided', () => {
      render(
        <DatePicker
          value=""
          onChange={mockOnChange}
          error="Date is required"
        />
      );

      expect(screen.getByText('Date is required')).toBeInTheDocument();
    });

    it('should be disabled when disabled prop is true', () => {
      const { container } = render(
        <DatePicker
          value=""
          onChange={mockOnChange}
          disabled
        />
      );

      // Native date input doesn't have textbox role
      const input = container.querySelector('input[type="date"]');
      expect(input).toBeDisabled();
    });
  });

  describe('Date Formatting', () => {
    it('should format YYYY-MM-DD date correctly', () => {
      render(
        <DatePicker value="2025-09-01" onChange={mockOnChange} />
      );

      // Should display formatted date (e.g., "Mon, Sep 1, 2025")
      const formattedDate = screen.queryByText(/Sep.*1.*2025/);
      expect(formattedDate).toBeInTheDocument();
    });

    it('should format ISO timestamp correctly', () => {
      render(
        <DatePicker value="2025-09-01T12:00:00Z" onChange={mockOnChange} />
      );

      // Should extract date part and format correctly
      const formattedDate = screen.queryByText(/Sep.*1.*2025/);
      expect(formattedDate).toBeInTheDocument();
    });

    it('should handle invalid date gracefully', () => {
      render(
        <DatePicker value="invalid-date" onChange={mockOnChange} />
      );

      expect(screen.getByText('Invalid Date')).toBeInTheDocument();
    });

    it('should handle empty date', () => {
      render(
        <DatePicker value="" onChange={mockOnChange} />
      );

      expect(screen.getByText('Not selected')).toBeInTheDocument();
    });

    it('should not shift dates across timezones', () => {
      // This tests the timezone bug fix - Sept 1 should stay Sept 1
      render(
        <DatePicker value="2025-09-01" onChange={mockOnChange} />
      );

      // Should show September, not August
      const formattedDate = screen.queryByText(/Sep/);
      expect(formattedDate).toBeInTheDocument();

      // Should NOT show August
      const augustDate = screen.queryByText(/Aug/);
      expect(augustDate).not.toBeInTheDocument();
    });
  });

  describe('User Interaction', () => {
    it('should call onChange when date is selected', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <DatePicker value="" onChange={mockOnChange} />
      );

      const input = container.querySelector('input[type="date"]');
      await user.type(input as Element, '2025-09-01');

      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe('Min/Max Constraints', () => {
    it('should respect min date', () => {
      const { container } = render(
        <DatePicker
          value=""
          onChange={mockOnChange}
          min="2025-01-01"
        />
      );

      const input = container.querySelector('input[type="date"]') as HTMLInputElement;
      expect(input.min).toBe('2025-01-01');
    });

    it('should respect max date', () => {
      const { container } = render(
        <DatePicker
          value=""
          onChange={mockOnChange}
          max="2025-12-31"
        />
      );

      const input = container.querySelector('input[type="date"]') as HTMLInputElement;
      expect(input.max).toBe('2025-12-31');
    });
  });
});

describe('DateRangeDisplay', () => {
  describe('Duration Calculation', () => {
    it('should calculate duration in days', () => {
      render(
        <DateRangeDisplay
          startDate="2025-01-01"
          endDate="2025-01-08"
        />
      );

      // 7 days duration is displayed as "1 week"
      expect(screen.getByText('1 week')).toBeInTheDocument();
    });

    it('should calculate duration in weeks', () => {
      render(
        <DateRangeDisplay
          startDate="2025-01-01"
          endDate="2025-01-15"
        />
      );

      // 2 weeks (14 days)
      expect(screen.getByText(/2 weeks/)).toBeInTheDocument();
    });

    it('should show weeks and remaining days', () => {
      render(
        <DateRangeDisplay
          startDate="2025-01-01"
          endDate="2025-01-20"
        />
      );

      // 2 weeks and 5 days (19 days total)
      expect(screen.getByText(/2 weeks.*5d/)).toBeInTheDocument();
    });

    it('should handle single day correctly', () => {
      render(
        <DateRangeDisplay
          startDate="2025-01-01"
          endDate="2025-01-02"
        />
      );

      expect(screen.getByText('1 day')).toBeInTheDocument();
    });

    it('should handle invalid dates gracefully', () => {
      render(
        <DateRangeDisplay
          startDate="invalid"
          endDate="invalid"
        />
      );

      expect(screen.getByText('Invalid dates')).toBeInTheDocument();
      expect(screen.getByText('Please check your dates')).toBeInTheDocument();
    });

    it('should handle missing dates', () => {
      render(
        <DateRangeDisplay startDate="" endDate="" />
      );

      expect(screen.getByText('Not set')).toBeInTheDocument();
      expect(screen.getByText('No dates selected')).toBeInTheDocument();
    });

    it('should not have timezone shift bugs', () => {
      // Test that Sept 1 - Sept 30 shows as Sept, not Aug 31 - Sept 29
      render(
        <DateRangeDisplay
          startDate="2025-09-01"
          endDate="2025-09-30"
        />
      );

      const dateRange = screen.getByText(/Sep.*1.*-.*Sep.*30/);
      expect(dateRange).toBeInTheDocument();

      // Should NOT contain August
      const augustMention = screen.queryByText(/Aug/);
      expect(augustMention).not.toBeInTheDocument();
    });
  });

  describe('Date Range Display', () => {
    it('should format date range correctly', () => {
      render(
        <DateRangeDisplay
          startDate="2025-01-15"
          endDate="2025-02-15"
        />
      );

      expect(screen.getByText(/Jan.*15.*-.*Feb.*15/)).toBeInTheDocument();
    });

    it('should handle ISO timestamps', () => {
      render(
        <DateRangeDisplay
          startDate="2025-01-15T12:00:00Z"
          endDate="2025-02-15T12:00:00Z"
        />
      );

      expect(screen.getByText(/Jan.*15.*-.*Feb.*15/)).toBeInTheDocument();
    });
  });
});
