// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const host = process.env.TAURI_DEV_HOST;

// `--mode web` builds the browser version (`npm run build:web`) into dist-web, starting
// from src/web.ts, which adds the core in a worker. Every other mode is the desktop's.
export default defineConfig(({ mode }) => {
  const web = mode === "web";
  return {
    // Tauri serves the built files from disk; relative paths keep that simple.
    base: "./",
    clearScreen: false,
    plugins: web ? [webEntry()] : [],
    // Cloudflare Pages' headers and 404 page, for the browser version only.
    publicDir: web ? "public-web" : false,
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // The browser version's usage statistics (src/platform.ts): the key, given only by the
      // workflow that deploys it (.github/workflows/web.yml), so every other build sends
      // nothing; and whether its events are Debug ones, as everything but a release's are.
      __USAGE_KEY__: JSON.stringify(web ? (process.env.APTABASE_APP_KEY ?? "") : ""),
      __USAGE_DEBUG__: JSON.stringify(process.env.STRANDIVO_RELEASE !== "1" || pkg.version.includes("-")),
      // A few file-parsing dependencies were written for Node and expect `global`.
      global: "globalThis"
    },
    resolve: {
      alias: {
        // Use the browser implementations of these Node built-ins (SnapGene .dna parser needs them).
        buffer: "buffer/",
        string_decoder: "string_decoder/"
      }
    },
    optimizeDeps: {
      esbuildOptions: {
        define: { global: "globalThis" }
      }
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
      watch: { ignored: ["**/src-tauri/**", "**/crates/**"] }
    },
    envPrefix: ["VITE_", "TAURI_ENV_"],
    build: {
      outDir: web ? "dist-web" : "dist",
      // macOS 11+ (Safari 14 WebKit) and WebView2 on Windows.
      target: ["es2020", "safari14"],
      chunkSizeWarningLimit: 10000,
      sourcemap: false
    }
  };
});

/** Loads src/web.ts instead of src/main.ts, so only the browser version holds the worker. */
function webEntry(): Plugin {
  const desktop = '<script type="module" src="/src/main.ts"></script>';
  return {
    name: "strandivo-web-entry",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!html.includes(desktop)) throw new Error("index.html no longer loads /src/main.ts as webEntry in vite.config.ts expects.");
        return html.replace(desktop, '<script type="module" src="/src/web.ts"></script>');
      }
    }
  };
}
