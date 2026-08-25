import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const ICONS_DIR = path.join(PUBLIC_DIR, 'icons');
const SCREENSHOTS_DIR = path.join(PUBLIC_DIR, 'screenshots');

// Ensure directories exist
[PUBLIC_DIR, ICONS_DIR, SCREENSHOTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Color definitions (RGBA)
const COLOR_PRIMARY = [79, 70, 229, 255]; // #4F46E5 (indigo-600)
const COLOR_PRIMARY_DARK = [67, 56, 202, 255]; // #4338CA
const COLOR_WHITE = [255, 255, 255, 255];
const COLOR_ACCENT = [56, 189, 248, 255]; // #38BDF8 (sky-400)
const COLOR_BG_LIGHT = [248, 250, 252, 255]; // #F8FAFC
const COLOR_CARD_BG = [255, 255, 255, 255];
const COLOR_BORDER = [226, 232, 240, 255]; // #E2E8F0
const COLOR_TEXT_DARK = [15, 23, 42, 255]; // #0F172A
const COLOR_TEXT_MUTED = [100, 116, 139, 255]; // #64748B
const COLOR_GREEN = [16, 185, 129, 255]; // #10B981
const COLOR_RED = [244, 63, 94, 255]; // #F43F5E
const COLOR_AMBER = [245, 158, 11, 255]; // #F59E0B

function createPNG(width, height) {
  const png = new PNG({ width, height });
  png.data.fill(0);
  return png;
}

function setPixel(png, x, y, color) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
  const idx = (png.width * y + x) * 4;
  png.data[idx] = color[0];
  png.data[idx + 1] = color[1];
  png.data[idx + 2] = color[2];
  png.data[idx + 3] = color[3] !== undefined ? color[3] : 255;
}

function fillRect(png, startX, startY, width, height, color) {
  const x1 = Math.max(0, Math.floor(startX));
  const y1 = Math.max(0, Math.floor(startY));
  const x2 = Math.min(png.width, Math.ceil(startX + width));
  const y2 = Math.min(png.height, Math.ceil(startY + height));

  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      setPixel(png, x, y, color);
    }
  }
}

function drawRoundRect(png, startX, startY, width, height, radius, color) {
  const r = Math.min(radius, width / 2, height / 2);
  for (let y = Math.floor(startY); y < Math.ceil(startY + height); y++) {
    for (let x = Math.floor(startX); x < Math.ceil(startX + width); x++) {
      // Check corners
      let inside = true;
      if (x < startX + r && y < startY + r) {
        const dx = x - (startX + r);
        const dy = y - (startY + r);
        if (dx * dx + dy * dy > r * r) inside = false;
      } else if (x >= startX + width - r && y < startY + r) {
        const dx = x - (startX + width - r);
        const dy = y - (startY + r);
        if (dx * dx + dy * dy > r * r) inside = false;
      } else if (x < startX + r && y >= startY + height - r) {
        const dx = x - (startX + r);
        const dy = y - (startY + height - r);
        if (dx * dx + dy * dy > r * r) inside = false;
      } else if (x >= startX + width - r && y >= startY + height - r) {
        const dx = x - (startX + width - r);
        const dy = y - (startY + height - r);
        if (dx * dx + dy * dy > r * r) inside = false;
      }
      if (inside) {
        setPixel(png, x, y, color);
      }
    }
  }
}

function fillCircle(png, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        setPixel(png, x, y, color);
      }
    }
  }
}

function fillTriangle(png, x1, y1, x2, y2, x3, y3, color) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2, x3)));
  const maxX = Math.min(png.width - 1, Math.ceil(Math.max(x1, x2, x3)));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
  const maxY = Math.min(png.height - 1, Math.ceil(Math.max(y1, y2, y3)));

  function sign(px, py, ax, ay, bx, by) {
    return (px - bx) * (ay - by) - (ax - bx) * (py - by);
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d1 = sign(x, y, x1, y1, x2, y2);
      const d2 = sign(x, y, x2, y2, x3, y3);
      const d3 = sign(x, y, x3, y3, x1, y1);

      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;

      if (!(hasNeg && hasPos)) {
        setPixel(png, x, y, color);
      }
    }
  }
}

