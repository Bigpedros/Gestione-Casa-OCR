import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let errorsCount = 0;
let warningsCount = 0;

export function error(msg) {
  console.error(`❌ ERROR: ${msg}`);
  errorsCount++;
}

export function success(msg) {
  console.log(`✅ OK: ${msg}`);
}

export function warn(msg) {
  console.warn(`⚠️ WARNING: ${msg}`);
  warningsCount++;
}

/**
 * Strictly verifies a PNG file on disk:
 * 1. Checks file existence
 * 2. Checks magic 8-byte PNG header (89 50 4E 47 0D 0A 1A 0A)
 * 3. Fully decodes the PNG data via pngjs (throws on corrupted chunks / truncated streams)
 * 4. Verifies exact dimensions and aspect ratio
 */
export function verifyPngFile(absPath, expectedW, expectedH, isSquareRequired = false) {
  if (!fs.existsSync(absPath)) {
    error(`File missing on disk: ${absPath}`);
    return false;
  }

  const buffer = fs.readFileSync(absPath);
  if (buffer.length < 8) {
    error(`File ${absPath} is too small (${buffer.length} bytes), invalid PNG.`);
    return false;
  }

  // 1. Signature Check
  const header = buffer.subarray(0, 8);
  if (!header.equals(PNG_SIGNATURE)) {
    const hex = header.toString('hex').toUpperCase();
    error(`File ${absPath} has invalid PNG signature! Expected "89504E470D0A1A0A", got "${hex}".`);
    return false;
  }

  // 2. Full Binary Decode Check
  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch (err) {
    error(`File ${absPath} failed PNG binary decoding: ${err.message}`);
    return false;
  }

  // 3. Dimension Check
  if (expectedW !== undefined && expectedH !== undefined) {
    if (png.width !== expectedW || png.height !== expectedH) {
      error(`File ${absPath} dimension mismatch! Expected ${expectedW}x${expectedH}, got ${png.width}x${png.height}`);
      return false;
    }
  }

  // 4. Square Check
  if (isSquareRequired && png.width !== png.height) {
    error(`File ${absPath} is not square! Dimensions: ${png.width}x${png.height}`);
    return false;
  }

  return { width: png.width, height: png.height, size: buffer.length };
}

