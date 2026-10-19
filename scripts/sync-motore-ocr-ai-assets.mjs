import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const base = 'https://raw.githubusercontent.com/Bigpedros/PEI-Facile-2/8816d199be299544b0f2ceb8cca667c04382ba7c/public';
const assets = [
  ['recognizer-b/ocrs_wasm_bg.wasm', 2862930],
  ['models/text-detection.rten', 2510284],
  ['models/text-recognition.rten', 9716568],
];

for (const [relative, expectedSize] of assets) {
  const target = resolve('public', relative);
  try {
    const info = await stat(target);
    if (info.size === expectedSize) continue;
  } catch {}
  await mkdir(dirname(target), { recursive: true });
  const response = await fetch(`${base}/${relative}`);
  if (!response.ok) throw new Error(`OCR asset download failed ${response.status}: ${relative}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expectedSize) {
    throw new Error(`OCR asset size mismatch for ${relative}: ${bytes.byteLength} != ${expectedSize}`);
  }
  await writeFile(target, bytes);
  console.log(`[MOTORE-OCR-AI] installed ${relative} (${bytes.byteLength} bytes)`);
}
