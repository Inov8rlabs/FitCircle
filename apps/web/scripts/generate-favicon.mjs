import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const publicDir = join(__dirname, '..', 'public');
const appDir = join(__dirname, '..', 'app');
const svgPath = join(publicDir, 'icon.svg');

async function generateFavicon() {
  try {
    console.log('Generating favicon.ico...\n');

    // Generate favicon.ico (32x32) in public directory
    await sharp(svgPath)
      .resize(32, 32)
      .png()
      .toFile(join(publicDir, 'favicon.ico'));

    console.log('✓ Generated public/favicon.ico');

    // Also generate a 16x16 version
    await sharp(svgPath)
      .resize(16, 16)
      .png()
      .toFile(join(appDir, 'favicon.ico'));

    console.log('✓ Generated app/favicon.ico');

    console.log('\n✨ Favicon generated successfully!');
  } catch (error) {
    console.error('Error generating favicon:', error);
    process.exit(1);
  }
}

generateFavicon();
