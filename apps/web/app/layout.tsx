import { Analytics } from '@vercel/analytics/next';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';

import { CookieConsentBanner } from '@/components/CookieConsentBanner';
import { OfflineIndicator } from '@/components/pwa/offline-indicator';
import { PWAInstall } from '@/components/pwa/pwa-install';

import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://www.fitcircle.ai'),
  title: {
    default: 'FitCircle: Fitness & Nutrition',
    template: '%s | FitCircle',
  },
  description:
    'Log meals with a photo, keep your streak alive, and stay accountable with friends in your FitCircle. AI nutrition, workouts, and circle chat in one app.',
  keywords: ['fitness', 'nutrition', 'food log', 'AI calorie counter', 'streaks', 'accountability', 'social fitness', 'health', 'wellness'],
  authors: [{ name: 'Inov8r Labs' }],
  creator: 'Inov8r Labs',
  publisher: 'Inov8r Labs',
  applicationName: 'FitCircle',
  generator: 'Next.js',
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://www.fitcircle.ai',
    siteName: 'FitCircle',
    title: 'FitCircle: Fitness & Nutrition',
    description:
      'Log meals with a photo, keep your streak alive, and stay accountable with friends in your FitCircle.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'FitCircle',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FitCircle: Fitness & Nutrition',
    description:
      'Log meals with a photo, keep your streak alive, and stay accountable with friends in your FitCircle.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/icon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-icon.png' },
      { url: '/icons/apple-icon-180x180.png', sizes: '180x180' },
    ],
    other: [
      {
        rel: 'mask-icon',
        url: '/icons/safari-pinned-tab.svg',
        color: '#8b5cf6',
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'FitCircle',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#0b0b1f',
    'msapplication-tap-highlight': 'no',
    'msapplication-TileImage': '/icons/ms-icon-144x144.png',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b1f' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  minimumScale: 1,
  userScalable: true,
  viewportFit: 'contain',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="FitCircle" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-config" content="/icons/browserconfig.xml" />
        <meta name="msapplication-TileColor" content="#0b0b1f" />
        <meta name="msapplication-tap-highlight" content="no" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              duration: 4000,
              style: {
                background: 'var(--background)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              },
            }}
          />
          <PWAInstall />
          <OfflineIndicator />
          <CookieConsentBanner />
          <Analytics />
        </Providers>
      </body>
    </html>
  );
}