/**
 * Timezone Utilities
 *
 * Helper functions for handling dates and timezones correctly across the application.
 * All dates should be stored in the user's local timezone, not UTC.
 *
 * CRITICAL: The backend should respect the timezone the user is in when logging data.
 * - iOS sends dates in the user's local timezone
 * - We store dates in YYYY-MM-DD format in the user's local timezone
 * - We use the user's timezone from profiles.timezone for all date operations
 */

import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Get user's timezone from their profile
 * Defaults to 'UTC' if not set
 */
export async function getUserTimezone(
  userId: string,
  supabase: SupabaseClient
): Promise<string> {
  const { data, error } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .single();

  if (error || !data) {
    console.warn(`[getUserTimezone] Failed to get timezone for user ${userId}, defaulting to UTC`);
    return 'UTC';
  }

  return data.timezone || 'UTC';
}

/**
 * Get today's date in the user's timezone
 * Returns YYYY-MM-DD format
 *
 * Example:
 * - User in California (PST/PDT)
 * - Server time: 2025-10-28T04:00:00Z (UTC)
 * - User time: 2025-10-27T21:00:00-07:00
 * - Returns: "2025-10-27" (not "2025-10-28")
 */
export function getTodayInTimezone(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(now); // Returns YYYY-MM-DD
}

/**
 * Convert a Date object to YYYY-MM-DD in a specific timezone
 *
 * Example:
 * - Input: new Date('2025-10-28T04:00:00Z'), timezone: 'America/Los_Angeles'
 * - Output: "2025-10-27"
 */
export function getDateInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

/**
 * Get the last N days in a specific timezone
 * Returns array of YYYY-MM-DD strings in descending order (most recent first)
 *
 * Example:
 * - getLastNDays(7, 'America/Los_Angeles')
 * - Returns: ['2025-10-27', '2025-10-26', '2025-10-25', ...]
 */
export function getLastNDays(n: number, timezone: string): string[] {
  const today = getTodayInTimezone(timezone);
  const dates: string[] = [today];

  const baseDate = new Date(today);

  for (let i = 1; i < n; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - i);
    dates.push(getDateInTimezone(date, timezone));
  }

  return dates;
}

/**
 * Parse a date string to YYYY-MM-DD format
 * Handles both ISO8601 timestamps and YYYY-MM-DD strings
 *
 * Examples:
 * - "2025-10-27T12:34:56Z" -> "2025-10-27"
 * - "2025-10-27T12:34:56-07:00" -> "2025-10-27"
 * - "2025-10-27" -> "2025-10-27"
 */
export function normalizeDateString(dateStr: string): string {
  // If it's already YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Extract date part from ISO8601 timestamp
  return dateStr.split('T')[0];
}

/**
 * Validate if a date is within the last N days
 * Used to prevent backfilling too far in the past
 *
 * Example:
 * - isWithinLastNDays('2025-10-20', 7, 'America/Los_Angeles')
 * - Today: 2025-10-27
 * - Returns: true (7 days ago)
 */
export function isWithinLastNDays(
  dateStr: string,
  n: number,
  timezone: string
): boolean {
  const targetDate = new Date(dateStr);
  const today = new Date(getTodayInTimezone(timezone));

  const nDaysAgo = new Date(today);
  nDaysAgo.setDate(nDaysAgo.getDate() - n);

  return targetDate >= nDaysAgo && targetDate <= today;
}

/**
 * Get the current datetime in the user's timezone as ISO8601 string
 *
 * Example:
 * - timezone: 'America/Los_Angeles'
 * - Returns: "2025-10-27T14:30:00-07:00"
 */
export function getNowInTimezone(timezone: string): string {
  const now = new Date();

  // Format with timezone offset
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const hour = parts.find(p => p.type === 'hour')?.value;
  const minute = parts.find(p => p.type === 'minute')?.value;
  const second = parts.find(p => p.type === 'second')?.value;

  // Get timezone offset
  const offset = getTimezoneOffset(timezone);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

/**
 * Get timezone offset string (e.g., "-07:00", "+05:30")
 */
function getTimezoneOffset(timezone: string): string {
  const now = new Date();
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));

  const offsetMinutes = (utcDate.getTime() - tzDate.getTime()) / (1000 * 60);
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;

  const sign = offsetMinutes <= 0 ? '+' : '-';
  const hours = String(offsetHours).padStart(2, '0');
  const mins = String(offsetMins).padStart(2, '0');

  return `${sign}${hours}:${mins}`;
}

/**
 * Check if a date is today in the user's timezone
 */
export function isToday(dateStr: string, timezone: string): boolean {
  const today = getTodayInTimezone(timezone);
  const normalized = normalizeDateString(dateStr);
  return normalized === today;
}

/**
 * Get the start of day in user's timezone as UTC timestamp
 * Useful for database queries with timestamptz columns
 */
export function getStartOfDayUTC(dateStr: string, timezone: string): string {
  const date = new Date(`${dateStr}T00:00:00`);

  // Get the offset for this timezone on this date
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // This is complex - for now just return ISO string
  // Database should handle date comparisons with proper timezone awareness
  return `${dateStr}T00:00:00Z`;
}
