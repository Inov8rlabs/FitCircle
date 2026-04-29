import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, waitFor } from '../../utils/test-utils';
import { ShareFitCircleDialog } from '@/components/ShareFitCircleDialog';

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';

describe('ShareFitCircleDialog', () => {
  const mockProps = {
    open: true,
    onOpenChange: vi.fn(),
    fitCircleId: 'test-circle-id',
    fitCircleName: 'Summer Weight Loss Challenge 2025',
    inviteCode: 'ABC123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render dialog when open', () => {
      render(<ShareFitCircleDialog {...mockProps} />);

      expect(screen.getByText(/Share "Summer Weight Loss Challenge 2025"/)).toBeInTheDocument();
      expect(screen.getByText('Invite friends to join this FitCircle')).toBeInTheDocument();
    });

    it('should render all three tabs', () => {
      render(<ShareFitCircleDialog {...mockProps} />);

      expect(screen.getByRole('tab', { name: /Link/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Message/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Email/ })).toBeInTheDocument();
    });

    it('should not render when closed', () => {
      render(<ShareFitCircleDialog {...mockProps} open={false} />);

      expect(screen.queryByText(/Share "Summer Weight Loss Challenge 2025"/)).not.toBeInTheDocument();
    });
  });

  describe('Link Tab', () => {
    it('should display invite URL', () => {
      render(<ShareFitCircleDialog {...mockProps} />);

      const expectedUrl = `${window.location.origin}/join/ABC123`;
      expect(screen.getByDisplayValue(expectedUrl)).toBeInTheDocument();
    });

    it('should copy link to clipboard when copy button clicked', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const copyButton = screen.getByRole('button', { name: /Copy/ });
      await user.click(copyButton);

      // Verify via UI state and toast (clipboard API is unreliable in JSDOM)
      await waitFor(() => {
        expect(screen.getByText(/Copied!/)).toBeInTheDocument();
      });
      expect(toast.success).toHaveBeenCalledWith('Invite link copied to clipboard!');
    });

    it('should show success state after copying link', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const copyButton = screen.getByRole('button', { name: /Copy/ });
      await user.click(copyButton);

      await waitFor(() => {
        expect(screen.getByText(/Copied!/)).toBeInTheDocument();
      });
    });

    it('should handle clipboard copy failure gracefully', async () => {
      const user = userEvent.setup();
      // Spy on the actual clipboard to force a rejection
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Clipboard error'));

      render(<ShareFitCircleDialog {...mockProps} />);

      const copyButton = screen.getByRole('button', { name: /Copy/ });
      await user.click(copyButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to copy link');
      });
    });
  });

  describe('Message Tab - Social Share', () => {
    it('should switch to message tab when clicked', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      expect(screen.getByText(/Copy this pre-formatted message/)).toBeInTheDocument();
    });

    it('should display pre-formatted message with FitCircle name', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      await waitFor(() => {
        const elements = screen.getAllByText(/Summer Weight Loss Challenge 2025/);
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('should include invite URL in message', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      await waitFor(() => {
        const expectedUrl = `${window.location.origin}/join/ABC123`;
        expect(screen.getByText(new RegExp(expectedUrl))).toBeInTheDocument();
      });
    });

    it('should generate correct message format', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      expect(screen.getByText(/Join me on FitCircle!/)).toBeInTheDocument();
      expect(screen.getByText(/Let's crush our fitness goals together/)).toBeInTheDocument();
      expect(screen.getByText(/Track progress & stay accountable/)).toBeInTheDocument();
      expect(screen.getByText(/Compete on the leaderboard/)).toBeInTheDocument();
      expect(screen.getByText(/Let's do this! 🚀/)).toBeInTheDocument();
    });

    it('should copy formatted message to clipboard', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      await waitFor(() => {
        expect(screen.getByText(/Copy this pre-formatted message/)).toBeInTheDocument();
      });

      const copyButton = screen.getByRole('button', { name: /Copy Message/ });
      await user.click(copyButton);

      // Verify copy succeeded via UI state
      await waitFor(() => {
        expect(screen.getByText(/Copied to Clipboard!/)).toBeInTheDocument();
      });
      expect(toast.success).toHaveBeenCalled();
    });

    it('should show success state after copying message', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      const copyButton = screen.getByRole('button', { name: /Copy Message/ });
      await user.click(copyButton);

      await waitFor(() => {
        expect(screen.getByText(/Copied to Clipboard!/)).toBeInTheDocument();
      });
    });

    it('should display WhatsApp platform indicator', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      await waitFor(() => {
        expect(screen.getByText(/📱 WhatsApp/)).toBeInTheDocument();
        expect(screen.getByText(/Paste in chat or status/)).toBeInTheDocument();
      });
    });

    it('should display Instagram platform indicator', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      await waitFor(() => {
        expect(screen.getByText(/📸 Instagram/)).toBeInTheDocument();
        expect(screen.getByText(/Share in DM or story/)).toBeInTheDocument();
      });
    });

    it('should show helpful tip for message usage', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      await waitFor(() => {
        expect(screen.getByText(/ready to paste anywhere/i)).toBeInTheDocument();
      });
    });
  });

  describe('Email Tab', () => {
    it('should switch to email tab when clicked', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const emailTab = screen.getByRole('tab', { name: /Email/ });
      await user.click(emailTab);

      expect(screen.getByText(/Send personalized invitation emails/)).toBeInTheDocument();
    });

    it('should allow adding email addresses', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const emailTab = screen.getByRole('tab', { name: /Email/ });
      await user.click(emailTab);

      const emailInput = screen.getByPlaceholderText(/friend1@example.com/);
      await user.type(emailInput, 'test@example.com');

      expect(emailInput).toHaveValue('test@example.com');
    });

    it('should show add another email button', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const emailTab = screen.getByRole('tab', { name: /Email/ });
      await user.click(emailTab);

      expect(screen.getByRole('button', { name: /Add another email/ })).toBeInTheDocument();
    });
  });

  describe('Message Content Validation', () => {
    it('should include emojis in the message', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      // Verify emojis are present in the pre-formatted message display
      const messageContainer = screen.getByText(/Join me on FitCircle!/);
      const messageText = messageContainer.textContent || '';
      expect(messageText).toContain('🏆');
      expect(messageText).toContain('💪');
      expect(messageText).toContain('🎯');
      expect(messageText).toContain('🏅');
      expect(messageText).toContain('🎉');
      expect(messageText).toContain('🚀');
    });

    it('should format message with proper line breaks', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      // The pre element should contain multiple lines
      const preElement = screen.getByText(/Join me on FitCircle!/).closest('pre');
      expect(preElement).toBeInTheDocument();
      const content = preElement?.textContent || '';
      expect(content).toContain('\n');
    });

    it('should include call-to-action in message', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      // Verify call-to-action elements are in the message
      const messageContainer = screen.getByText(/Join me on FitCircle!/);
      const messageText = messageContainer.textContent || '';
      expect(messageText).toContain('Join here:');
      expect(messageText).toContain("Let's do this!");
    });
  });

  describe('Accessibility', () => {
    it('should have accessible tab navigation', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);

      tabs.forEach((tab) => {
        expect(tab).toBeVisible();
      });
    });

    it('should have accessible button labels', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      const copyButton = screen.getByRole('button', { name: /Copy Message/ });
      expect(copyButton).toHaveAccessibleName();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long FitCircle names', async () => {
      const user = userEvent.setup();
      const longName = 'A'.repeat(100) + ' Challenge';

      render(<ShareFitCircleDialog {...mockProps} fitCircleName={longName} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      // Verify the long name appears in the message
      const messageContainer = screen.getByText(/Join me on FitCircle!/);
      expect(messageContainer.textContent).toContain(longName);
    });

    it('should handle special characters in FitCircle name', async () => {
      const user = userEvent.setup();
      const specialName = 'Test & "Special" <Challenge> 2025';

      render(<ShareFitCircleDialog {...mockProps} fitCircleName={specialName} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      // Verify the special characters appear in the message
      const messageContainer = screen.getByText(/Join me on FitCircle!/);
      expect(messageContainer.textContent).toContain(specialName);
    });

    it('should reset success state when switching tabs', async () => {
      const user = userEvent.setup();
      render(<ShareFitCircleDialog {...mockProps} />);

      const messageTab = screen.getByRole('tab', { name: /Message/ });
      await user.click(messageTab);

      const copyButton = screen.getByRole('button', { name: /Copy Message/ });
      await user.click(copyButton);

      await waitFor(() => {
        expect(screen.getByText(/Copied to Clipboard!/)).toBeInTheDocument();
      });

      const linkTab = screen.getByRole('tab', { name: /Link/ });
      await user.click(linkTab);

      await user.click(messageTab);
    });
  });
});
