// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The browser version's core, in a worker so a plate of reads doesn't freeze the window.
// Started by src/core/client.ts; the module is compiled on the first request and kept, and
// requests are answered one at a time, in the order they came.

import wasmUrl from "./seqcore.wasm?url";
import { CoreInstance, type CoreOp } from "./instance.ts";

export interface CoreRequest {
  id: number;
  op: CoreOp;
  body: string;
}

export type CoreReply = { id: number; body: string } | { id: number; error: string };

// Typed by hand: the DOM's types and a worker's don't fit in one program.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<CoreRequest>) => void) | null;
  postMessage(reply: CoreReply): void;
};

let core: Promise<CoreInstance> | null = null;
let queue: Promise<void> = Promise.resolve();

async function load(): Promise<CoreInstance> {
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error(`error ${res.status}`);
    bytes = await res.arrayBuffer();
  } catch (e) {
    throw new Error(`couldn't load the core (${e instanceof Error ? e.message : e})`);
  }
  return new CoreInstance(await WebAssembly.compile(bytes));
}

scope.onmessage = e => {
  const { id, op, body } = e.data;
  queue = queue.then(async () => {
    try {
      // A load that failed is tried again with the next request.
      const instance = await (core ??= load().catch(err => {
        core = null;
        throw err;
      }));
      scope.postMessage({ id, body: await instance.run(op, body) });
    } catch (err) {
      scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
