import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '../dialog';

describe('Dialog Component', () => {
  describe('Close Button', () => {
    it('should render close button with X icon', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toBeInTheDocument();
    });

    it('should have proper z-index to stay above content', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toHaveClass('z-50');
    });

    it('should have proper styling for visibility', () => {
      const { container } = render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });

      // Check for visibility styling classes
      expect(closeButton).toHaveClass('text-gray-400');
      expect(closeButton).toHaveClass('hover:text-white');
      expect(closeButton).toHaveClass('hover:bg-slate-800/50');
    });

    it('should have larger click target with padding', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toHaveClass('p-1.5');
    });

    it('should have rounded corners', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toHaveClass('rounded-lg');
    });

    it('should have focus ring styling', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toHaveClass('focus:ring-2');
      expect(closeButton).toHaveClass('focus:ring-orange-500/50');
      expect(closeButton).toHaveClass('focus:ring-offset-slate-900');
    });

    it('should be positioned in top right corner', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toHaveClass('absolute');
      expect(closeButton).toHaveClass('right-4');
      expect(closeButton).toHaveClass('top-4');
    });

    it('should have larger icon size for better visibility', () => {
      const { container } = render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      // Check for icon with size classes
      const closeButton = screen.getByRole('button', { name: /close/i });
      const icon = closeButton.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass('h-5', 'w-5');
    });
  });

  describe('Dialog Content', () => {
    it('should render dialog title', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Title</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      expect(screen.getByText('Test Title')).toBeInTheDocument();
    });

    it('should render dialog description', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Title</DialogTitle>
              <DialogDescription>Test Description</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      expect(screen.getByText('Test Description')).toBeInTheDocument();
    });

    it('should render children content', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <div>Custom Content</div>
          </DialogContent>
        </Dialog>
      );

      expect(screen.getByText('Custom Content')).toBeInTheDocument();
    });
  });

  describe('Dialog Overlay', () => {
    it('should render overlay when dialog is open', () => {
      const { baseElement } = render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      // Check for overlay with dark background (portal renders outside container)
      const overlay = baseElement.querySelector('[class*="bg-black"]');
      expect(overlay).toBeInTheDocument();
    });
  });

  describe('Dialog Trigger', () => {
    it('should render trigger button', () => {
      render(
        <Dialog>
          <DialogTrigger asChild>
            <button>Open Dialog</button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      expect(screen.getByText('Open Dialog')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have screen reader text for close button', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const srText = screen.getByText('Close');
      expect(srText).toHaveClass('sr-only');
    });

    it('should be keyboard accessible with focus outline', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toHaveClass('focus:outline-none');
      expect(closeButton).toHaveClass('focus:ring-2');
    });

    it('should disable pointer events when disabled', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toHaveClass('disabled:pointer-events-none');
    });
  });

  describe('Animation and Transitions', () => {
    it('should have transition classes on close button', () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toHaveClass('transition-all');
    });

    it('should have animation classes on overlay', () => {
      const { baseElement } = render(
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      // Check for overlay with animation attributes (portal renders outside container)
      const overlay = baseElement.querySelector('[data-state="open"]');
      expect(overlay).toBeInTheDocument();
    });
  });
});
