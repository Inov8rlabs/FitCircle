'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickEntryCardProps {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  placeholder: string;
  unit?: string;
  color: string;
  type?: 'number' | 'text';
  step?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  helperText?: string;
  headerAction?: React.ReactNode;
}

export function QuickEntryCard({
  icon: Icon,
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  unit,
  color,
  type = 'number',
  step,
  min,
  max,
  disabled = false,
  helperText,
  headerAction,
}: QuickEntryCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Color mapping for Tailwind classes
  const colorClasses = {
    'purple-500': {
      bg: 'bg-purple-500/10',
      text: 'text-purple-500',
      ring: 'ring-purple-500',
      border: 'border-purple-500',
      button: 'bg-purple-500 hover:bg-purple-600',
    },
    'indigo-500': {
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-500',
      ring: 'ring-indigo-500',
      border: 'border-indigo-500',
      button: 'bg-indigo-500 hover:bg-indigo-600',
    },
    'orange-500': {
      bg: 'bg-orange-500/10',
      text: 'text-orange-500',
      ring: 'ring-orange-500',
      border: 'border-orange-500',
      button: 'bg-orange-500 hover:bg-orange-600',
    },
  };

  const colors = colorClasses[color as keyof typeof colorClasses] || colorClasses['purple-500'];

  const handleSubmit = async () => {
    if (!value || disabled) return;

    setIsSubmitting(true);
    try {
      await onSubmit();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
    } catch (error) {
      console.error('Error submitting:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value) {
      handleSubmit();
    }
  };

  const handleClear = () => {
    onChange('');
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className={cn(
          'bg-slate-900/50 border-slate-800 backdrop-blur-xl transition-all duration-300',
          isFocused && `ring-2 ${colors.ring} ${colors.border}`,
          showSuccess && 'ring-2 ring-green-500 border-green-500'
        )}
      >
        <CardContent className="p-4 sm:p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={cn('p-2.5 rounded-xl', colors.bg)}>
                <Icon className={cn('h-5 w-5', colors.text)} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">{label}</h3>
                {helperText && (
                  <p className="text-xs text-gray-400 mt-0.5">{helperText}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {headerAction}
              <AnimatePresence mode="wait">
                {showSuccess && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="p-1.5 bg-green-500/20 rounded-full"
                  >
                    <Check className="h-4 w-4 text-green-400" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Input Area */}
          <div className="relative">
            <input
              type={type}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyPress={handleKeyPress}
              placeholder={placeholder}
              step={step}
              min={min}
              max={max}
              disabled={disabled || isSubmitting}
              className={cn(
                'w-full px-4 py-3 sm:py-4 text-2xl sm:text-3xl font-bold text-center',
                'bg-slate-800/50 border-2 border-slate-700 rounded-xl',
                'focus:outline-none focus:ring-0 transition-all duration-200',
                'text-white placeholder:text-gray-600',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isFocused && colors.border,
                showSuccess && 'border-green-500'
              )}
            />
            {unit && value && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <span className="text-lg font-medium text-gray-400">{unit}</span>
              </div>
            )}
            {value && !isSubmitting && (
              <button
                onClick={handleClear}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-700 rounded-full transition-colors"
              >
                <X className="h-4 w-4 text-gray-400" />
              </button>
            )}
          </div>

          {/* Submit Button */}
          <div className="mt-4">
            <Button
              onClick={handleSubmit}
              disabled={!value || disabled || isSubmitting}
              className={cn(
                'w-full h-11 sm:h-12 text-base font-semibold',
                'transition-all duration-200',
                colors.button,
                'disabled:opacity-50 disabled:cursor-not-allowed',
                showSuccess && 'bg-green-600 hover:bg-green-700'
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Saving...
                </>
              ) : showSuccess ? (
                <>
                  <Check className="h-5 w-5 mr-2" />
                  Saved!
                </>
              ) : (
                <>
                  <Check className="h-5 w-5 mr-2" />
                  Log {label}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
