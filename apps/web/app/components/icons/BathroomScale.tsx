/**
 * Custom Bathroom Scale Icon
 * Represents a digital bathroom scale for weight tracking
 */

import React from 'react';

interface BathroomScaleProps {
  className?: string;
  size?: number;
}

export const BathroomScale: React.FC<BathroomScaleProps> = ({
  className = '',
  size = 24
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Scale platform (rounded rectangle) */}
      <rect
        x="3"
        y="14"
        width="18"
        height="7"
        rx="1.5"
        ry="1.5"
      />

      {/* Digital display */}
      <rect
        x="7"
        y="16.5"
        width="10"
        height="2"
        rx="0.5"
        ry="0.5"
        fill="currentColor"
        opacity="0.2"
      />

      {/* Display numbers (decorative lines) */}
      <line x1="9" y1="17.5" x2="11" y2="17.5" strokeWidth="1.5" />
      <line x1="13" y1="17.5" x2="15" y2="17.5" strokeWidth="1.5" />

      {/* Person standing on scale (optional - simple representation) */}
      <circle cx="12" cy="7" r="2.5" strokeWidth="1.5" />
      <path d="M12 9.5 L12 13" strokeWidth="1.5" />
    </svg>
  );
};

export default BathroomScale;
