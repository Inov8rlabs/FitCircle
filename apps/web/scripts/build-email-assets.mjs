#!/usr/bin/env node
/**
 * Email brand assets (docs/EMAIL_QUALITY.md "Brand in email").
 *
 *   node apps/web/scripts/build-email-assets.mjs
 *
 * Source: public/brand/fitcircle-icon-512.png — the app icon the iOS / Android
 * apps ship (copied from the AppIcon set; the website's <Logo> uses it too).
 * Output: public/email/fitcircle-icon-40@2x.png — 80×80 (shown at 40×40 in
 * email), corners rounded like the app icon and transparent outside, so it
 * looks the same in clients that ignore border-radius (Outlook desktop).
 * Served at https://www.fitcircle.ai/email/fitcircle-icon-40@2x.png.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../public/brand/fitcircle-icon-512.png');
const out = path.resolve(here, '../public/email/fitcircle-icon-40@2x.png');

const SIZE = 80;
const RADIUS = Math.round(SIZE * 0.225); // iOS-style rounded square
const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}"/></svg>`);

await sharp(src)
  .resize(SIZE, SIZE, { kernel: 'lanczos3' })
  .composite([{ input: mask, blend: 'dest-in' }])
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log('wrote', path.relative(process.cwd(), out));
