// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The construct library: what the Home view shows about each file in the user's folders.
// Pure functions so they can be unit-tested with plain Node.

import { detectFromFeatures } from "./labinfo.ts";

export interface ConstructInfo {
  path: string;
  /** Bytes, and modification time in ms: a file is read again only when either changes. */
  size: number;
  modified: number;
  /** The sequence's own name (LOCUS), which may differ from the file name. */
  name: string;
  length: number;
  circular: boolean;
  features: number;
  /** What it carries, read off the features, e.g. "GFP · T7 promoter · KanR · pBR322 ori". */
  contents: string;
  description: string;
  /** Lab fields from the Info tab, which live in the file. */
  fields: Record<string, string>;
  /** `contents` was worked out by detection, because the file annotates nothing itself. */
  detected?: boolean;
  /** Which catalog that detection used, so the cache can tell when it has moved on. */
  catalogVersion?: string;
  /** Why the file couldn't be read. */
  error?: string;
}

interface NamedFeature {
  name?: string;
  type?: string;
}

// Names that say nothing about the construct.
const GENERIC = /^(new feature|feature|misc_feature|misc feature|source|region|cds|gene|orf|primer_bind|unnamed)$/i;

/**
 * The construct's main parts, read off its features: coding sequences first (usually the
 * insert), then resistance markers, origins and promoters. Each name once, at most `max`.
 */
export function describeContents(features: NamedFeature[], max = 5): string {
  const genes: string[] = [];
  const promoters: string[] = [];
  const markers: string[] = [];
  const origins: string[] = [];
  for (const f of features) {
    const name = (f.name || "").trim();
    if (!name || GENERIC.test(name)) continue;
    const type = (f.type || "").toLowerCase();
    const found = detectFromFeatures([{ name, type, start: 0, end: 0 }]);
    if (found.resistance.length) markers.push(name);
    else if (found.origins.length) origins.push(name);
    else if (found.promoters.length) promoters.push(name);
    else if (type === "cds" || type === "gene") genes.push(name);
  }
  const seen = new Set<string>();
  const parts = [...genes, ...markers, ...origins, ...promoters].filter(n => {
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const shown = parts.slice(0, max).join(" · ");
  return parts.length > max ? `${shown} · ${parts.length - max} more` : shown;
}

const parts = (path: string) => path.split(/[\\/]+/).filter(Boolean);

/** The subfolder of `root` that holds `path` ("" when it is directly in `root`). */
export function subfolder(path: string, root: string): string {
  const p = parts(path);
  const r = parts(root);
  const same = r.every((x, i) => p[i] === x);
  return same ? p.slice(r.length, -1).join("/") : "";
}

/** Whether a construct matches what was typed in the search field (every word must match). */
export function matchesSearch(info: ConstructInfo, note: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const file = parts(info.path).pop() || "";
  const text = [file, info.name, info.contents, info.description, note, ...Object.values(info.fields)].join("\n").toLowerCase();
  return words.every(w => text.includes(w));
}