function drawThickLine(png, x0, y0, x1, y1, thickness, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const steps = Math.ceil(len * 2);
  const radius = thickness / 2;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    fillCircle(png, cx, cy, radius, color);
  }
}

function savePNG(png, filePath) {
  const buffer = PNG.sync.write(png);
  fs.writeFileSync(filePath, buffer);
  console.log(`Generated: ${path.relative(ROOT_DIR, filePath)} (${png.width}x${png.height})`);
}

// -------------------------------------------------------------
// House Icon Drawing Function
// -------------------------------------------------------------
function drawHouseIcon(size, isMaskable = false) {
  const png = createPNG(size, size);
  const radius = isMaskable ? 0 : size * 0.22;

  // Background
  drawRoundRect(png, 0, 0, size, size, radius, COLOR_PRIMARY);

  // Safe area padding for house
  const scale = isMaskable ? 0.65 : 0.72;
  const houseWidth = size * scale;
  const centerX = size / 2;
  const centerY = size / 2 + size * 0.04;

  // House Dimensions
  const roofTopY = centerY - houseWidth * 0.42;
  const roofLeftX = centerX - houseWidth * 0.45;
  const roofRightX = centerX + houseWidth * 0.45;
  const roofBottomY = centerY - houseWidth * 0.05;

  const wallLeftX = centerX - houseWidth * 0.35;
  const wallRightX = centerX + houseWidth * 0.35;
  const wallTopY = roofBottomY;
  const wallBottomY = centerY + houseWidth * 0.42;

  // Chimney with Sky Blue accent
  const chimneyLeft = centerX + houseWidth * 0.18;
  const chimneyRight = centerX + houseWidth * 0.28;
  const chimneyTop = roofTopY + houseWidth * 0.08;
  const chimneyBottom = roofBottomY;
  fillRect(png, chimneyLeft, chimneyTop, chimneyRight - chimneyLeft, chimneyBottom - chimneyTop, COLOR_ACCENT);

  // Roof triangle
  fillTriangle(png, centerX, roofTopY, roofLeftX, roofBottomY, roofRightX, roofBottomY, COLOR_WHITE);

  // Roof overhang line / thickness
  drawThickLine(png, centerX, roofTopY, roofLeftX, roofBottomY, size * 0.035, COLOR_WHITE);
  drawThickLine(png, centerX, roofTopY, roofRightX, roofBottomY, size * 0.035, COLOR_WHITE);

  // House body
  drawRoundRect(png, wallLeftX, wallTopY, wallRightX - wallLeftX, wallBottomY - wallTopY, size * 0.02, COLOR_WHITE);

  // Door (Indigo-600 cutout look)
  const doorW = houseWidth * 0.2;
  const doorH = houseWidth * 0.32;
  const doorX = centerX - doorW / 2;
  const doorY = wallBottomY - doorH;
  drawRoundRect(png, doorX, doorY, doorW, doorH, size * 0.02, COLOR_PRIMARY);

  // Window (Sky blue accent)
  const windowSize = houseWidth * 0.18;
  const windowX = centerX - windowSize / 2;
  const windowY = wallTopY + houseWidth * 0.08;
  drawRoundRect(png, windowX, windowY, windowSize, windowSize, size * 0.015, COLOR_ACCENT);

  return png;
}

// -------------------------------------------------------------
// Shortcut Icons Drawing Functions
// -------------------------------------------------------------
function drawShortcutIcon(type, size = 192) {
  const png = createPNG(size, size);
  drawRoundRect(png, 0, 0, size, size, size * 0.22, COLOR_PRIMARY);

  const cx = size / 2;
  const cy = size / 2;

  if (type === 'income') {
    // Green circle with white plus / upward arrow
    fillCircle(png, cx, cy, size * 0.32, COLOR_GREEN);
    drawThickLine(png, cx, cy + size * 0.18, cx, cy - size * 0.18, size * 0.06, COLOR_WHITE);
    drawThickLine(png, cx - size * 0.18, cy, cx + size * 0.18, cy, size * 0.06, COLOR_WHITE);
  } else if (type === 'expense') {
    // Red circle with white minus / downward arrow
    fillCircle(png, cx, cy, size * 0.32, COLOR_RED);
    drawThickLine(png, cx - size * 0.18, cy, cx + size * 0.18, cy, size * 0.06, COLOR_WHITE);
  } else if (type === 'report') {
    // Indigo-dark circle with white bar chart
    fillCircle(png, cx, cy, size * 0.32, COLOR_PRIMARY_DARK);
    // Bar 1
    fillRect(png, cx - size * 0.18, cy + size * 0.05, size * 0.08, size * 0.12, COLOR_WHITE);
    // Bar 2
    fillRect(png, cx - size * 0.04, cy - size * 0.08, size * 0.08, size * 0.25, COLOR_WHITE);
    // Bar 3
    fillRect(png, cx + size * 0.1, cy - size * 0.18, size * 0.08, size * 0.35, COLOR_ACCENT);
  }

  return png;
}

