#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Builds the core as WebAssembly for the browser version (crates/seqcore-wasm) and copies
// it to src/core/seqcore.wasm, where the worker imports it. `npm run build:wasm`, also run
// by `npm run build:web` and `npm run dev:web`; needs Node's --experimental-strip-types.
//
// Then checks what it built: fails above 512 KB, so a dependency that bloats it is
// noticed, and runs it in Node through src/core/instance.ts, the worker's own code: it
// must report a panic with its message, then answer the next requests and find pUC19's parts.

import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { CoreInstance } from "../src/core/instance.ts";

const LIMIT = 512 * 1024;
const at = p => fileURLToPath(new URL(`../${p}`, import.meta.url));
const crate = at("crates/seqcore-wasm/");
const built = `${crate}target/wasm32-unknown-unknown/release/seqcore_wasm.wasm`;
const copy = at("src/core/seqcore.wasm");

try {
  execFileSync("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown"], { cwd: crate, stdio: "inherit" });
} catch {
  console.error("\nBuilding the core as WebAssembly failed. If it says the target may not be installed:\n  rustup target add wasm32-unknown-unknown");
  process.exit(1);
}
copyFileSync(built, copy);

const bytes = readFileSync(copy);
const kb = n => `${Math.round(n / 1024)} KB`;
const size = `${kb(bytes.length)} (${kb(gzipSync(bytes).length)} gzipped)`;
if (statSync(copy).size > LIMIT) {
  console.error(`seqcore.wasm is ${size}, over the ${kb(LIMIT)} limit. Did a dependency make it bigger?`);
  process.exit(1);
}

const fail = message => {
  console.error(`seqcore.wasm doesn't work: ${message}`);
  process.exit(1);
};
const core = new CoreInstance(await WebAssembly.compile(bytes));
const genbank = readFileSync(at("testdata/e2e/pUC19-annotated.gb"), "utf8");
const pUC19 = genbank.slice(genbank.indexOf("\nORIGIN") + 7).replace(/[^acgt]/gi, "").toUpperCase();
const detect = async () => JSON.parse(await core.run("detect", JSON.stringify({ sequence: pUC19, circular: true, existing: [] })));
const names = r => (r.suggestions ?? []).map(s => s.name);

// A panic first, so it is a fresh instance's first call, then requests on the next one.
const trapped = await core.run("trap").then(() => "no error", e => e.message);
if (!/capacity overflow/.test(trapped)) fail(`a panic wasn't reported with its message (${trapped})`);
if (!(await core.run("catalogVersion"))) fail("it has no catalog version");
const found = names(await detect());
if (!found.includes("ori") || !found.includes("AmpR")) fail(`pUC19's ori and AmpR weren't found (${found.join(", ")})`);
console.log(`seqcore.wasm: ${size}; recovers from a panic and finds pUC19's parts`);
