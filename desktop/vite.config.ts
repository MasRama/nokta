import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// The extension's pure `logic/` modules are shared: `@ext/...` is
// `extension/src/...`.
const extension = fileURLToPath(new URL('../extension/src', import.meta.url));

export default defineConfig({
    resolve: { alias: { '@ext': extension } },
    // Tauri's dev server address (tauri.conf.json `devUrl`).
    server: { port: 1420, strictPort: true, fs: { allow: ['..'] } },
    // WebView2 is evergreen Chromium.
    build: { target: 'chrome120', outDir: 'dist', emptyOutDir: true },
    clearScreen: false,
    test: { environment: 'happy-dom', include: ['tests/**/*.test.ts'] },
});
