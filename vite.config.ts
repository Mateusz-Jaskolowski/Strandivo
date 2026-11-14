// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig, transformWithEsbuild, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { THEMES } from "./src/lib/themes.ts";

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
    plugins: web ? [themeBoot(), webEntry()] : [themeBoot()],
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

/**
 * Sets the theme before the first paint: src/themeBoot.ts as `theme.js`, a plain script in
 * <head>, which runs before anything is drawn, as the page's modules may not.
 * Vite bundles only modules, so it is built here, handed the themes' names.
 */
function themeBoot(): Plugin {
  const file = "theme.js";
  const build = async () => {
    const source = readFileSync(new URL("./src/themeBoot.ts", import.meta.url), "utf8");
    const out = await transformWithEsbuild(source, "themeBoot.ts", {
      format: "iife",
      define: { __THEMES__: JSON.stringify(THEMES) },
      target: ["es2020", "safari14"],
      minify: true
    });
    return out.code;
  };
  return {
    name: "strandivo-theme-boot",
    configureServer(server) {
      server.middlewares.use(`/${file}`, (_req, res, next) => {
        build().then(code => {
          res.setHeader("Content-Type", "text/javascript");
          res.end(code);
        }, next);
      });
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: file, source: await build() });
    },
    transformIndexHtml: () => [{ tag: "script", attrs: { src: `./${file}` }, injectTo: "head" }]
  };
}

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
