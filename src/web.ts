// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The browser version's entry, which index.html loads in place of src/main.ts when Vite
// runs with `--mode web` (`npm run dev:web`, `npm run build:web`): the same app, with the
// core in a worker for alignment and detection. Only this file imports the worker's
// client, so `npm run build`, which Tauri runs, never needs Rust's WebAssembly target.

import { useWebCore } from "./platform.ts";
import { webCore } from "./core/client.ts";

useWebCore(webCore);
void import("./main.ts").then(() =>
  // The worker and the core are fetched now, not when first used: a page left open across
  // a deployment would otherwise ask for files the new one no longer has. Once compiled,
  // the core is kept, even when it traps and starts again.
  webCore.catalogVersion().catch(() => undefined)
);
