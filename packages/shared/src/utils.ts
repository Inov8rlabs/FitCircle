/**
 * Shared utility functions for FitCircle
 */

import { addDays, differenceInDays, format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { ERROR_CODES } from './constants';
import type { ApiError, PaginationParams } from './types';

// Date utilities
export const formatDate = (date: Date | string, formatStr = 'yyyy-MM-dd'): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, formatStr);
};

export const getDaysBetween = (startDate: Date | string, endDate: Date | string): number => {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;
  return differenceInDays(end, start);
};

export const addDaysToDate = (date: Date | string, days: number): Date => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return addDays(dateObj, days);
};

export const getDateRange = (startDate: Date, endDate: Date) => {
  return {
    start: startOfDay(startDate),
    end: endOfDay(endDate),
  };
};

// Number utilities
export const calculatePercentage = (value: number, total: number): number => {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
};

export const roundTo = (value: number, decimals = 2): number => {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
};

export const formatWeight = (kg: number, units: 'metric' | 'imperial' = 'metric'): string => {
  if (units === 'imperial') {
    const lbs = kg * 2.20462;
    return `${roundTo(lbs, 1)} lbs`;
  }
  return `${roundTo(kg, 1)} kg`;
};

export const formatDistance = (km: number, units: 'metric' | 'imperial' = 'metric'): string => {
  if (units === 'imperial') {
    const miles = km * 0.621371;
    return `${roundTo(miles, 1)} mi`;
  }
  return `${roundTo(km, 1)} km`;
};

export const calculateBMI = (weightKg: number, heightCm: number): number => {
  const heightM = heightCm / 100;
  return roundTo(weightKg / (heightM * heightM), 1);
};

export const getBMICategory = (bmi: number): string => {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
};

// String utilities
export const generateId = (): string => {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

export const generateInviteCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
};

export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};

export const capitalize = (text: string): string => {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

// Array utilities
export const chunk = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

export const unique = <T>(array: T[]): T[] => {
  return Array.from(new Set(array));
};

export const groupBy = <T>(array: T[], key: keyof T): Record<string, T[]> => {
  return array.reduce((result, item) => {
    const group = String(item[key]);
    if (!result[group]) result[group] = [];
    result[group].push(item);
    return result;
  }, {} as Record<string, T[]>);
};

// Pagination utilities
export const getPaginationOffset = (params: PaginationParams): number => {
  const page = params.page || 1;
  const limit = params.limit || 20;
  return (page - 1) * limit;
};

export const getPaginationMeta = (
  total: number,
  page: number,
  limit: number
): {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  hasPrev: boolean;
} => {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
    hasPrev: page > 1,
  };
};

// Validation utilities
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidPhone = (phone: string): boolean => {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
};

export const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

export const isValidUsername = (username: string): boolean => {
  const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
  return usernameRegex.test(username);
};

// Error utilities
export const createApiError = (
  code: keyof typeof ERROR_CODES,
  message: string,
  details?: Record<string, any>
): ApiError => {
  return {
    code: ERROR_CODES[code],
    message,
    details,
    timestamp: new Date(),
  };
};

export const isApiError = (error: any): error is ApiError => {
  return (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    'timestamp' in error
  );
};

// Scoring utilities
export const calculateStreakBonus = (streakDays: number): number => {
  if (streakDays >= 30) return 50;
  if (streakDays >= 14) return 25;
  if (streakDays >= 7) return 15;
  if (streakDays >= 3) return 5;
  return 0;
};

export const calculateCompletionBonus = (completionRate: number): number => {
  if (completionRate >= 100) return 100;
  if (completionRate >= 90) return 50;
  if (completionRate >= 80) return 25;
  if (completionRate >= 70) return 10;
  return 0;
};

export const calculateRankingPoints = (rank: number): number => {
  switch (rank) {
    case 1:
      return 100;
    case 2:
      return 50;
    case 3:
      return 25;
    default:
      if (rank <= 10) return 10;
      return 0;
  }
};

// Health metrics utilities
export const calculateCalorieDeficit = (
  consumed: number,
  burned: number,
  bmr: number
): number => {
  return bmr + burned - consumed;
};

export const estimateBMR = (
  weightKg: number,
  heightCm: number,
  age: number,
  gender: 'male' | 'female'
): number => {
  // Mifflin-St Jeor Equation
  if (gender === 'male') {
    return 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  } else {
    return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  }
};

export const calculateWaterIntake = (weightKg: number, activityLevel: number): number => {
  // Base: 35ml per kg, adjusted for activity
  const base = weightKg * 35;
  const activityBonus = (activityLevel / 60) * 500; // 500ml per hour of activity
  return Math.round(base + activityBonus);
};

// Statistics utilities
export const calculateMean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
};

export const calculateMedian = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

export const calculateStandardDeviation = (values: number[]): number => {
  const mean = calculateMean(values);
  const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
  const variance = calculateMean(squaredDifferences);
  return Math.sqrt(variance);
};

// Time utilities
export const getTimeAgo = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  const seconds = Math.floor((new Date().getTime() - dateObj.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks ago`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)} months ago`;
  return `${Math.floor(seconds / 31536000)} years ago`;
};

export const getDurationString = (minutes: number): string => {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
};

// Currency utilities
export const formatCurrency = (
  amount: number,
  currency = 'USD',
  locale = 'en-US'
): string => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
};

// File utilities
export const getFileExtension = (filename: string): string => {
  return filename.split('.').pop()?.toLowerCase() || '';
};

export const isImageFile = (filename: string): boolean => {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
  return imageExtensions.includes(getFileExtension(filename));
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// Retry utility
export const retry = async <T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delay = 1000
): Promise<T> => {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }

  throw lastError!;
};

// Debounce utility
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;

  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Throttle utility
export const throttle = <T extends (...args: any[]) => any>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};