// -------------------------------------------------------------
// Screenshot Generators
// -------------------------------------------------------------
function generateMobileHomeScreenshot() {
  const w = 1080;
  const h = 1920;
  const png = createPNG(w, h);

  // Background
  fillRect(png, 0, 0, w, h, COLOR_BG_LIGHT);

  // Top Bar (Header)
  fillRect(png, 0, 0, w, 160, COLOR_PRIMARY);
  // Header text mock bar
  drawRoundRect(png, 60, 60, 420, 40, 8, COLOR_WHITE);
  fillCircle(png, w - 90, 80, 28, COLOR_WHITE);

  // Hero Budget Card
  const cardMargin = 48;
  const cardY = 200;
  const cardW = w - cardMargin * 2;
  drawRoundRect(png, cardMargin, cardY, cardW, 460, 24, COLOR_CARD_BG);
  // Card title
  fillRect(png, cardMargin + 48, cardY + 48, 320, 24, COLOR_TEXT_MUTED);
  // Balance Big Amount
  fillRect(png, cardMargin + 48, cardY + 96, 480, 64, COLOR_PRIMARY);

  // Sub-metrics row in card
  const colW = (cardW - 120) / 2;
  // Income metric box
  drawRoundRect(png, cardMargin + 36, cardY + 200, colW, 200, 16, COLOR_BG_LIGHT);
  fillRect(png, cardMargin + 64, cardY + 230, 180, 20, COLOR_TEXT_MUTED);
  fillRect(png, cardMargin + 64, cardY + 270, 260, 40, COLOR_GREEN);

  // Expense metric box
  drawRoundRect(png, cardMargin + 48 + colW, cardY + 200, colW, 200, 16, COLOR_BG_LIGHT);
  fillRect(png, cardMargin + 76 + colW, cardY + 230, 180, 20, COLOR_TEXT_MUTED);
  fillRect(png, cardMargin + 76 + colW, cardY + 270, 260, 40, COLOR_RED);

  // Section Title: Movimenti Recenti
  fillRect(png, cardMargin, 700, 360, 32, COLOR_TEXT_DARK);
  fillRect(png, w - cardMargin - 200, 700, 200, 24, COLOR_PRIMARY);

  // List Items
  let listY = 770;
  const items = [
    { titleW: 380, subW: 220, valW: 180, color: COLOR_RED },
    { titleW: 420, subW: 260, valW: 220, color: COLOR_GREEN },
    { titleW: 320, subW: 180, valW: 160, color: COLOR_RED },
    { titleW: 450, subW: 240, valW: 200, color: COLOR_RED },
    { titleW: 360, subW: 200, valW: 190, color: COLOR_GREEN },
    { titleW: 400, subW: 210, valW: 170, color: COLOR_RED },
  ];

  items.forEach((item) => {
    drawRoundRect(png, cardMargin, listY, cardW, 140, 20, COLOR_CARD_BG);
    fillCircle(png, cardMargin + 60, listY + 70, 32, item.color);
    fillRect(png, cardMargin + 120, listY + 38, item.titleW, 24, COLOR_TEXT_DARK);
    fillRect(png, cardMargin + 120, listY + 78, item.subW, 18, COLOR_TEXT_MUTED);
    fillRect(png, cardMargin + cardW - item.valW - 40, listY + 54, item.valW, 32, item.color);
    listY += 160;
  });

  // Bottom Navigation Bar
  fillRect(png, 0, h - 180, w, 180, COLOR_CARD_BG);
  fillRect(png, 0, h - 180, w, 4, COLOR_BORDER);
  const navStep = w / 4;
  for (let i = 0; i < 4; i++) {
    const navX = navStep * i + navStep / 2;
    fillCircle(png, navX, h - 105, 24, i === 0 ? COLOR_PRIMARY : COLOR_TEXT_MUTED);
    fillRect(png, navX - 40, h - 60, 80, 16, i === 0 ? COLOR_PRIMARY : COLOR_TEXT_MUTED);
  }

  return png;
}

