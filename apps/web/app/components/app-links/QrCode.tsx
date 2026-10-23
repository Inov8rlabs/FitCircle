import QRCode from 'qrcode';

import { cn } from '@/lib/utils';

/**
 * Server-rendered QR code (inline SVG, no client JS, no layout shift).
 * Dark modules on a white tile so every phone camera reads it.
 */
export async function QrCode({ value, size = 168, className, label }: { value: string; size?: number; className?: string; label: string }) {
  const svg = await QRCode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#020617', light: '#ffffff' },
  });
  return (
    <div
      role="img"
      aria-label={label}
      data-testid="get-app-qr"
      data-qr-value={value}
      className={cn('overflow-hidden rounded-xl bg-white p-2.5 shadow-ios-md [&>svg]:h-full [&>svg]:w-full', className)}
      style={{ width: size, height: size }}
      // qrcode returns a self-contained <svg> built from our own URL.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
