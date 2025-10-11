'use client';

import { useState, useRef } from 'react';
import { Calendar } from 'lucide-react';
import { Input } from './input';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
  error?: string;
  required?: boolean;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  disabled = false,
  className,
  label,
  error,
  required = false,
}: DatePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return '';

    try {
      // Extract just the date part (YYYY-MM-DD) from any format
      const datePart = dateStr.split('T')[0];

      if (!datePart || datePart.length !== 10) {
        return 'Invalid Date';
      }

      // Parse the date parts to avoid timezone issues
      const [year, month, day] = datePart.split('-').map(Number);

      // Create date in UTC to avoid timezone shifts
      const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

      // Check if date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }

      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
    } catch (error) {
      console.error('Error formatting date:', dateStr, error);
      return 'Invalid Date';
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className="text-sm font-medium text-white">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        {/* Display field */}
        <div
          className={cn(
            'relative flex items-center gap-3 px-4 py-3 rounded-lg border transition-all cursor-pointer',
            'bg-slate-800/50 border-slate-700 hover:border-slate-600',
            isFocused && 'ring-2 ring-purple-500/50 border-purple-500',
            error && 'border-red-500 hover:border-red-400',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
          onClick={() => !disabled && inputRef.current?.showPicker()}
        >
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-indigo-500/20">
            <Calendar className="h-5 w-5 text-purple-400" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400 mb-0.5">
              {placeholder}
            </div>
            <div className="text-base font-medium text-white truncate">
              {value ? formatDisplayDate(value) : 'Not selected'}
            </div>
          </div>

          {/* Hidden native date input */}
          <input
            ref={inputRef}
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            min={min}
            max={max}
            disabled={disabled}
            className="absolute inset-0 opacity-0 cursor-pointer"
            style={{ colorScheme: 'dark' }}
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}

interface DateRangeDisplayProps {
  startDate: string;
  endDate: string;
  className?: string;
}

export function DateRangeDisplay({ startDate, endDate, className }: DateRangeDisplayProps) {
  const formatDateRange = (start: string, end: string) => {
    if (!start || !end) return { duration: 'Not set', dateRange: 'No dates selected' };

    // Parse dates - extract date part and create UTC dates
    let startD: Date;
    let endD: Date;

    try {
      // Extract just the date part (YYYY-MM-DD)
      const startPart = start.split('T')[0];
      const endPart = end.split('T')[0];

      // Parse date components
      const [startYear, startMonth, startDay] = startPart.split('-').map(Number);
      const [endYear, endMonth, endDay] = endPart.split('-').map(Number);

      // Create dates in UTC at noon to avoid timezone issues
      startD = new Date(Date.UTC(startYear, startMonth - 1, startDay, 12, 0, 0));
      endD = new Date(Date.UTC(endYear, endMonth - 1, endDay, 12, 0, 0));

      // Validate dates
      if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
        return { duration: 'Invalid dates', dateRange: 'Please check your dates' };
      }
    } catch (error) {
      return { duration: 'Invalid dates', dateRange: 'Please check your dates' };
    }

    const diffTime = Math.abs(endD.getTime() - startD.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);

    let duration = '';
    if (diffWeeks >= 1) {
      duration = `${diffWeeks} ${diffWeeks === 1 ? 'week' : 'weeks'}`;
      if (diffDays % 7 > 0) {
        duration += ` ${diffDays % 7}d`;
      }
    } else {
      duration = `${diffDays} ${diffDays === 1 ? 'day' : 'days'}`;
    }

    const dateRange = `${startD.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    })} - ${endD.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    })}`;

    return { duration, dateRange };
  };

  const { duration, dateRange } = formatDateRange(startDate, endDate);

  return (
    <div className={cn('flex-1 min-w-0', className)}>
      <p className="text-xs text-gray-400 mb-0.5">Duration</p>
      <p className="text-base sm:text-lg lg:text-xl font-bold text-white truncate">{duration}</p>
      <p className="text-[10px] sm:text-xs text-gray-400 leading-tight mt-0.5 break-words">{dateRange}</p>
    </div>
  );
}
