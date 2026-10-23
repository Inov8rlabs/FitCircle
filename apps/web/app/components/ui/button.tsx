'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn, triggerHapticFeedback } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition duration-200 ease-ios focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] min-h-touch',
  {
    variants: {
      variant: {
        // iOS primary CTA: purple to pink gradient with a soft glow.
        default: 'bg-gradient-brand text-white shadow-glow hover:brightness-110',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-hairline bg-white/5 text-white hover:bg-white/10',
        secondary: 'bg-surface-raised text-white hover:bg-slate-700',
        ghost: 'text-fg-secondary hover:bg-white/5 hover:text-white',
        link: 'text-primary underline-offset-4 hover:underline',
        success: 'bg-success text-success-foreground hover:bg-success/90',
        warning: 'bg-warning text-warning-foreground hover:bg-warning/90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-lg px-3',
        lg: 'h-12 rounded-xl px-8 text-base',
        xl: 'h-14 rounded-xl px-10 text-lg',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
        'icon-lg': 'h-12 w-12',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      fullWidth: false,
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  haptic?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    className,
    variant,
    size,
    fullWidth,
    asChild = false,
    loading = false,
    haptic = true,
    leftIcon,
    rightIcon,
    disabled,
    children,
    onClick,
    ...props
  }, ref) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (haptic && !disabled && !loading) {
        triggerHapticFeedback('light');
      }
      onClick?.(e);
    };

    const Comp = asChild ? Slot : 'button';

    // When asChild is true, we need to pass children directly without wrapping
    // The Slot component will merge props onto the child element
    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, fullWidth, className }))}
          ref={ref}
          disabled={disabled || loading}
          onClick={handleClick}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    // When asChild is false, render the button with all the icons and loading states
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        disabled={disabled || loading}
        onClick={handleClick}
        {...props}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {!loading && leftIcon && <span className="mr-2">{leftIcon}</span>}
        {children}
        {!loading && rightIcon && <span className="ml-2">{rightIcon}</span>}
      </Comp>
    );
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };