// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// File-name helpers (pure).

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : "";
}

export function extension(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

export function stripExtension(name: string): string {
  const b = basename(name);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** Sanger trace files. */
export const TRACE_EXTENSIONS = ["ab1", "abi", "ab!"];
/** Plain-text read files sequencing providers often send next to traces. */
export const TEXT_READ_EXTENSIONS = ["seq", "txt", "fastq", "fq"];

export const SEQUENCE_EXTENSIONS = [
  "dna", "gb", "gbk", "gbff", "genbank", "ape", "fa", "fasta", "fas", "fna", "ffn", "faa",
  "json", "xml", "rdf", "sbol", "gff", "gff3", "geneious", "prot", "gp", "genpep", "fastq", "fq"
];

export const isTraceFile = (path: string) => TRACE_EXTENSIONS.includes(extension(path));

/** Formats we can write. */
export type SaveFormat = "genbank" | "fasta";

export function formatForPath(path: string): SaveFormat | null {
  const ext = extension(path);
  if (["gb", "gbk", "genbank", "gbff", "ape"].includes(ext)) return "genbank";
  if (["fa", "fasta", "fas", "fna"].includes(ext)) return "fasta";
  return null;
}

/** File name to suggest when saving a document that can't be saved in its own format. */
export function suggestedSaveName(currentPath: string | null, sequenceName: string, format: SaveFormat): string {
  const stem = currentPath ? stripExtension(currentPath) : (sequenceName || "Untitled").replace(/[\\/:*?"<>|]+/g, "_");
  return `${stem}.${format === "genbank" ? "gb" : "fasta"}`;
}
