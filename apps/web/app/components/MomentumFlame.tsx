'use client';

import { motion } from 'framer-motion';

/**
 * Animated flame visual that scales with momentum level (1–5).
 *
 * Mirrors iOS `MomentumFlameView` and Android `MomentumFlameView`. Uses
 * Framer Motion for the pulse and a CSS-stacked teardrop SVG for the flame
 * layers. Emoji overlay keeps the visual clear at all sizes.
 */
export function MomentumFlame({
  level,
  size = 120,
}: {
  level: number;
  size?: number;
}) {
  const clamped = Math.min(5, Math.max(1, level));
  const colors = FLAME_COLORS[clamped];
  const pulseDuration = [2.0, 1.6, 1.2, 0.9, 0.7][clamped - 1] ?? 1.6;

  return (
    <motion.div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      animate={{ scale: [0.95, 1.1, 0.95] }}
      transition={{ duration: pulseDuration, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Outer glow */}
      <div
        className="absolute rounded-full"
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle, ${colors.primary}30, ${colors.primary}10, transparent 70%)`,
        }}
      />

      {/* Stacked flame layers */}
      {Array.from({ length: Math.min(clamped + 1, 4) }).map((_, i) => {
        const layerSize = size * 0.55 * (1 - i * 0.18);
        return (
          <div
            key={i}
            className="absolute"
            style={{
              width: layerSize,
              height: layerSize * 1.4,
              opacity: 1 - i * 0.2,
              background: `linear-gradient(to top, ${colors.secondary}, ${colors.primary})`,
              clipPath: TEARDROP_CLIP_PATH,
            }}
          />
        );
      })}

      {/* Emoji overlay */}
      <span
        className="relative z-10"
        style={{ fontSize: size * (0.27 + clamped * 0.03), filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.4))' }}
      >
        {clamped >= 5 ? '💙' : '🔥'}
      </span>
    </motion.div>
  );
}

const FLAME_COLORS: Record<number, { primary: string; secondary: string }> = {
  1: { primary: '#FFD700', secondary: '#FFA500' },
  2: { primary: '#FF8C00', secondary: '#FF6347' },
  3: { primary: '#FF4500', secondary: '#FF6347' },
  4: { primary: '#FF1493', secondary: '#FF4500' },
  5: { primary: '#1E90FF', secondary: '#87CEEB' },
};

/** Teardrop shape via CSS clip-path — flame silhouette. */
const TEARDROP_CLIP_PATH =
  'path("M50,0 C65,10 95,40 85,60 C80,85 65,100 50,100 C35,100 20,85 15,60 C5,40 35,10 50,0 Z")';
