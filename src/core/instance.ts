// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The core compiled to WebAssembly (crates/seqcore-wasm), as the browser version runs it:
// requests and answers are strings passed through the module's memory. No DOM, so the
// worker (src/core/worker.ts) and tools/build-wasm.mjs, in Node, run the same code.

/** What the module exports (crates/seqcore-wasm/src/lib.rs). Pointers are 32-bit. */
interface Exports {
  memory: WebAssembly.Memory;
  sv_alloc(len: number): number;
  sv_free(ptr: number, len: number): void;
  sv_align(ptr: number, len: number): number;
  sv_detect(ptr: number, len: number): number;
  sv_catalog_version(): number;
}

/** "trap" makes the core panic, so tests can check the next request still works. */
export type CoreOp = "align" | "detect" | "catalogVersion" | "trap";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Runs requests on an instance of the compiled module. A request that traps (a panic, or
 * memory running out) leaves the instance in no state to trust, so the next request gets
 * a fresh one; the failed one is rejected with the panic's message.
 */
export class CoreInstance {
  private readonly module: WebAssembly.Module;
  private exports: Exports | null = null;
  private panic = "";

  // No parameter property: Node, which runs this file for tools/build-wasm.mjs, only
  // strips types.
  constructor(module: WebAssembly.Module) {
    this.module = module;
  }

  /** The answer: JSON for align and detect (`{"error": …}` for a bad request), text for catalogVersion. */
  async run(op: CoreOp, request = ""): Promise<string> {
    const e = (this.exports ??= await this.start());
    this.panic = "";
    try {
      if (op === "catalogVersion") return this.take(e, e.sv_catalog_version());
      // Too big for 32-bit memory: Rust panics with "capacity overflow".
      if (op === "trap") e.sv_alloc(0xffffffff);
      const bytes = encoder.encode(request);
      const ptr = e.sv_alloc(bytes.length) >>> 0;
      new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
      const out = op === "align" ? e.sv_align(ptr, bytes.length) : e.sv_detect(ptr, bytes.length);
      e.sv_free(ptr, bytes.length);
      return this.take(e, out);
    } catch (err) {
      this.exports = null;
      throw new Error(`the core stopped unexpectedly (${this.panic || (err instanceof Error ? err.message : String(err))})`);
    }
  }

  private async start(): Promise<Exports> {
    let exports: Exports | null = null;
    const env = {
      // Called by the panic hook just before the module traps.
      sv_panic: (ptr: number, len: number) => {
        if (exports) this.panic = decoder.decode(new Uint8Array(exports.memory.buffer, ptr >>> 0, len >>> 0));
      }
    };
    const instance = await WebAssembly.instantiate(this.module, { env });
    exports = instance.exports as unknown as Exports;
    return exports;
  }

  /** Copies an answer out (its length, then its bytes) and frees it. */
  private take(e: Exports, out: number): string {
    const at = out >>> 0;
    const len = new DataView(e.memory.buffer).getUint32(at, true);
    const text = decoder.decode(new Uint8Array(e.memory.buffer, at + 4, len));
    e.sv_free(at, len + 4);
    return text;
  }
}
