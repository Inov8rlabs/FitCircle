'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface CircularProgressProps {
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  backgroundColor?: string;
  label?: string;
  sublabel?: string;
  icon?: LucideIcon;
  showValue?: boolean;
  animated?: boolean;
}

export function CircularProgress({
  value,
  max,
  size = 120,
  strokeWidth = 8,
  color = '#6366f1',
  backgroundColor = 'rgba(255, 255, 255, 0.1)',
  label,
  sublabel,
  icon: Icon,
  showValue = true,
  animated = true,
}: CircularProgressProps) {
  const percentage = Math.min((value / max) * 100, 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="transform -rotate-90"
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={backgroundColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress circle */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: animated ? offset : circumference }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          {Icon && (
            <Icon className="w-6 h-6 mb-1" style={{ color }} />
          )}
          {showValue && (
            <span className="text-xl font-bold leading-none" style={{ color }}>
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      </div>

      {label && (
        <div className="text-center">
          <p className="text-sm font-medium text-white">{label}</p>
          {sublabel && (
            <p className="text-xs text-gray-400">{sublabel}</p>
          )}
        </div>
      )}
    </div>
  );
}

interface ActivityRingProps {
  rings: {
    value: number;
    max: number;
    color: string;
    label?: string;
  }[];
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function ActivityRing({ rings, size = 160, strokeWidth = 12, className }: ActivityRingProps) {
  const center = size / 2;
  const gap = strokeWidth + 4;

  return (
    <div className={`relative ${className || ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {rings.map((ring, index) => {
          const radius = center - strokeWidth / 2 - gap * index;
          const circumference = 2 * Math.PI * radius;
          const percentage = Math.min((ring.value / ring.max) * 100, 100);
          const offset = circumference - (percentage / 100) * circumference;

          return (
            <g key={index}>
              {/* Background ring */}
              <circle
                cx={center}
                cy={center}
                r={radius}
                stroke="rgba(255, 255, 255, 0.1)"
                strokeWidth={strokeWidth}
                fill="none"
              />
              {/* Progress ring */}
              <motion.circle
                cx={center}
                cy={center}
                r={radius}
                stroke={ring.color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: offset }}
                transition={{ duration: 1, delay: index * 0.2, ease: 'easeOut' }}
              />
            </g>
          );
        })}
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center leading-none">
          <p className="text-2xl font-bold text-white leading-none mb-1">
            {Math.round((rings[0]?.value / rings[0]?.max) * 100 || 0)}%
          </p>
          <p className="text-xs text-gray-400 leading-none">Complete</p>
        </div>
      </div>
    </div>
  );
}

interface CircularSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  icon?: LucideIcon;
}

export function CircularSlider({
  value,
  onChange,
  min = 1,
  max = 5,
  size = 140,
  strokeWidth = 12,
  color = '#6366f1',
  label,
  icon: Icon,
}: CircularSliderProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const percentage = ((value - min) / (max - min)) * 100;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const updateValue = (clientX: number, clientY: number, element: Element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const x = clientX - centerX;
    const y = clientY - centerY;

    // Calculate angle from center (starting from top)
    let angle = Math.atan2(x, -y) * (180 / Math.PI);
    angle = (angle + 360) % 360;

    // Convert angle to value (0-360 degrees maps to min-max)
    const newValue = Math.round(min + (angle / 360) * (max - min));
    onChange(Math.min(max, Math.max(min, newValue)));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    updateValue(e.clientX, e.clientY, e.currentTarget);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      updateValue(e.clientX, e.clientY, e.currentTarget);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    setIsDragging(true);
    const touch = e.touches[0];
    updateValue(touch.clientX, touch.clientY, e.currentTarget);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isDragging && e.touches.length > 0) {
      const touch = e.touches[0];
      updateValue(touch.clientX, touch.clientY, e.currentTarget);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  React.useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    document.addEventListener('mouseup', handleGlobalMouseUp);
    document.addEventListener('touchend', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      document.removeEventListener('touchend', handleGlobalMouseUp);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative select-none touch-none"
        style={{ width: size, height: size }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <svg
          width={size}
          height={size}
          className="transform -rotate-90 cursor-pointer"
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: isDragging ? 'none' : 'stroke-dashoffset 0.3s ease' }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {Icon && (
            <div className="mb-2">
              <Icon className="w-8 h-8" style={{ color }} />
            </div>
          )}
          <div className="text-4xl font-bold text-white">{value}</div>
          <div className="text-xs text-gray-500 mt-1">out of {max}</div>
        </div>
      </div>

      {label && (
        <div className="text-center space-y-3">
          <p className="text-base font-semibold text-white">{label}</p>

          {/* Quick adjust buttons */}
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(Math.max(min, value - 1));
              }}
              className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 text-gray-300 hover:text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={value <= min}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(Math.min(max, value + 1));
              }}
              className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 text-gray-300 hover:text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={value >= max}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500">Tap buttons or drag circle</p>
        </div>
      )}
    </div>
  );
}
