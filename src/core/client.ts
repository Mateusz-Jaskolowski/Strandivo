// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The page's side of the core's worker (src/core/worker.ts): what src/platform.ts calls
// for alignment and detection in the browser version. Only src/web.ts imports this, so the
// desktop build never holds the worker or the module.

import type { WebCore } from "../platform.ts";
import type { CoreOp } from "./instance.ts";
import type { CoreReply, CoreRequest } from "./worker.ts";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve(text: string): void; reject(e: Error): void }>();

function start(): Worker {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<CoreReply>) => {
    const asked = pending.get(e.data.id);
    if (!asked) return;
    pending.delete(e.data.id);
    if ("error" in e.data) asked.reject(new Error(e.data.error));
    else asked.resolve(e.data.body);
  };
  // The worker's script itself failed (requests' own errors come as replies): what was
  // asked fails, and the next request starts a new worker.
  w.onerror = e => {
    e.preventDefault();
    w.terminate();
    if (worker === w) worker = null;
    for (const asked of pending.values()) asked.reject(new Error(`the core couldn't start (${e.message || "its worker failed"})`));
    pending.clear();
  };
  return w;
}

function ask(op: CoreOp, body = ""): Promise<string> {
  const w = (worker ??= start());
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, op, body } satisfies CoreRequest);
  });
}

/** Typed arrays must already be lists here, as for the desktop's shell. */
async function askJson<T>(op: "align" | "detect", request: unknown): Promise<T> {
  const answer = JSON.parse(await ask(op, JSON.stringify(request))) as T | { error?: unknown };
  if (answer && typeof answer === "object" && "error" in answer && typeof answer.error === "string") throw new Error(answer.error);
  return answer as T;
}

export const webCore: WebCore = {
  align: request => askJson("align", request),
  detect: request => askJson("detect", request),
  catalogVersion: () => ask("catalogVersion"),
  trap: async () => {
    await ask("trap");
  }
};
