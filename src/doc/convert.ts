// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Converting between the file parser's sequence JSON (TeselaGen bio-parsers) and the
// document model. Fields the model doesn't use are kept and written back unchanged.

import { newId, reverseComplement, type Range, type SeqData, type SeqFeature, type SeqPrimer, type Strand } from "../lib/seqdata.ts";
import { parseComments } from "../lib/labinfo.ts";
import { nameFromFile } from "../lib/sequenceName.ts";

export interface LoadedDocument {
  data: SeqData;
  /** Top-level fields of the file that the model doesn't edit (accession, comments, …). */
  extra: Record<string, unknown>;
  /** Source features that covered the whole sequence: they still do when saved. */
  wholeSources: string[];
}

const list = (x: unknown): Record<string, unknown>[] =>
  Array.isArray(x) ? (x as Record<string, unknown>[]) : x && typeof x === "object" ? (Object.values(x) as Record<string, unknown>[]) : [];

const num = (x: unknown, fallback = 0) => (typeof x === "number" && Number.isFinite(x) ? x : fallback);

function strandOf(raw: Record<string, unknown>): Strand {
  if (raw.arrowheadType === "NONE") return 0;
  if (raw.forward === false || raw.strand === -1 || raw.strand === "-1") return -1;
  return 1;
}

const MODEL_KEYS = new Set(["name", "description", "circular", "sequence", "features", "primers"]);

export function fromParsed(seq: Record<string, unknown>): LoadedDocument {
  const sequence = String(seq.sequence ?? "");
  const n = sequence.length;
  const features: SeqFeature[] = [];
  const sources: SeqFeature[] = [];
  const wholeSources: string[] = [];
  for (const raw of list(seq.features)) {
    const type = String(raw.type ?? "misc_feature");
    const f: SeqFeature = {
      id: String(raw.id ?? newId("f")),
      name: String(raw.name ?? raw.label ?? type),
      type,
      start: clamp(num(raw.start), n),
      end: clamp(num(raw.end), n),
      strand: strandOf(raw),
      color: typeof raw.color === "string" && raw.color ? raw.color : undefined,
      notes: (raw.notes as Record<string, unknown>) || {},
      raw
    };
    const parts = list(raw.locations).map(l => ({ start: clamp(num(l.start), n), end: clamp(num(l.end), n) }));
    if (parts.length > 1) {
      f.locations = parts;
      f.start = parts[0].start;
      f.end = parts[parts.length - 1].end;
    }
    if (type.toLowerCase() === "source") {
      sources.push(f);
      if (n && f.start === 0 && f.end === n - 1) wholeSources.push(f.id);
    } else features.push(f);
  }
  const primers: SeqPrimer[] = [];
  for (const raw of list(seq.primers)) {
    const start = clamp(num(raw.start), n);
    const end = clamp(num(raw.end), n);
    const strand = strandOf(raw) === -1 ? -1 : 1;
    const site = start <= end ? sequence.slice(start, end + 1) : sequence.slice(start) + sequence.slice(0, end + 1);
    const given = typeof raw.bases === "string" && raw.bases ? raw.bases : typeof raw.sequence === "string" ? raw.sequence : "";
    primers.push({
      id: String(raw.id ?? newId("p")),
      name: String(raw.name ?? "primer"),
      start,
      end,
      strand,
      bases: (given || (strand === 1 ? site : reverseComplement(site))).toUpperCase(),
      color: typeof raw.color === "string" && raw.color ? raw.color : undefined,
      notes: (raw.notes as Record<string, unknown>) || {},
      raw
    });
  }
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(seq)) if (!MODEL_KEYS.has(k)) extra[k] = v;
  return {
    data: {
      // A name with spaces is kept in the comments too, as the LOCUS line can't hold it.
      name: nameFromFile(String(seq.name ?? "Untitled"), parseComments(Array.isArray(seq.comments) ? seq.comments : undefined).name),
      description: typeof seq.description === "string" ? seq.description : "",
      circular: !!seq.circular,
      sequence,
      features,
      primers,
      sources
    },
    extra,
    wholeSources
  };
}

function clamp(p: number, n: number) {
  return Math.max(0, Math.min(Math.max(0, n - 1), Math.round(p)));
}

/** GenBank and FASTA keep the description on one line; a line break would corrupt them. */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/**
 * Qualifiers as the GenBank writer takes them: lists of strings. The parser reads numbers
 * (/codon_start=2) as numbers, and the writer stops at the first one, losing it and every
 * qualifier after it.
 */
function notesOut(notes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(notes ?? {})) {
    const values = Array.isArray(v) ? v : [v];
    out[k] = values.filter(x => x !== null && x !== undefined).map(x => (typeof x === "string" ? x : typeof x === "object" ? JSON.stringify(x) : String(x)));
  }
  return out;
}

const partsOut = (locations: Range[] | undefined) => (locations && locations.length > 1 ? locations.map(l => ({ start: l.start, end: l.end })) : undefined);

/** Sequence JSON for the file writers. */
export function toParsed(doc: LoadedDocument, data: SeqData): Record<string, unknown> {
  const n = data.sequence.length;
  const features = data.features.map(f => {
    const out: Record<string, unknown> = {
      ...f.raw,
      id: f.id,
      name: f.name,
      type: f.type,
      start: f.start,
      end: f.end,
      forward: f.strand !== -1,
      strand: f.strand === -1 ? -1 : 1,
      notes: notesOut(f.notes)
    };
    // No colour means the type's own one, also when the file had another.
    if (f.color) out.color = f.color;
    else delete out.color;
    if (f.strand === 0) out.arrowheadType = "NONE";
    else if (out.arrowheadType === "NONE") delete out.arrowheadType;
    const parts = partsOut(f.locations);
    if (parts) out.locations = parts;
    else delete out.locations;
    return out;
  });
  const sources = data.sources.map(f => {
    const whole = doc.wholeSources.includes(f.id);
    const out: Record<string, unknown> = { ...f.raw, id: f.id, start: whole ? 0 : f.start, end: whole ? Math.max(0, n - 1) : f.end };
    if (f.raw.notes && typeof f.raw.notes === "object") out.notes = notesOut(f.raw.notes as Record<string, unknown>);
    const parts = whole ? undefined : partsOut(f.locations);
    if (parts) out.locations = parts;
    else delete out.locations;
    return out;
  });
  const primers = data.primers.map(p => {
    const out: Record<string, unknown> = {
      ...p.raw,
      id: p.id,
      name: p.name,
      type: "primer_bind",
      start: p.start,
      end: p.end,
      forward: p.strand === 1,
      strand: p.strand,
      bases: p.bases,
      primerBindsOn: "3prime",
      notes: notesOut(p.notes)
    };
    // No colour means the default one, also when the file had another.
    if (p.color) out.color = p.color;
    else delete out.color;
    return out;
  });
  const description = oneLine(data.description);
  return {
    ...doc.extra,
    name: data.name,
    // The GenBank writer prefers the file's own DEFINITION, so set both.
    description,
    definition: description,
    circular: data.circular,
    sequence: data.sequence,
    size: n,
    features: [...sources, ...features],
    primers
  };
}