export function runVerification({ checkDist = true } = {}) {
  errorsCount = 0;
  warningsCount = 0;

  console.log('--- STARTING STRICT PWA ASSET & MANIFEST VERIFICATION ---');

  // 1. Check manifest file existence
  const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    error(`Manifest file missing at ${manifestPath}`);
    return { success: false, errorsCount, warningsCount };
  }
  success('manifest.json exists');

  // 2. Validate JSON structure
  let manifest;
  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(content);
    success('manifest.json is valid JSON');
  } catch (e) {
    error(`manifest.json failed JSON parsing: ${e.message}`);
    return { success: false, errorsCount, warningsCount };
  }

  // 3. Required top-level fields
  const requiredFields = [
    'id',
    'name',
    'short_name',
    'description',
    'lang',
    'dir',
    'start_url',
    'scope',
    'display',
    'orientation',
    'background_color',
    'theme_color',
    'icons',
    'screenshots',
  ];

  requiredFields.forEach((field) => {
    if (!manifest[field]) {
      error(`Manifest missing required field: "${field}"`);
    } else {
      success(`Manifest contains required field "${field}"`);
    }
  });

  if (manifest.orientation !== 'portrait') {
    error(`Manifest "orientation" field must be "portrait", found: "${manifest.orientation}"`);
  } else {
    success('Manifest orientation is correctly set to "portrait"');
  }

  if (manifest.name !== 'Gestione Casa') {
    error(`Manifest name must be "Gestione Casa", found: "${manifest.name}"`);
  }

  // 4. Verify Icons
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    error('Manifest "icons" array is empty or invalid');
  } else {
    let has192Any = false;
    let has192Maskable = false;
    let has512Any = false;
    let has512Maskable = false;

    manifest.icons.forEach((icon, index) => {
      if (!icon.src || !icon.sizes || !icon.type) {
        error(`Icon entry at index ${index} missing src/sizes/type`);
        return;
      }

      const relPath = icon.src.startsWith('/') ? icon.src.slice(1) : icon.src;
      const absPath = path.join(PUBLIC_DIR, relPath);
      const [expectedW, expectedH] = icon.sizes.split('x').map(Number);

      const res = verifyPngFile(absPath, expectedW, expectedH, true);
      if (res) {
        success(`Icon ${icon.src} verified: ${res.width}x${res.height}, valid binary PNG (${res.size} bytes)`);
      }

      const purpose = icon.purpose || 'any';
      if (icon.sizes === '192x192' && purpose.includes('any')) has192Any = true;
      if (icon.sizes === '192x192' && purpose.includes('maskable')) has192Maskable = true;
      if (icon.sizes === '512x512' && purpose.includes('any')) has512Any = true;
      if (icon.sizes === '512x512' && purpose.includes('maskable')) has512Maskable = true;
    });

    if (!has192Any) error('Missing 192x192 icon with purpose "any"');
    if (!has192Maskable) error('Missing 192x192 icon with purpose "maskable"');
    if (!has512Any) error('Missing 512x512 icon with purpose "any"');
    if (!has512Maskable) error('Missing 512x512 icon with purpose "maskable"');
  }

  // 5. Verify Screenshots
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length === 0) {
    error('Manifest "screenshots" array is empty or invalid');
  } else {
    manifest.screenshots.forEach((sc, index) => {
      if (!sc.src || !sc.sizes || !sc.type || !sc.form_factor) {
        error(`Screenshot entry at index ${index} missing required fields`);
        return;
      }

      const relPath = sc.src.startsWith('/') ? sc.src.slice(1) : sc.src;
      const absPath = path.join(PUBLIC_DIR, relPath);
      const [expectedW, expectedH] = sc.sizes.split('x').map(Number);

      const res = verifyPngFile(absPath, expectedW, expectedH, false);
      if (res) {
        success(`Screenshot ${sc.src} verified: ${res.width}x${res.height} (${sc.form_factor}), valid binary PNG (${res.size} bytes)`);
      }
    });
  }

  // 6. Verify Shortcuts
  if (Array.isArray(manifest.shortcuts)) {
    manifest.shortcuts.forEach((sc) => {
      if (sc.icons) {
        sc.icons.forEach((icon) => {
          const relPath = icon.src.startsWith('/') ? icon.src.slice(1) : icon.src;
          const absPath = path.join(PUBLIC_DIR, relPath);
          const [expectedW, expectedH] = (icon.sizes || '192x192').split('x').map(Number);
          const res = verifyPngFile(absPath, expectedW, expectedH, true);
          if (res) {
            success(`Shortcut icon ${icon.src} verified: ${res.width}x${res.height}`);
          }
        });
      }
    });
  }

  // 7. Verify HTML Favicons & Apple Touch Icon
  const extraFiles = [
    { rel: 'favicon-16x16.png', w: 16, h: 16 },
    { rel: 'favicon-32x32.png', w: 32, h: 32 },
    { rel: 'icons/apple-touch-icon.png', w: 180, h: 180 },
  ];
  extraFiles.forEach(({ rel, w, h }) => {
    const absPath = path.join(PUBLIC_DIR, rel);
    const res = verifyPngFile(absPath, w, h, true);
    if (res) {
      success(`HTML PWA asset ${rel} verified: ${res.width}x${res.height}`);
    }
  });

  // 8. Verify dist/ if requested and directory exists
  if (checkDist && fs.existsSync(DIST_DIR)) {
    console.log('--- VERIFYING COPIED ASSETS IN dist/ ---');
    const distManifest = path.join(DIST_DIR, 'manifest.json');
    if (fs.existsSync(distManifest)) {
      success('dist/manifest.json exists');
    }

    const distFilesToCheck = [
      { rel: 'favicon-16x16.png', w: 16, h: 16 },
      { rel: 'favicon-32x32.png', w: 32, h: 32 },
      { rel: 'icons/icon-192.png', w: 192, h: 192 },
      { rel: 'icons/icon-512.png', w: 512, h: 512 },
      { rel: 'icons/icon-192-maskable.png', w: 192, h: 192 },
      { rel: 'icons/icon-512-maskable.png', w: 512, h: 512 },
      { rel: 'icons/apple-touch-icon.png', w: 180, h: 180 },
      { rel: 'screenshots/home-desktop.png', w: 1920, h: 1080 },
      { rel: 'screenshots/home-mobile.png', w: 1080, h: 1920 },
      { rel: 'screenshots/report-mobile.png', w: 1080, h: 1920 },
    ];

    distFilesToCheck.forEach(({ rel, w, h }) => {
      const absPath = path.join(DIST_DIR, rel);
      const res = verifyPngFile(absPath, w, h);
      if (res) {
        success(`dist/${rel} verified: ${res.width}x${res.height} (${res.size} bytes)`);
      }
    });
  }

  console.log('--------------------------------------------------');
  if (errorsCount > 0) {
    console.error(`❌ VERIFICATION FAILED with ${errorsCount} error(s) and ${warningsCount} warning(s).`);
    return { success: false, errorsCount, warningsCount };
  } else {
    console.log(`🎉 ALL PWA CHECKS PASSED STRICTLY! (${warningsCount} warning(s))`);
    return { success: true, errorsCount, warningsCount };
  }
}

// If executed directly from CLI
if (process.argv[1] && process.argv[1].endsWith('verify-pwa-assets.mjs')) {
  const result = runVerification({ checkDist: process.argv.includes('--dist') || fs.existsSync(DIST_DIR) });
  process.exit(result.success ? 0 : 1);
}

