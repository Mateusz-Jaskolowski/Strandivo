// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Plasmid information kept inside the file: lab fields ("Stored at", "Sequence verified",
// …) stored as a GenBank structured comment, plus what can be read off the features.
// Pure functions so they can be unit-tested with plain Node.

import type { Feature } from "./types.ts";

export const BLOCK_START = "##Strandivo-Data-START##";
export const BLOCK_END = "##Strandivo-Data-END##";

/** Ordered key → value pairs. Empty values are not stored. */
export type LabFields = [string, string][];

export interface ParsedComments {
  fields: LabFields;
  /** All other comment lines, untouched. */
  otherComments: string[];
}

const escapeValue = (v: string) => v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
const unescapeValue = (v: string) => v.replace(/\\(n|\\)/g, (_, c) => (c === "n" ? "\n" : "\\"));

/** Splits GenBank COMMENT lines into our structured block and everything else. */
export function parseComments(comments: string[] | undefined): ParsedComments {
  const fields: LabFields = [];
  const otherComments: string[] = [];
  let inBlock = false;
  for (const raw of comments || []) {
    const line = String(raw);
    const t = line.trim();
    if (t === BLOCK_START) {
      inBlock = true;
      continue;
    }
    if (t === BLOCK_END) {
      inBlock = false;
      continue;
    }
    if (!inBlock) {
      otherComments.push(line);
      continue;
    }
    const sep = t.indexOf("::");
    if (sep < 0) continue;
    const key = t.slice(0, sep).trim();
    const value = unescapeValue(t.slice(sep + 2).trim());
    if (key) fields.push([key, value]);
  }
  return { fields, otherComments };
}

/** GenBank COMMENT lines for the given fields (empty values left out). */
export function formatComments(fields: LabFields, otherComments: string[] = []): string[] {
  const filled = fields.filter(([k, v]) => k.trim() && v.trim());
  if (!filled.length) return [...otherComments];
  const width = Math.min(28, Math.max(...filled.map(([k]) => k.trim().length)));
  return [
    ...otherComments,
    BLOCK_START,
    ...filled.map(([k, v]) => `${k.trim().padEnd(width)} :: ${escapeValue(v.trim())}`),
    BLOCK_END
  ];
}

// ---------- reading information off the features ----------

// A name may confer more than one: SnapGene's "NeoR/KanR" is both. "TetR" is left out, as
// in Tet-On and T-REx plasmids it is the repressor; SnapGene calls the resistance "TcR".
const RESISTANCE: [RegExp, string][] = [
  [/^(ampr|amp|bla|bla\s?tem-?1|beta[- ]?lactamase)$/i, "Ampicillin"],
  [/^(kanr|kan|nptii|npt2|kanmx\d*|aph\(3'\)-?ii?a?|aph|neor\/kanr|kanr\/neor)$/i, "Kanamycin"],
  [/^(neor|neo|neor\/kanr|kanr\/neor)$/i, "Neomycin/G418"],
  [/^(cmr|cm|cat|camr)$/i, "Chloramphenicol"],
  [/^(tcr|tet|teta|tetc|tet\(a\)|tet\(c\))$/i, "Tetracycline"],
  [/^(specr|smr|strr|aada|aad\(3''\)|spec\/strep)$/i, "Spectinomycin/Streptomycin"],
  [/^(gentr|gmr|aacc1|aac\(3\)-?i)$/i, "Gentamicin"],
  [/^(hygr|hph|hyg|hygromycin)$/i, "Hygromycin"],
  [/^(bleor|zeor|sh\s?ble|ble)$/i, "Zeocin/Bleomycin"],
  [/^(puror|pac|puro|pur)$/i, "Puromycin"],
  [/^(bsr|bsd|bsdr|blastr)$/i, "Blasticidin"],
  [/^(natr|nat|nat1|natmx\d*)$/i, "Nourseothricin"],
  [/^(ermr|erm|ermc|ermb)$/i, "Erythromycin"],
  [/^(hphmx\d*)$/i, "Hygromycin"]
];

const ORIGIN = /\bori\b|origin|cole1|p15a|pmb1|pbr322|psc101|r6k|rk2|pbbr1|2\s?(μ|micron|u)|\bcen\/?ars\b|\bars\d*\b|\bsv40 ori\b|f1 ori|puc ori/i;

export interface Detected {
  resistance: string[];
  origins: string[];
  promoters: string[];
}

const uniq = (xs: string[]) => Array.from(new Set(xs));

export function detectFromFeatures(features: Feature[]): Detected {
  const resistance: string[] = [];
  const origins: string[] = [];
  const promoters: string[] = [];
  for (const f of features) {
    const name = (f.name || "").trim();
    const type = (f.type || "").toLowerCase();
    if (!name && !type) continue;
    for (const [re, drug] of RESISTANCE) if (re.test(name)) resistance.push(drug);
    if (type === "rep_origin" || (name && ORIGIN.test(name))) origins.push(name || "origin");
    if (type === "promoter" || /promoter$/i.test(name)) promoters.push(name.replace(/\s*promoter$/i, "") || "promoter");
  }
  return { resistance: uniq(resistance), origins: uniq(origins), promoters: uniq(promoters) };
}

// 1 = counts as a known base, 2 = also G or C (S is G or C, W is A or T).
const GC_CLASS = new Uint8Array(128);
for (const c of "ATWatw") GC_CLASS[c.charCodeAt(0)] = 1;
for (const c of "GCSgcs") GC_CLASS[c.charCodeAt(0)] = 2;
let gcCache: { sequence: string; value: number } | null = null;

/** GC content in %, over the bases whose G/C status is known. */
export function gcPercent(sequence: string): number {
  // The status bar, inspector and Info all ask about the same sequence after each change.
  if (gcCache && gcCache.sequence === sequence) return gcCache.value;
  let gc = 0;
  let n = 0;
  for (let i = 0; i < sequence.length; i++) {
    const c = sequence.charCodeAt(i);
    const k = c < 128 ? GC_CLASS[c] : 0;
    if (k) {
      n++;
      if (k === 2) gc++;
    }
  }
  const value = n ? (gc / n) * 100 : 0;
  if (sequence.length > 10_000) gcCache = { sequence, value };
  return value;
}

/** Molecular weight of double-stranded DNA, in kDa (average base pair ≈ 617.96 Da). */
export function dsDnaKilodaltons(length: number): number {
  return (length * 617.96 + 36.04) / 1000;
}
