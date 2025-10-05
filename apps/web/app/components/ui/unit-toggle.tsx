'use client';

import { motion } from 'framer-motion';
import { Scale, Loader2 } from 'lucide-react';
import { UnitSystem } from '@/lib/utils/units';
import { cn } from '@/lib/utils';

interface UnitToggleProps {
  value: UnitSystem;
  onChange: (value: UnitSystem) => void | Promise<void>;
  isLoading?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function UnitToggle({
  value,
  onChange,
  isLoading = false,
  disabled = false,
  size = 'md',
  className,
}: UnitToggleProps) {
  const sizes = {
    sm: {
      container: 'h-7 p-0.5',
      button: 'px-2 py-0.5 text-xs',
      icon: 'h-3 w-3',
    },
    md: {
      container: 'h-9 p-1',
      button: 'px-3 py-1 text-sm',
      icon: 'h-4 w-4',
    },
    lg: {
      container: 'h-11 p-1',
      button: 'px-4 py-1.5 text-base',
      icon: 'h-5 w-5',
    },
  };

  const sizeClasses = sizes[size];

  const handleToggle = async (newValue: UnitSystem) => {
    if (disabled || isLoading || value === newValue) return;
    await onChange(newValue);
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg bg-slate-800/50 border border-slate-700',
        sizeClasses.container,
        className
      )}
    >
      <button
        type="button"
        onClick={() => handleToggle('metric')}
        disabled={disabled || isLoading}
        className={cn(
          'relative flex items-center justify-center rounded-md font-medium transition-all',
          sizeClasses.button,
          value === 'metric'
            ? 'bg-indigo-500/20 text-indigo-400'
            : 'text-gray-500 hover:text-gray-400'
        )}
      >
        {value === 'metric' && (
          <motion.div
            layoutId="unit-toggle-indicator"
            className="absolute inset-0 bg-indigo-500/20 rounded-md"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
          />
        )}
        {isLoading && value === 'metric' ? (
          <Loader2 className={cn(sizeClasses.icon, 'animate-spin mr-1')} />
        ) : (
          <Scale className={cn(sizeClasses.icon, 'mr-1')} />
        )}
        <span className="relative">kg</span>
      </button>

      <button
        type="button"
        onClick={() => handleToggle('imperial')}
        disabled={disabled || isLoading}
        className={cn(
          'relative flex items-center justify-center rounded-md font-medium transition-all',
          sizeClasses.button,
          value === 'imperial'
            ? 'bg-purple-500/20 text-purple-400'
            : 'text-gray-500 hover:text-gray-400'
        )}
      >
        {value === 'imperial' && (
          <motion.div
            layoutId="unit-toggle-indicator"
            className="absolute inset-0 bg-purple-500/20 rounded-md"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
          />
        )}
        {isLoading && value === 'imperial' ? (
          <Loader2 className={cn(sizeClasses.icon, 'animate-spin mr-1')} />
        ) : (
          <Scale className={cn(sizeClasses.icon, 'mr-1')} />
        )}
        <span className="relative">lbs</span>
      </button>
    </div>
  );
}

// Compact version for inline use
export function UnitToggleCompact({
  value,
  onChange,
  isLoading = false,
  disabled = false,
}: Pick<UnitToggleProps, 'value' | 'onChange' | 'isLoading' | 'disabled'>) {
  const handleClick = async () => {
    if (disabled || isLoading) return;
    const newValue = value === 'metric' ? 'imperial' : 'metric';
    await onChange(newValue);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isLoading}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-colors',
        'bg-slate-800/50 border border-slate-700',
        value === 'metric'
          ? 'text-indigo-400 hover:bg-indigo-500/10'
          : 'text-purple-400 hover:bg-purple-500/10',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
    >
      {isLoading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Scale className="h-3 w-3" />
      )}
      {value === 'metric' ? 'kg' : 'lbs'}
    </button>
  );
}