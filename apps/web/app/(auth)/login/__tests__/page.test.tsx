import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const login = vi.fn(async () => {});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    login,
    isLoading: false,
    error: null,
    errorCode: null,
    clearError: vi.fn(),
    resendConfirmation: vi.fn(),
  }),
}));
vi.mock('@/components/ui/logo', () => ({ LogoIcon: () => null }));
vi.mock('@/stores/ui-store', () => ({ useUIStore: () => ({ showToast: vi.fn() }) }));

import LoginPage from '../page';

describe('web login email field', () => {
  beforeEach(() => login.mockClear());

  it('has the no-autocorrect email input attributes', () => {
    render(<LoginPage />);
    const input = screen.getByTestId('login-email');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('inputmode', 'email');
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(input).toHaveAttribute('autocapitalize', 'off');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input.closest('form')).toHaveAttribute('novalidate');
  });

  it('signs in with the cleaned address instead of blocking "gmail com"', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'Abajirao.Apps@Gmail com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByTestId('login-email').closest('form')!);
    await waitFor(() => expect(login).toHaveBeenCalledWith('Abajirao.Apps@gmail.com', 'password123'));
    expect(screen.getByTestId('login-email')).toHaveValue('Abajirao.Apps@gmail.com');
  });

  it('offers "Did you mean" for an ambiguous space and does not submit', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'john smith@gmail.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByTestId('login-email').closest('form')!);
    expect(await screen.findByText("Looks like there's a space in your email.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('email-suggestion'));
    expect(screen.getByTestId('login-email')).toHaveValue('johnsmith@gmail.com');
    expect(login).not.toHaveBeenCalled();
  });
});
