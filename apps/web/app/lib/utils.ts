import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string | number, format: 'short' | 'long' | 'relative' = 'short'): string {
  const d = new Date(date);

  if (format === 'relative') {
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  if (format === 'long') {
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

export function formatWeight(weight: number, unit: 'kg' | 'lbs' = 'lbs'): string {
  if (unit === 'kg') {
    return `${weight.toFixed(1)} kg`;
  }
  return `${weight.toFixed(1)} lbs`;
}

export function calculateBMI(weight: number, height: number, unit: 'metric' | 'imperial' = 'imperial'): number {
  if (unit === 'metric') {
    // weight in kg, height in cm
    return weight / Math.pow(height / 100, 2);
  }
  // weight in lbs, height in inches
  return (weight / Math.pow(height, 2)) * 703;
}

export function getBMICategory(bmi: number): { category: string; color: string } {
  if (bmi < 18.5) return { category: 'Underweight', color: 'text-blue-500' };
  if (bmi < 25) return { category: 'Normal', color: 'text-green-500' };
  if (bmi < 30) return { category: 'Overweight', color: 'text-yellow-500' };
  return { category: 'Obese', color: 'text-red-500' };
}

export function calculateStreak(dates: Date[]): number {
  if (!dates.length) return 0;

  const sortedDates = dates
    .map(d => new Date(d).toDateString())
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  let streak = 0;
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) return 0;

  let currentDate = sortedDates[0] === today ? new Date() : new Date(Date.now() - 86400000);

  for (const dateStr of sortedDates) {
    if (dateStr === currentDate.toDateString()) {
      streak++;
      currentDate = new Date(currentDate.getTime() - 86400000);
    } else {
      break;
    }
  }

  return streak;
}

export function getAchievementIcon(type: string): string {
  const icons: Record<string, string> = {
    streak: '🔥',
    weight: '⚖️',
    challenge: '🏆',
    social: '👥',
    milestone: '🎯',
    special: '⭐',
  };
  return icons[type] || '🏅';
}

export function generateShareText(achievement: string, value?: string | number): string {
  const baseText = `I just unlocked "${achievement}" on FitCircle! 💪`;
  if (value) {
    return `${baseText} (${value})`;
  }
  return baseText;
}

export function isToday(date: Date | string): boolean {
  const d = new Date(date);
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

export function getDaysInCurrentMonth(): Date[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: Date[] = [];

  for (let d = firstDay; d <= lastDay; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  return days;
}

export function getWeekDays(): string[] {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

export function getProgressColor(percentage: number): string {
  if (percentage >= 80) return 'text-green-500';
  if (percentage >= 60) return 'text-yellow-500';
  if (percentage >= 40) return 'text-orange-500';
  return 'text-red-500';
}

export function calculateCaloriesBurned(weight: number, duration: number, intensity: 'low' | 'moderate' | 'high'): number {
  const metValues = { low: 3, moderate: 5, high: 8 };
  const met = metValues[intensity];
  // Calories = METs × weight in kg × time in hours
  const weightInKg = weight * 0.453592; // Convert lbs to kg
  const timeInHours = duration / 60;
  return Math.round(met * weightInKg * timeInHours);
}

export async function compressImage(file: File, maxWidth = 1200, maxHeight = 1200, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    img.onload = () => {
      let { width, height } = img;

      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;

      ctx?.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop';

  const width = window.innerWidth;
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function triggerHapticFeedback(type: 'light' | 'medium' | 'heavy' = 'light') {
  if ('vibrate' in navigator) {
    const patterns = {
      light: 10,
      medium: 20,
      heavy: 30,
    };
    navigator.vibrate(patterns[type]);
  }
}