/// <reference types="vite/client" />
/// <reference types="vitest/config" />
declare const __APP_VERSION__: string;
/** This build: its commit and that commit's time in seconds (vite.config.ts); 0 and "" when not built from git. */
declare const __BUILD__: { at: number; commit: string };