function generateMobileReportScreenshot() {
  const w = 1080;
  const h = 1920;
  const png = createPNG(w, h);

  fillRect(png, 0, 0, w, h, COLOR_BG_LIGHT);

  // Header
  fillRect(png, 0, 0, w, 160, COLOR_PRIMARY);
  fillRect(png, 60, 60, 480, 40, COLOR_WHITE);

  const cardMargin = 48;

  // Month Selector Card
  drawRoundRect(png, cardMargin, 200, w - cardMargin * 2, 120, 20, COLOR_CARD_BG);
  fillRect(png, cardMargin + 40, 240, 360, 32, COLOR_TEXT_DARK);
  fillRect(png, w - cardMargin - 200, 240, 160, 32, COLOR_PRIMARY);

  // Chart Card
  const chartY = 350;
  const chartH = 600;
  const cardW = w - cardMargin * 2;
  drawRoundRect(png, cardMargin, chartY, cardW, chartH, 24, COLOR_CARD_BG);
  fillRect(png, cardMargin + 40, chartY + 40, 380, 28, COLOR_TEXT_DARK);

  // Bar Chart Mock
  const bars = [
    { label: 'Abitazione', val: 0.85, color: COLOR_PRIMARY },
    { label: 'Spesa', val: 0.65, color: COLOR_ACCENT },
    { label: 'Utilità', val: 0.45, color: COLOR_AMBER },
    { label: 'Trasporti', val: 0.30, color: COLOR_GREEN },
    { label: 'Svago', val: 0.20, color: COLOR_RED },
  ];

  let barY = chartY + 110;
  bars.forEach((b) => {
    fillRect(png, cardMargin + 40, barY, 200, 20, COLOR_TEXT_MUTED);
    drawRoundRect(png, cardMargin + 40, barY + 28, cardW - 80, 24, 12, COLOR_BG_LIGHT);
    const fillW = (cardW - 80) * b.val;
    drawRoundRect(png, cardMargin + 40, barY + 28, fillW, 24, 12, b.color);
    barY += 92;
  });

  // Summary Grid Card
  const gridY = 980;
  drawRoundRect(png, cardMargin, gridY, cardW, 400, 24, COLOR_CARD_BG);
  fillRect(png, cardMargin + 40, gridY + 40, 420, 28, COLOR_TEXT_DARK);

  // Grid tiles
  const tileW = (cardW - 120) / 2;
  drawRoundRect(png, cardMargin + 40, gridY + 90, tileW, 120, 16, COLOR_BG_LIGHT);
  fillRect(png, cardMargin + 60, gridY + 110, 160, 18, COLOR_TEXT_MUTED);
  fillRect(png, cardMargin + 60, gridY + 140, 200, 32, COLOR_GREEN);

  drawRoundRect(png, cardMargin + 80 + tileW, gridY + 90, tileW, 120, 16, COLOR_BG_LIGHT);
  fillRect(png, cardMargin + 100 + tileW, gridY + 110, 160, 18, COLOR_TEXT_MUTED);
  fillRect(png, cardMargin + 100 + tileW, gridY + 140, 200, 32, COLOR_RED);

  drawRoundRect(png, cardMargin + 40, gridY + 230, tileW, 120, 16, COLOR_BG_LIGHT);
  fillRect(png, cardMargin + 60, gridY + 250, 160, 18, COLOR_TEXT_MUTED);
  fillRect(png, cardMargin + 60, gridY + 280, 200, 32, COLOR_PRIMARY);

  drawRoundRect(png, cardMargin + 80 + tileW, gridY + 230, tileW, 120, 16, COLOR_BG_LIGHT);
  fillRect(png, cardMargin + 100 + tileW, gridY + 250, 160, 18, COLOR_TEXT_MUTED);
  fillRect(png, cardMargin + 100 + tileW, gridY + 280, 200, 32, COLOR_AMBER);

  // Bottom Nav Bar
  fillRect(png, 0, h - 180, w, 180, COLOR_CARD_BG);
  fillRect(png, 0, h - 180, w, 4, COLOR_BORDER);
  const navStep = w / 4;
  for (let i = 0; i < 4; i++) {
    const navX = navStep * i + navStep / 2;
    fillCircle(png, navX, h - 105, 24, i === 3 ? COLOR_PRIMARY : COLOR_TEXT_MUTED);
    fillRect(png, navX - 40, h - 60, 80, 16, i === 3 ? COLOR_PRIMARY : COLOR_TEXT_MUTED);
  }

  return png;
}

