import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

let gitCommit: string | null = null;
try {
  gitCommit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
} catch {
  gitCommit = null;
}

const buildTimestamp = new Date().toISOString();
let appVersion = '1.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
  if (pkg.version) appVersion = pkg.version;
} catch {
  // fallback
}

const buildId = gitCommit ? `v${appVersion}-${gitCommit.slice(0, 7)}` : `build-${appVersion}-${buildTimestamp}`;

const appBuildInfo = {
  appVersion,
  buildId,
  gitCommit,
  buildTimestamp,
};

export default defineConfig({
  define: {
    __APP_BUILD_INFO__: JSON.stringify(appBuildInfo),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: [
        'favicon-16x16.png',
        'favicon-32x32.png',
        'icons/apple-touch-icon.png',
        'icons/*.png',
        'screenshots/*.png',
        'manifest.json',
        'robots.txt'
      ],
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,webp,woff2,json,webmanifest}'
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {}
  }
});
