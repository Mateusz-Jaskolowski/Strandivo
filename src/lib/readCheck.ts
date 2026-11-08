// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Keeping a check of reads: the reads of a sequence, how they are grouped into clones and
// the settings used, as the app remembers them per file and as a check file (.svcheck)
// saved next to the reads for sharing. A check file holds paths relative to itself, so
// the folder can be moved or sent as a whole. Pure, so it is unit-tested.

export const CHECK_EXTENSION = "svcheck";

/** A read and its clone: null when grouped as its name suggests, else a group the user made. */
export interface SavedRead {
  path: string;
  clone: string | null;
}

export interface ReadCheck {
  /** The sequence the reads were checked against. */
  reference: string;
  reads: SavedRead[];
  minQuality?: number;
  trimCutoff?: number;
}

/**
 * A browser's key (src/webFiles.ts) starts at `web:<id>` (a file, or a folder of Home's)
 * or `upload:<n>`, as a path starts at a drive: keys in one of Home's folders are relative
 * to each other like paths, and keys with different starts have nothing in common.
 */
const KEY = /^((?:web|upload):[^/]*)(.*)$/;
const isAbsolute = (p: string) => KEY.test(p) || /^([a-z][a-z0-9+.-]*:\/\/|\/|\\\\|[a-z]:[\\/])/i.test(p);
const nameOf = (p: string) => p.split(/[\\/]/).pop() || p;

/** Where a path starts (a key's start, scheme and host, drive, or "/") and its folders and file. */
function parts(p: string): { root: string; segments: string[] } {
  const key = p.match(KEY);
  if (key) return { root: key[1], segments: key[2].split("/").filter(Boolean) };
  const url = p.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i);
  if (url) return { root: url[1].toLowerCase(), segments: url[2].split("/").filter(Boolean) };
  const drive = p.match(/^([a-z]:)[\\/]?(.*)$/i);
  if (drive) return { root: drive[1].toUpperCase(), segments: drive[2].split(/[\\/]/).filter(Boolean) };
  return { root: p.startsWith("/") || p.startsWith("\\") ? "/" : "", segments: p.split(/[\\/]/).filter(Boolean) };
}

/**
 * `to` relative to the folder `fromDir`, written with "/"; `to` itself on another drive or
 * host. A browser's key from elsewhere is written as its name, as a key leads nowhere
 * outside the browser that made it: a check made there names files that sit beside it.
 */
export function relativePath(fromDir: string, to: string): string {
  const a = parts(fromDir);
  const b = parts(to);
  if (a.root !== b.root || !isAbsolute(to)) return KEY.test(to) ? nameOf(to) : to;
  // Windows paths compare without case.
  const same = (x: string, y: string) => (/^[A-Z]:$/.test(a.root) ? x.toLowerCase() === y.toLowerCase() : x === y);
  let common = 0;
  while (common < a.segments.length && common < b.segments.length - 1 && same(a.segments[common], b.segments[common])) common++;
  return [...Array<string>(a.segments.length - common).fill(".."), ...b.segments.slice(common)].join("/");
}

/** A path written relative to the folder `dir`, made whole with `dir`'s own separator. */
export function resolvePath(dir: string, path: string): string {
  if (isAbsolute(path) || !dir) return path;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const { root, segments } = parts(dir);
  const out = [...segments];
  for (const s of path.split(/[\\/]/)) {
    if (!s || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  const head = root === "/" ? sep : root.includes("://") ? `${root}/` : root ? root + sep : "";
  return head + out.join(sep);
}

const folderOf = (p: string) => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : i === 0 ? p.slice(0, 1) : "";
};

/**
 * Clone keys to save: a group the user made (any read in it was moved) gets a key of
 * its own for all its reads; groups made from names get null, so they are guessed again.
 */
export function savedClones(reads: { key: string; manual: boolean }[]): (string | null)[] {
  const manualKeys = new Set(reads.filter(r => r.manual).map(r => r.key));
  const names = new Map<string, string>();
  return reads.map(r => {
    if (!manualKeys.has(r.key)) return null;
    if (!names.has(r.key)) names.set(r.key, `#g${names.size + 1}`);
    return names.get(r.key)!;
  });
}

/** A check file's text, saved at `checkPath`. */
export function checkFileText(checkPath: string, check: ReadCheck): string {
  const dir = folderOf(checkPath);
  const out = {
    strandivo: "read check",
    version: 1,
    reference: relativePath(dir, check.reference),
    reads: check.reads.map(r => ({ path: relativePath(dir, r.path), clone: r.clone })),
    ...(check.minQuality !== undefined ? { minQuality: check.minQuality } : {}),
    ...(check.trimCutoff !== undefined ? { trimCutoff: check.trimCutoff } : {})
  };
  return JSON.stringify(out, null, 2) + "\n";
}

/** Reads a check file saved at `checkPath`; throws with a message for the user. */
export function parseCheckFile(text: string, checkPath: string): ReadCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("It isn't a Strandivo check file.");
  }
  const o = raw as { strandivo?: unknown; version?: unknown; reference?: unknown; reads?: unknown; minQuality?: unknown; trimCutoff?: unknown };
  if (!o || o.strandivo !== "read check" || typeof o.reference !== "string" || !Array.isArray(o.reads)) throw new Error("It isn't a Strandivo check file.");
  if (typeof o.version === "number" && o.version > 1) throw new Error("It was saved by a newer version of Strandivo.");
  const dir = folderOf(checkPath);
  const reads = o.reads.flatMap((r: unknown) => {
    const x = r as { path?: unknown; clone?: unknown };
    return typeof x?.path === "string" ? [{ path: resolvePath(dir, x.path), clone: typeof x.clone === "string" ? x.clone : null }] : [];
  });
  return {
    reference: resolvePath(dir, o.reference),
    reads,
    ...(typeof o.minQuality === "number" ? { minQuality: o.minQuality } : {}),
    ...(typeof o.trimCutoff === "number" ? { trimCutoff: o.trimCutoff } : {})
  };
}

/**
 * The check with each file it lists swapped for the picked file of the same name, if one
 * was picked: in a browser, a check's paths often lead nowhere, so its files are chosen.
 */
export function matchByName(check: ReadCheck, picked: string[]): ReadCheck {
  const find = (p: string) => {
    const name = nameOf(p);
    return picked.find(k => nameOf(k) === name) ?? picked.find(k => nameOf(k).toLowerCase() === name.toLowerCase()) ?? p;
  };
  return { ...check, reference: find(check.reference), reads: check.reads.map(r => ({ ...r, path: find(r.path) })) };
}
