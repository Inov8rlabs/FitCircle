import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TermsPage from '../page';

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('Terms of Service Page', () => {
  describe('Page Header', () => {
    it('should render the main title', () => {
      render(<TermsPage />);
      expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    });

    it('should display correct effective date', () => {
      render(<TermsPage />);
      expect(screen.getByText('Effective Date: October 9, 2025')).toBeInTheDocument();
    });

    it('should have back to home button', () => {
      render(<TermsPage />);
      expect(screen.getByText('Back to Home')).toBeInTheDocument();
    });
  });

  describe('Contact Information', () => {
    it('should display support email address', () => {
      render(<TermsPage />);
      // Use getAllByText since email appears in multiple sections (dispute resolution and contact)
      const emailElements = screen.getAllByText(/support@fitcircle\.ai/i);
      expect(emailElements.length).toBeGreaterThan(0);
    });

    it('should have mailto link for support email', () => {
      render(<TermsPage />);
      const emailLink = screen.getByRole('link', { name: /support@fitcircle\.ai/i });
      expect(emailLink).toHaveAttribute('href', 'mailto:support@fitcircle.ai');
    });

    it('should not display physical address', () => {
      render(<TermsPage />);
      expect(screen.queryByText(/123 Fitness Street/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/San Francisco, CA/i)).not.toBeInTheDocument();
    });

    it('should not display phone number', () => {
      const { container } = render(<TermsPage />);
      expect(container.textContent).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}/);
    });
  });

  describe('Core Sections', () => {
    it('should render Acceptance of Terms section', () => {
      render(<TermsPage />);
      expect(screen.getByText('1. Acceptance of Terms')).toBeInTheDocument();
    });

    it('should render Description of Service section', () => {
      render(<TermsPage />);
      expect(screen.getByText('2. Description of Service')).toBeInTheDocument();
    });

    it('should render Eligibility section', () => {
      render(<TermsPage />);
      expect(screen.getByText('3. Eligibility')).toBeInTheDocument();
    });

    it('should render User Accounts section', () => {
      render(<TermsPage />);
      expect(screen.getByText('4. User Accounts')).toBeInTheDocument();
    });

    it('should render Challenges and Competitions section', () => {
      render(<TermsPage />);
      expect(screen.getByText('5. Challenges and Competitions')).toBeInTheDocument();
    });
  });

  describe('Challenge-Specific Content', () => {
    it('should mention weight loss challenges', () => {
      render(<TermsPage />);
      expect(screen.getByText(/Weight loss challenges with monetary stakes and prize pools/i)).toBeInTheDocument();
    });

    it('should include Fair Play section', () => {
      render(<TermsPage />);
      expect(screen.getByText('5.3 Fair Play and Integrity')).toBeInTheDocument();
    });

    it('should mention prize pool distribution', () => {
      render(<TermsPage />);
      expect(screen.getByText(/Prize pools are distributed to winners according to challenge rules/i)).toBeInTheDocument();
    });

    it('should state prize distribution timeline', () => {
      render(<TermsPage />);
      expect(screen.getByText(/Prizes are distributed within 14 days of challenge completion/i)).toBeInTheDocument();
    });

    it('should mention FitCircles feature', () => {
      render(<TermsPage />);
      expect(screen.getByText(/FitCircles \(friend groups with shared goals\)/i)).toBeInTheDocument();
    });
  });

  describe('Health and Safety', () => {
    it('should render Health and Medical Disclaimer section', () => {
      render(<TermsPage />);
      expect(screen.getByText('9. Health and Medical Disclaimer')).toBeInTheDocument();
    });

    it('should have prominent health warning', () => {
      render(<TermsPage />);
      expect(screen.getByText('IMPORTANT: PLEASE READ CAREFULLY')).toBeInTheDocument();
    });

    it('should state FitCircle is not a medical device', () => {
      render(<TermsPage />);
      expect(screen.getByText(/FitCircle is NOT a medical device, healthcare provider, or substitute for professional medical advice/i)).toBeInTheDocument();
    });

    it('should advise consulting healthcare provider', () => {
      render(<TermsPage />);
      expect(screen.getByText(/You should consult with a qualified healthcare provider before:/i)).toBeInTheDocument();
    });

    it('should mention eating disorder warning', () => {
      render(<TermsPage />);
      expect(screen.getByText(/Using FitCircle if you are pregnant, nursing, or have an eating disorder/i)).toBeInTheDocument();
    });
  });

  describe('Payment and Financial Terms', () => {
    it('should render Payments and Billing section', () => {
      render(<TermsPage />);
      expect(screen.getByText('11. Payments and Billing')).toBeInTheDocument();
    });

    it('should include Payment Methods subsection', () => {
      render(<TermsPage />);
      expect(screen.getByText('11.1 Payment Methods')).toBeInTheDocument();
    });

    it('should include Subscriptions subsection', () => {
      render(<TermsPage />);
      expect(screen.getByText('11.2 Subscriptions')).toBeInTheDocument();
    });

    it('should include Challenge Entry Fees subsection', () => {
      render(<TermsPage />);
      expect(screen.getByText('11.3 Challenge Entry Fees')).toBeInTheDocument();
    });

    it('should include Prize Distribution subsection', () => {
      render(<TermsPage />);
      expect(screen.getByText('11.4 Prize Distribution')).toBeInTheDocument();
    });

    it('should include Refund Policy subsection', () => {
      render(<TermsPage />);
      expect(screen.getByText('11.5 Refund Policy')).toBeInTheDocument();
    });

    it('should state entry fees are non-refundable', () => {
      render(<TermsPage />);
      expect(screen.getByText(/Entry fees are non-refundable once a challenge begins/i)).toBeInTheDocument();
    });
  });

  describe('Privacy and Data', () => {
    it('should render Privacy and Data Protection section', () => {
      render(<TermsPage />);
      expect(screen.getByText('10. Privacy and Data Protection')).toBeInTheDocument();
    });

    it('should link to Privacy Policy', () => {
      render(<TermsPage />);
      const privacyLink = screen.getByRole('link', { name: /Privacy Policy/i });
      expect(privacyLink).toHaveAttribute('href', '/privacy');
    });

    it('should mention data accuracy responsibility', () => {
      render(<TermsPage />);
      expect(screen.getByText('6. Data Accuracy and User Responsibility')).toBeInTheDocument();
    });
  });

  describe('Legal Sections', () => {
    it('should render Limitation of Liability section', () => {
      render(<TermsPage />);
      expect(screen.getByText('15. Limitation of Liability')).toBeInTheDocument();
    });

    it('should have capitalized disclaimer text', () => {
      render(<TermsPage />);
      expect(screen.getByText(/TO THE MAXIMUM EXTENT PERMITTED BY LAW:/i)).toBeInTheDocument();
    });

    it('should render Dispute Resolution section', () => {
      render(<TermsPage />);
      expect(screen.getByText('18. Dispute Resolution')).toBeInTheDocument();
    });

    it('should include Arbitration Agreement', () => {
      render(<TermsPage />);
      expect(screen.getByText('18.2 Arbitration Agreement')).toBeInTheDocument();
    });

    it('should include Class Action Waiver', () => {
      render(<TermsPage />);
      expect(screen.getByText('18.3 Class Action Waiver')).toBeInTheDocument();
    });

    it('should render Governing Law section', () => {
      render(<TermsPage />);
      expect(screen.getByText('19. Governing Law and Jurisdiction')).toBeInTheDocument();
    });

    it('should specify Delaware jurisdiction', () => {
      render(<TermsPage />);
      expect(screen.getByText(/governed by and construed in accordance with the laws of the State of Delaware/i)).toBeInTheDocument();
    });
  });

  describe('User Conduct', () => {
    it('should render Prohibited Uses section', () => {
      render(<TermsPage />);
      expect(screen.getByText('8. Prohibited Uses')).toBeInTheDocument();
    });

    it('should mention multiple account restriction', () => {
      render(<TermsPage />);
      expect(screen.getByText(/Create multiple accounts to manipulate challenges or game the system/i)).toBeInTheDocument();
    });

    it('should prohibit data falsification', () => {
      render(<TermsPage />);
      expect(screen.getByText(/Falsify weight, steps, or other health data/i)).toBeInTheDocument();
    });
  });

  describe('Account Management', () => {
    it('should render Account Termination section', () => {
      render(<TermsPage />);
      expect(screen.getByText('17. Account Termination')).toBeInTheDocument();
    });

    it('should include Termination by You subsection', () => {
      render(<TermsPage />);
      expect(screen.getByText('17.1 Termination by You')).toBeInTheDocument();
    });

    it('should include Termination by FitCircle subsection', () => {
      render(<TermsPage />);
      expect(screen.getByText('17.2 Termination by FitCircle')).toBeInTheDocument();
    });
  });

  describe('Intellectual Property', () => {
    it('should render Intellectual Property section', () => {
      render(<TermsPage />);
      expect(screen.getByText('12. Intellectual Property')).toBeInTheDocument();
    });

    it('should state FitCircle owns the service', () => {
      render(<TermsPage />);
      expect(screen.getByText(/The Service and its original content, features, functionality, and design are owned by FitCircle/i)).toBeInTheDocument();
    });
  });

  describe('Page Footer', () => {
    it('should display copyright notice', () => {
      render(<TermsPage />);
      expect(screen.getByText('© 2025 FitCircle. All rights reserved.')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      const { container } = render(<TermsPage />);
      const h1 = container.querySelector('h1');
      const h2Elements = container.querySelectorAll('h2');
      const h3Elements = container.querySelectorAll('h3');

      expect(h1).toBeInTheDocument();
      expect(h2Elements.length).toBeGreaterThan(0);
      expect(h3Elements.length).toBeGreaterThan(0);
    });

    it('should use semantic HTML for lists', () => {
      const { container } = render(<TermsPage />);
      const lists = container.querySelectorAll('ul');
      expect(lists.length).toBeGreaterThan(10);
    });
  });

  describe('Content Completeness', () => {
    it('should have at least 20 major sections', () => {
      const { container } = render(<TermsPage />);
      const sections = container.querySelectorAll('section');
      expect(sections.length).toBeGreaterThanOrEqual(20);
    });

    it('should mention support email in contact section', () => {
      render(<TermsPage />);
      expect(screen.getByText(/If you have any questions, concerns, or feedback regarding these Terms of Service, please contact us at:/i)).toBeInTheDocument();
    });

    it('should have response time information', () => {
      render(<TermsPage />);
      expect(screen.getByText(/We typically respond to inquiries within 2-3 business days/i)).toBeInTheDocument();
    });
  });
});