function generateDesktopHomeScreenshot() {
  const w = 1920;
  const h = 1080;
  const png = createPNG(w, h);

  fillRect(png, 0, 0, w, h, COLOR_BG_LIGHT);

  // Sidebar
  const sidebarW = 320;
  fillRect(png, 0, 0, sidebarW, h, COLOR_CARD_BG);
  fillRect(png, sidebarW - 2, 0, 2, h, COLOR_BORDER);

  // Sidebar Logo
  drawRoundRect(png, 40, 40, 48, 48, 12, COLOR_PRIMARY);
  fillRect(png, 104, 52, 160, 24, COLOR_TEXT_DARK);

  // Sidebar Menu Items
  let navY = 140;
  for (let i = 0; i < 7; i++) {
    const isActive = i === 0;
    if (isActive) {
      drawRoundRect(png, 24, navY, sidebarW - 48, 56, 14, COLOR_PRIMARY);
      fillCircle(png, 56, navY + 28, 12, COLOR_WHITE);
      fillRect(png, 84, navY + 18, 140, 20, COLOR_WHITE);
    } else {
      fillCircle(png, 56, navY + 28, 12, COLOR_TEXT_MUTED);
      fillRect(png, 84, navY + 18, 140, 20, COLOR_TEXT_MUTED);
    }
    navY += 72;
  }

  // Header Bar
  const mainX = sidebarW;
  const mainW = w - sidebarW;
  fillRect(png, mainX, 0, mainW, 90, COLOR_CARD_BG);
  fillRect(png, mainX, 88, mainW, 2, COLOR_BORDER);

  fillRect(png, mainX + 48, 30, 280, 30, COLOR_TEXT_DARK);
  fillCircle(png, w - 80, 45, 22, COLOR_PRIMARY);

  // Main Dashboard Content Grid
  const gridPad = 48;
  const contentY = 130;

  // Stat Cards (3 across)
  const statW = (mainW - gridPad * 4) / 3;
  const statH = 180;

  // Stat 1: Saldo
  drawRoundRect(png, mainX + gridPad, contentY, statW, statH, 20, COLOR_CARD_BG);
  fillRect(png, mainX + gridPad + 30, contentY + 30, 140, 18, COLOR_TEXT_MUTED);
  fillRect(png, mainX + gridPad + 30, contentY + 65, 220, 40, COLOR_PRIMARY);

  // Stat 2: Entrate
  drawRoundRect(png, mainX + gridPad * 2 + statW, contentY, statW, statH, 20, COLOR_CARD_BG);
  fillRect(png, mainX + gridPad * 2 + statW + 30, contentY + 30, 140, 18, COLOR_TEXT_MUTED);
  fillRect(png, mainX + gridPad * 2 + statW + 30, contentY + 65, 220, 40, COLOR_GREEN);

  // Stat 3: Uscite
  drawRoundRect(png, mainX + gridPad * 3 + statW * 2, contentY, statW, statH, 20, COLOR_CARD_BG);
  fillRect(png, mainX + gridPad * 3 + statW * 2 + 30, contentY + 30, 140, 18, COLOR_TEXT_MUTED);
  fillRect(png, mainX + gridPad * 3 + statW * 2 + 30, contentY + 65, 220, 40, COLOR_RED);

  // Main Panels: Left (2/3 width) - Charts/Transactions, Right (1/3 width) - Fixed Expenses & Extra Budget
  const panelY = contentY + statH + 36;
  const leftW = (mainW - gridPad * 3) * 0.62;
  const rightW = (mainW - gridPad * 3) * 0.38;
  const panelH = h - panelY - gridPad;

  // Left Panel
  drawRoundRect(png, mainX + gridPad, panelY, leftW, panelH, 20, COLOR_CARD_BG);
  fillRect(png, mainX + gridPad + 36, panelY + 36, 260, 24, COLOR_TEXT_DARK);

  let rowY = panelY + 90;
  for (let i = 0; i < 5; i++) {
    drawRoundRect(png, mainX + gridPad + 30, rowY, leftW - 60, 80, 14, COLOR_BG_LIGHT);
    fillCircle(png, mainX + gridPad + 60, rowY + 40, 18, i % 2 === 0 ? COLOR_RED : COLOR_GREEN);
    fillRect(png, mainX + gridPad + 100, rowY + 22, 280, 18, COLOR_TEXT_DARK);
    fillRect(png, mainX + gridPad + 100, rowY + 48, 180, 14, COLOR_TEXT_MUTED);
    fillRect(png, mainX + gridPad + leftW - 220, rowY + 30, 160, 22, i % 2 === 0 ? COLOR_RED : COLOR_GREEN);
    rowY += 98;
  }

  // Right Panel
  drawRoundRect(png, mainX + gridPad * 2 + leftW, panelY, rightW, panelH, 20, COLOR_CARD_BG);
  fillRect(png, mainX + gridPad * 2 + leftW + 36, panelY + 36, 240, 24, COLOR_TEXT_DARK);

  let rightItemY = panelY + 90;
  for (let i = 0; i < 4; i++) {
    drawRoundRect(png, mainX + gridPad * 2 + leftW + 30, rightItemY, rightW - 60, 110, 14, COLOR_BG_LIGHT);
    fillRect(png, mainX + gridPad * 2 + leftW + 50, rightItemY + 20, 200, 16, COLOR_TEXT_DARK);
    fillRect(png, mainX + gridPad * 2 + leftW + 50, rightItemY + 46, 140, 14, COLOR_TEXT_MUTED);
    drawRoundRect(png, mainX + gridPad * 2 + leftW + 50, rightItemY + 76, rightW - 100, 12, 6, COLOR_BORDER);
    drawRoundRect(png, mainX + gridPad * 2 + leftW + 50, rightItemY + 76, (rightW - 100) * (0.4 + i * 0.15), 12, 6, COLOR_PRIMARY);
    rightItemY += 130;
  }

  return png;
}

