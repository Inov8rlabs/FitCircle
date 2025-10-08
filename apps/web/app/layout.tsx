import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from 'sonner';
import { PWAInstall } from '@/components/pwa/pwa-install';
import { OfflineIndicator } from '@/components/pwa/offline-indicator';
import { Amplitude } from '@/lib/amplitude';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'FitCircle - Social Fitness Platform',
  description: 'Your social fitness companion for weight loss challenges and team motivation',
  keywords: ['fitness', 'weight loss', 'challenges', 'social fitness', 'health', 'wellness'],
  authors: [{ name: 'FitCircle Team' }],
  creator: 'FitCircle',
  publisher: 'FitCircle',
  applicationName: 'FitCircle',
  generator: 'Next.js',
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://fitcircle.app',
    siteName: 'FitCircle',
    title: 'FitCircle - Social Fitness Platform',
    description: 'Your social fitness companion for weight loss challenges and team motivation',
    images: [
      {
        url: 'https://fitcircle.app/og-image.png',
        width: 1200,
        height: 630,
        alt: 'FitCircle',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FitCircle - Social Fitness Platform',
    description: 'Your social fitness companion for weight loss challenges and team motivation',
    images: ['https://fitcircle.app/twitter-image.png'],
    creator: '@fitcircle',
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
      { url: '/icons/icon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/icon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-icon.png' },
      { url: '/icons/apple-icon-180x180.png', sizes: '180x180' },
    ],
    other: [
      {
        rel: 'mask-icon',
        url: '/icons/safari-pinned-tab.svg',
        color: '#22c55e',
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
    'msapplication-TileColor': '#22c55e',
    'msapplication-tap-highlight': 'no',
    'msapplication-TileImage': '/icons/ms-icon-144x144.png',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
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
        <meta name="msapplication-TileColor" content="#22c55e" />
        <meta name="msapplication-tap-highlight" content="no" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Amplitude />
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
        </Providers>
      </body>
    </html>
  );
}