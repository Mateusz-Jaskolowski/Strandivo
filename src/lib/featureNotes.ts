// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A feature's note and the rest of its GenBank qualifiers, as the inspector shows them.
// The note is GenBank's /note: each line of the field is one /note value, as a file with
// several keeps them, and a qualifier's value can't hold a line break anyway. The app's
// own qualifiers (/strandivo_…) are shown by what they describe, never listed here.

const NOTE = "note";
const OWN = "strandivo_";

const asText = (v: unknown) => (typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));
const values = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter(x => x !== null && x !== undefined).map(asText);

/** The note as the field shows it: one /note value per line. */
export function noteText(notes: Record<string, unknown> | undefined): string {
  return values(notes?.[NOTE]).join("\n");
}

/**
 * Notes with the note set to `text`, other qualifiers kept in their order. While typing
 * (`tidy` false) lines stay as typed, so a space or a new line isn't eaten under the
 * caret; once the field is left, lines are trimmed and empty ones dropped. No text, no
 * /note. Returns `notes` itself when nothing changes, so no undo step is made.
 */
export function withNote(notes: Record<string, unknown> | undefined, text: string, tidy: boolean): Record<string, unknown> {
  const before = notes ?? {};
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (tidy) lines = lines.map(l => l.trim()).filter(Boolean);
  const next = lines.join("\n") ? lines : [];
  const now = values(before[NOTE]);
  if (next.length === now.length && next.every((l, i) => l === now[i])) return before;
  const out: Record<string, unknown> = {};
  let placed = false;
  for (const [k, v] of Object.entries(before)) {
    if (k !== NOTE) out[k] = v;
    else if (next.length) {
      out[k] = next;
      placed = true;
    }
  }
  if (next.length && !placed) out[NOTE] = next;
  return out;
}

/** The feature's other qualifiers, in the file's order, each with its values. */
export function otherQualifiers(notes: Record<string, unknown> | undefined): { name: string; values: string[] }[] {
  return Object.entries(notes ?? {})
    .filter(([k]) => k !== NOTE && !k.startsWith(OWN))
    .map(([name, v]) => ({ name, values: values(v).filter(x => x !== "") }))
    .filter(q => q.values.length);
}
