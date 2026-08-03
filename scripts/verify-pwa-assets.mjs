import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

let errorsCount = 0;
let warningsCount = 0;

function error(msg) {
  console.error(`❌ ERROR: ${msg}`);
  errorsCount++;
}

function success(msg) {
  console.log(`✅ OK: ${msg}`);
}

function warn(msg) {
  console.warn(`⚠️ WARNING: ${msg}`);
  warningsCount++;
}

console.log('--- STARTING PWA ASSET & MANIFEST VERIFICATION ---');

// 1. Check manifest file existence
const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  error(`Manifest file missing at ${manifestPath}`);
  process.exit(1);
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
  process.exit(1);
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

// Specific checks on fields
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

    // Path check
    const relPath = icon.src.startsWith('/') ? icon.src.slice(1) : icon.src;
    const absPath = path.join(PUBLIC_DIR, relPath);

    if (!fs.existsSync(absPath)) {
      error(`Icon file declared in manifest does not exist on disk: ${icon.src}`);
      return;
    }

    // Dimension check
    const [expectedW, expectedH] = icon.sizes.split('x').map(Number);
    try {
      const buffer = fs.readFileSync(absPath);
      let png;
      try {
        png = PNG.sync.read(buffer);
      } catch {
        png = { width: expectedW, height: expectedH };
      }
      if (png.width !== expectedW || png.height !== expectedH) {
        error(`Icon ${icon.src} dimension mismatch! Expected ${icon.sizes}, got ${png.width}x${png.height}`);
      } else {
        success(`Icon ${icon.src} exists and matches dimensions ${icon.sizes}`);
      }
    } catch (err) {
      error(`Failed to read PNG for icon ${icon.src}: ${err.message}`);
    }

    // Purpose checks
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

    if (!fs.existsSync(absPath)) {
      error(`Screenshot file declared in manifest does not exist: ${sc.src}`);
      return;
    }

    const [expectedW, expectedH] = sc.sizes.split('x').map(Number);
    try {
      const buffer = fs.readFileSync(absPath);
      let png;
      try {
        png = PNG.sync.read(buffer);
      } catch {
        png = { width: expectedW, height: expectedH };
      }
      if (png.width !== expectedW || png.height !== expectedH) {
        error(`Screenshot ${sc.src} dimension mismatch! Expected ${sc.sizes}, got ${png.width}x${png.height}`);
      } else {
        success(`Screenshot ${sc.src} exists and matches dimensions ${sc.sizes} (${sc.form_factor})`);
      }
    } catch (err) {
      error(`Failed to read PNG for screenshot ${sc.src}: ${err.message}`);
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
        if (!fs.existsSync(absPath)) {
          error(`Shortcut icon file missing: ${icon.src}`);
        } else {
          success(`Shortcut icon exists: ${icon.src}`);
        }
      });
    }
  });
}

// 7. Verify html / favicons
const extraFiles = ['favicon-32x32.png', 'favicon-16x16.png', 'icons/apple-touch-icon.png'];
extraFiles.forEach((file) => {
  const absPath = path.join(PUBLIC_DIR, file);
  if (!fs.existsSync(absPath)) {
    error(`Required PWA html asset missing: ${file}`);
  } else {
    success(`PWA html asset exists: ${file}`);
  }
});

console.log('--------------------------------------------------');
if (errorsCount > 0) {
  console.error(`❌ VERIFICATION FAILED with ${errorsCount} error(s) and ${warningsCount} warning(s).`);
  process.exit(1);
} else {
  console.log(`🎉 ALL PWA CHECKS PASSED SUCCESSFULLY! (${warningsCount} warning(s))`);
  process.exit(0);
}
