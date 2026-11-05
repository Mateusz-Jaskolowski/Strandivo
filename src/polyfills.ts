// Must be imported first: some file parsers were written for Node and expect these globals.
import { Buffer } from "buffer";

const g = globalThis as unknown as Record<string, unknown>;
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
if (!g.process) {
  g.process = {
    env: { NODE_ENV: import.meta.env.MODE },
    browser: true,
    version: "",
    versions: {},
    platform: "browser",
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args))
  };
}
