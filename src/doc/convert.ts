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
const EXTRA_ANNOTATION_KEYS = ["parts", "warnings", "assemblyPieces", "lineageAnnotations"] as const;

/**
 * Standard CSS named colours accepted by `color-string` inside `@teselagen/bio-parsers`.
 * Anything outside this list (such as SnapGene's `"noColor"` or `"none"`) makes `jsonToGenbank`
 * throw inside `color.rgb(...)` and return `false`.
 */
const CSS_COLORS = new Set([
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond",
  "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue",
  "cornsilk", "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey",
  "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon",
  "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink",
  "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia",
  "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey", "honeydew",
  "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon",
  "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey",
  "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey",
  "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen",
  "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite",
  "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod", "palegreen",
  "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple",
  "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen",
  "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen",
  "steelblue", "tan", "teal", "thistle", "tomato", "transparent", "turquoise", "violet", "wheat", "white",
  "whitesmoke", "yellow", "yellowgreen"
]);

const HEX_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const BARE_HEX6 = /^[0-9a-f]{6}$/i;
const RGB_COLOR = /^rgba?\(\s*[+-]?\d+(?=[\s,])\s*(?:,\s*)?[+-]?\d+(?=[\s,])\s*(?:,\s*)?[+-]?\d+\s*(?:[,|/]\s*[+-]?[\d.]+%?\s*)?\)$/;
const RGB_PCT_COLOR = /^rgba?\(\s*[+-]?[\d.]+%\s*,?\s*[+-]?[\d.]+%\s*,?\s*[+-]?[\d.]+%\s*(?:[,|/]\s*[+-]?[\d.]+%?\s*)?\)$/;
const HSL_COLOR = /^hsla?\(\s*[+-]?(?:\d{0,3}\.)?\d+(?:deg)?\s*,?\s*[+-]?[\d.]+%\s*,?\s*[+-]?[\d.]+%\s*(?:[,|/]\s*[+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d+)?\s*)?\)$/;
const HWB_COLOR = /^hwb\(\s*[+-]?\d{0,3}(?:\.\d+)?(?:deg)?\s*,\s*[+-]?[\d.]+%\s*,\s*[+-]?[\d.]+%\s*(?:,\s*[+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d+)?\s*)?\)$/;

/** Normalises a colour string to one `jsonToGenbank`'s colour parser accepts, or drops it. */
function writableColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (HEX_COLOR.test(s)) return s;
  if (BARE_HEX6.test(s)) return `#${s}`;
  const lower = s.toLowerCase();
  if (CSS_COLORS.has(lower)) return lower;
  if (RGB_COLOR.test(lower) || RGB_PCT_COLOR.test(lower) || HSL_COLOR.test(lower) || HWB_COLOR.test(lower)) return lower;
  return undefined;
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function firstStringNote(notes: unknown, key: string): string | undefined {
  if (!isRecord(notes)) return undefined;
  const v = notes[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.find((x): x is string => typeof x === "string" && x.trim().length > 0);
  return undefined;
}

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
      color: writableColor(raw.color) ?? writableColor(firstStringNote(raw.notes, "color")),
      notes: isRecord(raw.notes) ? raw.notes : {},
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
      color: writableColor(raw.color) ?? writableColor(firstStringNote(raw.notes, "color")),
      notes: isRecord(raw.notes) ? raw.notes : {},
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
 * qualifier after it. `color` and `labelColor` are omitted here because `jsonToGenbank`
 * copies them straight onto the feature instead of writing them as notes, crashing if they
 * are arrays (such as `[]`).
 */
function notesOut(notes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(notes ?? {})) {
    if (k === "color" || k === "labelColor") continue;
    const values = Array.isArray(v) ? v : [v];
    out[k] = values.filter(x => x !== null && x !== undefined).map(x => (typeof x === "string" ? x : typeof x === "object" ? JSON.stringify(x) : String(x)));
  }
  return out;
}

/** Keeps only field values `jsonToGenbank` can write without throwing and returning `false`. */
function cleanAnnotation(out: Record<string, unknown>, color: unknown, notes: unknown): Record<string, unknown> {
  const validColor = writableColor(color);
  if (validColor) out.color = validColor;
  else delete out.color;
  const labelColor = typeof out.labelColor === "string" ? out.labelColor.trim() : firstStringNote(notes, "labelColor")?.trim();
  if (labelColor) out.labelColor = labelColor;
  else delete out.labelColor;
  if (typeof out.arrowheadType !== "string" || !out.arrowheadType) delete out.arrowheadType;
  if (out.name !== undefined && typeof out.name !== "string") out.name = String(out.name);
  if (out.type !== undefined && typeof out.type !== "string") out.type = String(out.type);
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
    if (f.strand === 0) out.arrowheadType = "NONE";
    else if (out.arrowheadType === "NONE") delete out.arrowheadType;
    const parts = partsOut(f.locations);
    if (parts) out.locations = parts;
    else delete out.locations;
    // No colour means the type's own one, also when the file had another.
    return cleanAnnotation(out, f.color, f.notes);
  });
  const sources = data.sources.map(f => {
    const whole = doc.wholeSources.includes(f.id);
    const out: Record<string, unknown> = { ...f.raw, id: f.id, start: whole ? 0 : f.start, end: whole ? Math.max(0, n - 1) : f.end };
    if (isRecord(f.raw.notes)) out.notes = notesOut(f.raw.notes);
    else delete out.notes;
    const parts = whole ? undefined : partsOut(f.locations);
    if (parts) out.locations = parts;
    else delete out.locations;
    return cleanAnnotation(out, f.raw.color ?? firstStringNote(f.raw.notes, "color"), f.raw.notes);
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
    return cleanAnnotation(out, p.color, p.notes);
  });
  const extra: Record<string, unknown> = { ...doc.extra };
  if (extra.comments !== undefined) {
    if (Array.isArray(extra.comments)) extra.comments = extra.comments.map(c => (typeof c === "string" ? c : String(c)));
    else delete extra.comments;
  }
  for (const key of EXTRA_ANNOTATION_KEYS) {
    if (extra[key] === undefined) continue;
    extra[key] = list(extra[key]).map(raw => {
      const out: Record<string, unknown> = { ...raw };
      if (isRecord(raw.notes)) out.notes = notesOut(raw.notes);
      else delete out.notes;
      return cleanAnnotation(out, raw.color ?? firstStringNote(raw.notes, "color"), raw.notes);
    });
  }
  const description = oneLine(data.description);
  return {
    ...extra,
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
