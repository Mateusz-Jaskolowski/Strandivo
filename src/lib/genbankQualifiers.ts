// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Qualifier values in GenBank files, read and written as the format has them. The generic
// parser cuts a value at its first quote (GenBank writes a quote in a value as ""), drops
// quotes and backslashes on later lines and joins wrapped lines with no space, so "onto" at
// the end of a line and "another" on the next came in as "ontoanother". Its writer
// wraps mid-word and writes quotes as they are, which ends the value early for any reader.
// `fixQualifiers` puts right what it read, `formatQualifier` writes a value.

/** One feature in a file's FEATURES table: its key, location and qualifiers in order. */
export interface FileFeature {
  key: string;
  location: string;
  qualifiers: [string, string][];
}

const WIDTH = 79;
const INDENT = 21;

/** Values with no spaces, which wrap mid-way and join with nothing between their lines. */
const unspaced = (name: string) => name === "translation" || name.startsWith("strandivo_");

/** Each record's features, in the order the file lists them. */
export function readFeatureTables(text: string): FileFeature[][] {
  const records: FileFeature[][] = [];
  let features: FileFeature[] | null = null;
  let open: { name: string; parts: string[]; feature: FileFeature } | null = null;
  // Adds a line's part of a quoted value; true once its closing quote is reached.
  const take = (s: string) => {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '"') out += s[i];
      else if (s[i + 1] === '"') out += s[i++];
      else {
        open!.parts.push(out);
        return true;
      }
    }
    open!.parts.push(out);
    return false;
  };
  const close = () => {
    const { name, parts, feature } = open!;
    feature.qualifiers.push([name, unspaced(name) ? parts.map(p => p.trim()).join("") : parts.map(p => p.trim()).filter(Boolean).join(" ")]);
    open = null;
  };
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (/^\/\/\s*$/.test(line)) {
      if (open) close();
      if (features) records.push(features);
      features = null;
      continue;
    }
    if (/^FEATURES\b/.test(line)) {
      features = [];
      continue;
    }
    if (!features) continue;
    if (open) {
      if (take(line.trimStart())) close();
      continue;
    }
    // A line starting at the margin ends the table (ORIGIN, BASE COUNT, CONTIG).
    if (/^\S/.test(line)) {
      records.push(features);
      features = null;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    const body = line.trimStart();
    if (indent < INDENT && indent > 0) {
      const [key, ...rest] = body.split(/\s+/);
      features.push({ key, location: rest.join(""), qualifiers: [] });
    } else if (body.startsWith("/") && features.length) {
      const feature = features[features.length - 1];
      const eq = body.indexOf("=");
      const name = eq < 0 ? body.slice(1) : body.slice(1, eq);
      const value = eq < 0 ? "" : body.slice(eq + 1);
      if (value.startsWith('"')) {
        open = { name, parts: [], feature };
        if (take(value.slice(1))) close();
      } else feature.qualifiers.push([name, value.trim()]);
    }
    // Anything else continues the location.
    else if (features.length && !features[features.length - 1].qualifiers.length) features[features.length - 1].location += body;
  }
  if (open) close();
  if (features) records.push(features);
  return records;
}

/** First and last base of a location as written, 0-based, as the parser gives them. */
function ends(location: string): [number, number] | null {
  const n = location.match(/\d+/g);
  return n ? [Number(n[0]) - 1, Number(n[n.length - 1]) - 1] : null;
}

/**
 * Puts the generic parser's qualifier values right from the file's own table. Its features,
 * primers and parts are each in file order, so each is matched to the next feature in the
 * file with its first and last base; one that matches none is left as it is. A qualifier
 * it took for its own use (a /label for the name) stays out; one it made up from a line
 * starting with "/" inside a value goes. Numbers it read (/codon_start=2) stay numbers.
 */
export function fixQualifiers(lists: unknown[][], table: FileFeature[]) {
  for (const list of lists) {
    let at = 0;
    for (const item of list as { start?: unknown; end?: unknown; notes?: Record<string, unknown> }[]) {
      const notes = item?.notes;
      if (!notes || typeof notes !== "object" || typeof item.start !== "number" || typeof item.end !== "number") continue;
      let i = at;
      for (; i < table.length; i++) {
        const e = ends(table[i].location);
        if (e && e[0] === item.start && e[1] === item.end) break;
      }
      if (i === table.length) continue;
      at = i + 1;
      const file = table[i].qualifiers;
      for (const k of Object.keys(notes)) {
        if (!file.some(([n]) => n === k)) {
          delete notes[k];
          continue;
        }
        const theirs = Array.isArray(notes[k]) ? (notes[k] as unknown[]) : [notes[k]];
        let ours = file.filter(([n]) => n === k).map(([, v]) => v);
        // A primer's bases, kept in a note, it takes out of the notes.
        if (ours.length !== theirs.length && k === "note") ours = ours.filter(v => !/sequence:/i.test(v));
        if (ours.length !== theirs.length) continue;
        notes[k] = theirs.map((v, j) => (typeof v === "number" && String(v) === ours[j] ? v : ours[j]));
      }
    }
  }
}

/**
 * A qualifier as GenBank lines: quotes doubled, wrapped at spaces to 79 columns. A word too
 * long for a line keeps to one line rather than be split, and one starting with "/" stays
 * on the line before, so neither reads back as something else. Translations and the app's
 * own values have no spaces and are cut to the width.
 */
export function formatQualifier(name: string, value: string): string[] {
  const pad = " ".repeat(INDENT);
  const text = `/${name}="${value.replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`;
  const room = WIDTH - INDENT;
  if (text.length <= room) return [pad + text];
  const lines: string[] = [];
  if (unspaced(name)) {
    for (let i = 0; i < text.length; i += room) lines.push(pad + text.slice(i, i + room));
    return lines;
  }
  const words = text.split(" ");
  let line = words[0];
  for (const w of words.slice(1)) {
    if (line.length + 1 + w.length <= room || w.startsWith("/") || !w) line += " " + w;
    else {
      lines.push(pad + line);
      line = w;
    }
  }
  lines.push(pad + line);
  return lines;
}
