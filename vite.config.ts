import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Tauri serves the built files from disk; relative paths keep that simple.
  base: "./",
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
    // macOS 11+ (Safari 14 WebKit) and WebView2 on Windows.
    target: ["es2020", "safari14"],
    chunkSizeWarningLimit: 10000,
    sourcemap: false
  }
});
