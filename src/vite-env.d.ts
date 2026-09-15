/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

declare const __APP_BUILD_INFO__: {
  appVersion: string;
  buildId: string;
  gitCommit: string | null;
  buildTimestamp: string;
} | undefined;
