import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

/**
 * Design tokens mirror the iOS app (FitCircle-iOS DesignSystem/Theme/AppTheme.swift):
 * slate-950 canvas, slate-900/800 surfaces, white-alpha hairlines, violet
 * #8b5cf6 primary with the purple to pink gradient, SF type scale.
 */
const brand = {
  purple: '#8b5cf6',
  pink: '#ec4899',
  orange: '#f97316',
  indigo: '#6366f1',
  green: '#10b981',
  cyan: '#06b6d4',
  yellow: '#eab308',
  red: '#ef4444',
};

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        // SF on Apple devices (matches the app), Inter everywhere else.
        sans: ['-apple-system', 'BlinkMacSystemFont', 'var(--font-inter)', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      fontSize: {
        // iOS Dynamic Type sizes at the default content size (AppTheme.Typography).
        'large-title': ['34px', { lineHeight: '41px', fontWeight: '700', letterSpacing: '0.01em' }],
        title1: ['28px', { lineHeight: '34px', fontWeight: '700' }],
        title2: ['22px', { lineHeight: '28px', fontWeight: '600' }],
        title3: ['20px', { lineHeight: '25px', fontWeight: '600' }],
        headline: ['17px', { lineHeight: '22px', fontWeight: '600' }],
        body: ['17px', { lineHeight: '22px' }],
        callout: ['16px', { lineHeight: '21px' }],
        subhead: ['15px', { lineHeight: '20px' }],
        footnote: ['13px', { lineHeight: '18px' }],
        caption: ['12px', { lineHeight: '16px' }],
      },
      colors: {
        // Hard-coded `purple-*` classes across the app now resolve to the iOS
        // violet scale (purple-500 = #8b5cf6) instead of Tailwind's magenta purple.
        purple: colors.violet,
        // iOS secondary text is slate (#94a3b8), not Tailwind's neutral gray.
        gray: colors.slate,
        brand,
        canvas: '#020617',
        surface: {
          DEFAULT: '#0f172a',
          raised: '#1e293b',
        },
        fg: {
          primary: '#ffffff',
          secondary: '#94a3b8',
          tertiary: '#64748b',
        },
        hairline: 'rgba(255, 255, 255, 0.1)',
        glass: 'rgba(255, 255, 255, 0.12)',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
      },
      borderRadius: {
        // AppTheme.CornerRadius: sm 8 · md 12 · lg 16 · xl 24
        sm: '8px',
        md: '10px',
        lg: 'var(--radius)',
        xl: '16px',
        '2xl': '24px',
      },
      boxShadow: {
        'ios-sm': '0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2)',
        'ios-md': '0 4px 8px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
        'ios-lg': '0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)',
        glow: '0 8px 24px -6px rgba(139, 92, 246, 0.55)',
        'glow-pink': '0 8px 24px -6px rgba(236, 72, 153, 0.5)',
      },
      backgroundImage: {
        // AppTheme.Gradients
        'gradient-brand': `linear-gradient(135deg, ${brand.purple} 0%, ${brand.pink} 100%)`,
        'gradient-sunset': `linear-gradient(90deg, ${brand.orange} 0%, ${brand.pink} 50%, ${brand.purple} 100%)`,
        'gradient-indigo': `linear-gradient(90deg, ${brand.indigo} 0%, ${brand.purple} 100%)`,
        'gradient-green': `linear-gradient(135deg, ${brand.green} 0%, ${brand.cyan} 100%)`,
        'gradient-orange': `linear-gradient(135deg, ${brand.orange} 0%, #fb923c 100%)`,
        'hero-glow':
          'radial-gradient(60% 50% at 15% 0%, rgba(139, 92, 246, 0.22) 0%, transparent 70%), radial-gradient(50% 40% at 100% 10%, rgba(236, 72, 153, 0.14) 0%, transparent 70%), radial-gradient(60% 50% at 50% 100%, rgba(6, 182, 212, 0.10) 0%, transparent 70%)',
      },
      transitionTimingFunction: {
        ios: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '100%': {
            transform: 'translateX(100%)',
          },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'bounce-in': {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '50%': { transform: 'scale(1.05)' },
          '70%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 2s infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-down': 'slide-down 0.3s ease-out',
        'fade-in': 'fade-in 0.5s ease-out',
        'scale-in': 'scale-in 0.3s ease-out',
        'bounce-in': 'bounce-in 0.6s ease-out',
        pulse: 'pulse 2s infinite',
      },
      screens: {
        xs: '475px',
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
    },
  },
  plugins: [],
};

export default config;