// -------------------------------------------------------------
// MAIN EXECUTION
// -------------------------------------------------------------
async function run() {
  console.log('Generating PWA Icons, Favicons and Shortcuts...');

  // Standard PWA Icons
  const iconSizes = [72, 96, 128, 144, 152, 192, 384, 512];
  iconSizes.forEach((size) => {
    const png = drawHouseIcon(size, false);
    savePNG(png, path.join(ICONS_DIR, `icon-${size}.png`));
  });

  // Maskable Icons
  [192, 512].forEach((size) => {
    const png = drawHouseIcon(size, true);
    savePNG(png, path.join(ICONS_DIR, `icon-${size}-maskable.png`));
  });

  // Apple Touch Icon (180x180)
  const appleIcon = drawHouseIcon(180, false);
  savePNG(appleIcon, path.join(ICONS_DIR, 'apple-touch-icon.png'));

  // Favicons
  savePNG(drawHouseIcon(32, false), path.join(PUBLIC_DIR, 'favicon-32x32.png'));
  savePNG(drawHouseIcon(16, false), path.join(PUBLIC_DIR, 'favicon-16x16.png'));

  // Shortcut Icons
  savePNG(drawShortcutIcon('income', 192), path.join(ICONS_DIR, 'shortcut-income.png'));
  savePNG(drawShortcutIcon('expense', 192), path.join(ICONS_DIR, 'shortcut-expense.png'));
  savePNG(drawShortcutIcon('report', 192), path.join(ICONS_DIR, 'shortcut-report.png'));

  // Screenshots: Protected from synthetic overwrite.
  // Real screenshots must originate from DOM captures (e.g. Playwright/Puppeteer/browser export).
  console.log('ℹ️ Note: Screenshots in public/screenshots/ are preserved and not overwritten with synthetic drawings.');

  console.log('All PWA icon assets generated successfully!');
}

run().catch((err) => {
  console.error('Error generating PWA assets:', err);
  process.exit(1);
});
