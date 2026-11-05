// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Reading and writing sequence files with TeselaGen's parsers.

import { anyToJson, jsonToFasta, jsonToGenbank } from "@teselagen/bio-parsers";
import { parseFastq } from "../lib/fastq.ts";
import { Buffer as PolyfillBuffer } from "buffer/index.js";
import { compactChromatogram } from "../lib/chromatogram.ts";
import { basename, extension, stripExtension } from "../lib/files.ts";
import { snapgenePrimers, snapgeneSegmentGaps } from "../lib/snapgene.ts";
import type { SaveFormat } from "../lib/files.ts";
import type { Chromatogram } from "../lib/types.ts";

export interface ParsedFile {
  sequences: any[];
  warnings: string[];
}

/**
 * What the parsers read: a File in the app. Under Node (tests) there is no FileReader, so
 * text formats go in as a string and binary ones as the browser `buffer` package's Buffer,
 * the only kind the parsers' binary readers recognise.
 */
function toFile(bytes: Uint8Array, name: string): File | Uint8Array | string {
  // Copy into a fresh ArrayBuffer so the File owns its data.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  if (typeof FileReader !== "undefined") return new File([copy.buffer], name);
  if (/\.(dna|prot|ab1|abi|geneious)$/i.test(name)) return PolyfillBuffer.from(copy.buffer);
  return new TextDecoder().decode(copy);
}

/** Parses any supported sequence file. Throws with a readable message if nothing could be read. */
export async function parseSequenceFile(bytes: Uint8Array, path: string): Promise<ParsedFile> {
  const name = basename(path);
  const results = await anyToJson(toFile(bytes, name), { fileName: name, acceptParts: true });
  const ok = (results || []).filter(r => r && r.success && r.parsedSequence);
  const warnings = (results || []).flatMap(r => r?.messages || []).filter(m => !/^Parsed using/i.test(m));
  if (!ok.length) {
    throw new Error(warnings.length ? warnings.join("\n") : `Couldn't read ${name}. Is it a sequence file?`);
  }
  const sequences = ok.map(r => {
    const s = r.parsedSequence;
    if (!s.name || s.name === "Untitled Sequence") s.name = stripExtension(name);
    if (typeof s.description === "string") s.description = htmlToText(s.description);
    return s;
  });
  // The generic parser skips primers stored in SnapGene files.
  if (extension(path) === "dna" && sequences.length === 1) {
    const primers = snapgenePrimers(bytes).map(p => ({
      name: p.name,
      type: "primer_bind",
      start: p.start,
      end: p.end,
      forward: p.forward,
      strand: p.forward ? 1 : -1,
      bases: p.bases,
      primerBindsOn: "3prime",
      notes: p.description ? { note: [p.description] } : {}
    }));
    if (primers.length) {
      const existing = Array.isArray(sequences[0].primers) ? sequences[0].primers : Object.values(sequences[0].primers || {});
      sequences[0].primers = [...existing, ...primers];
    }
    // It also keeps a feature's gaps (introns) as parts of it: drop them.
    const gaps = snapgeneSegmentGaps(bytes);
    const features: any[] = Array.isArray(sequences[0].features) ? sequences[0].features : Object.values(sequences[0].features || {});
    if (gaps.length === features.length) {
      features.forEach((f, i) => {
        const gap = gaps[i];
        if (!Array.isArray(f.locations) || f.locations.length !== gap.length || !gap.some(Boolean)) return;
        const kept = f.locations.filter((_: unknown, k: number) => !gap[k]);
        if (!kept.length) return;
        if (kept.length > 1) f.locations = kept;
        else delete f.locations;
        f.start = kept[0].start;
        f.end = kept[kept.length - 1].end;
      });
    }
  }
  return { sequences, warnings };
}

export function serialize(seq: any, format: SaveFormat): string {
  return format === "fasta" ? jsonToFasta(seq) : jsonToGenbank(seq);
}

export interface ReadFileData {
  name: string;
  sequence: string;
  chromatogram: Chromatogram | null;
  /** Phred scores, from a FASTQ file. */
  qualities?: number[];
}

/**
 * More reads than this in a FASTQ file are a run's raw reads, which the app doesn't
 * assemble: providers send a plasmid's finished sequence next to them.
 */
const MAX_FASTQ_READS = 200;

/** Reads a sequencing result: an .ab1 trace, FASTQ, GenBank, or a plain/FASTA text file. */
export async function parseReadFile(bytes: Uint8Array, path: string): Promise<ReadFileData[]> {
  const name = basename(path);
  const ext = extension(path);
  const stem = stripExtension(name);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) throw new Error(`${name} is compressed. Unzip it first.`);
  if (ext === "ab1" || ext === "abi" || ext === "ab!") {
    const results = await anyToJson(toFile(bytes, name), { fileName: name.replace(/\.(abi|ab!)$/i, ".ab1") });
    const r = results?.[0];
    if (!r?.success || !r.parsedSequence?.chromatogramData) throw new Error(`Couldn't read the trace in ${name}.`);
    return [{ name: stem, sequence: r.parsedSequence.sequence, chromatogram: compactChromatogram(r.parsedSequence.chromatogramData) }];
  }
  const text = new TextDecoder().decode(bytes);
  if (ext === "fastq" || ext === "fq") {
    const reads = parseFastq(text);
    if (reads.length > MAX_FASTQ_READS) throw new Error(`${name} has ${reads.length.toLocaleString("en-US")} reads, so it looks like raw reads. Add the plasmid's assembled sequence instead.`);
    return reads.map(r => ({ name: reads.length === 1 ? stem : r.name, sequence: r.sequence, qualities: r.qualities, chromatogram: null }));
  }
  if (text.trimStart().startsWith("LOCUS")) {
    const { sequences } = await parseSequenceFile(bytes, path);
    return sequences.map(s => ({ name: sequences.length === 1 ? stem : s.name || stem, sequence: String(s.sequence ?? ""), chromatogram: null }));
  }
  if (text.trimStart().startsWith(">")) {
    const out: ReadFileData[] = [];
    let current: ReadFileData | null = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith(">")) {
        current = { name: line.slice(1).trim() || stem, sequence: "", chromatogram: null };
        out.push(current);
      } else if (current) {
        current.sequence += line.replace(/[^A-Za-z]/g, "");
      }
    }
    return out.filter(r => r.sequence.length);
  }
  const seq = text.replace(/[^A-Za-z]/g, "");
  if (!seq.length) throw new Error(`${name} doesn't contain a sequence.`);
  return [{ name: stem, sequence: seq, chromatogram: null }];
}

/** SnapGene stores descriptions as simple HTML; keep the text. */
export function htmlToText(value: string): string {
  if (!/[<&]/.test(value)) return value;
  if (typeof DOMParser === "undefined") return value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim();
  const doc = new DOMParser().parseFromString(value.replace(/<br\s*\/?>/gi, "\n"), "text/html");
  return (doc.body.textContent || "").trim();
}
