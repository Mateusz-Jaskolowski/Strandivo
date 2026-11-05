// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Guessing which reads are of one clone from their names. Sequencing providers name files
// from the user's sample name and the primer, often with a plate well, a date, an order
// number or a running number. Reads of one clone share everything but the primer and the
// provider's own numbering (A01_M13F + A01_M13R → A01; clone3-F + clone3-R → clone3).

/**
 * Sequencing primers and read directions, as they appear in file names. F1–F24 are left
 * out: they are also plate wells (and a well that varies is dropped anyway).
 */
const PRIMER =
  /^(?:m13\w*|t7\w*|t3\w*|sp6\w*|pgex\w*|bgh\w*|cmv\w*|sv40\w*|pbad\w*|pjet\w*|pqe\w*|lko\w*|hu6\w*|u6\w*|ef1a\w*|polyh\w*|ac5\w*|[fr]|r\d|fw\d?|rv\d?|fwd|rev|for|forward|reverse|uni|univ|universal)$/i;
/** M13's −20/−21/−40/−47/−48 forward primers, which would split into two tokens. */
const M13_NUMBERED = /m13[\s_-]*\(?-?(?:20|21|40|47|48)\)?/gi;
const DATE = /(?:19|20)\d\d([-_.]?)(?:0[1-9]|1[0-2])\1(?:0[1-9]|[12]\d|3[01])/g;
/** A well of a 96- or 384-well plate: A1, A01, P24. */
const WELL = /^[a-p](?:0?[1-9]|1\d|2[0-4])$/i;
const NUMBER = /^\d+$/;
const SEPARATOR = /[\s_.+()[\]-]+/;

interface Token {
  text: string;
  /** The separator before it in the name, so a label keeps the name's own spelling. */
  sep: string;
}

interface Parsed {
  name: string;
  tokens: Token[];
  primers: string[];
}

function parse(name: string): Parsed {
  const stem = name
    .replace(/\.(ab1|abi|scf|seq|fasta|fa|txt)$/i, "")
    .replace(M13_NUMBERED, "_M13F_")
    .replace(DATE, "_");
  const tokens: Token[] = [];
  const primers: string[] = [];
  let sep = "";
  let afterPrimer = false;
  for (const part of stem.split(new RegExp(`(${SEPARATOR.source})`))) {
    if (!part) continue;
    if (SEPARATOR.test(part)) {
      sep = part[0] === " " ? " " : part[0];
      continue;
    }
    // A number after a primer is part of its name (pGEX-5, pGEX-3).
    if (afterPrimer && NUMBER.test(part)) primers[primers.length - 1] += `-${part}`;
    else if (PRIMER.test(part)) primers.push(part.toLowerCase());
    else tokens.push({ text: part, sep });
    afterPrimer = PRIMER.test(part);
  }
  return { name, tokens, primers };
}

/** Ways to read a name's clone, most literal first: which tokens name the clone. */
const CANDIDATES: ((t: Token, i: number, all: Token[]) => boolean)[] = [
  () => true,
  // A well of the provider's own plate, or a running number, can differ between the
  // reads of one sample.
  t => !WELL.test(t.text),
  (t, i, all) => !(NUMBER.test(t.text) && i === all.length - 1),
  t => !WELL.test(t.text) && !NUMBER.test(t.text)
];

function split(p: Parsed, keep: (typeof CANDIDATES)[number]) {
  const kept = p.tokens.filter(keep);
  const label = kept.map((t, i) => (i ? t.sep : "") + t.text).join("");
  // What tells a clone's reads apart: their primers, or a well-like token read as one
  // (F1, R1). A dropped well or number alone doesn't: A01_bla … A06_bla are six clones.
  const dropped = p.tokens.filter((t, i, all) => !keep(t, i, all) && /^[fr]\d+$/i.test(t.text));
  const rest = [...dropped.map(t => t.text.toLowerCase()), ...p.primers].join(" ");
  return { label, key: kept.map(t => t.text.toLowerCase()).join("_"), rest };
}

/**
 * How well a way of reading names groups them: the number of reads in groups of two or
 * more, or -1 if it leaves a name with no clone or groups two reads made with the same
 * primer (more likely two samples than one sample read twice).
 */
function score(parsed: Parsed[], keep: (typeof CANDIDATES)[number]): number {
  const groups = new Map<string, string[]>();
  for (const p of parsed) {
    const { key, rest } = split(p, keep);
    if (!key) return -1;
    groups.set(key, [...(groups.get(key) ?? []), rest]);
  }
  let grouped = 0;
  for (const rests of groups.values()) {
    if (rests.length < 2) continue;
    if (new Set(rests).size < rests.length) return -1;
    grouped += rests.length;
  }
  return grouped;
}

export interface CloneGuess {
  /** Same for reads of one clone (lower case); null for a read that is a clone of its own. */
  key: string | null;
  /** The clone's name as written in its reads' names, e.g. "A01" or "clone3". */
  label: string;
}

/**
 * Guesses each read's clone from the names of all reads added together, since several
 * names show which parts vary. A read that groups with no other is a clone of its own,
 * named as the read.
 */
export function guessClones(names: string[]): CloneGuess[] {
  const parsed = names.map(parse);
  let best = CANDIDATES[0];
  let bestScore = score(parsed, best);
  for (const c of CANDIDATES.slice(1)) {
    const s = score(parsed, c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  const guesses = parsed.map(p => (bestScore > 0 ? split(p, best) : null));
  const count = new Map<string, number>();
  for (const g of guesses) if (g) count.set(g.key, (count.get(g.key) ?? 0) + 1);
  return guesses.map((g, i) => (g && count.get(g.key)! > 1 ? { key: g.key, label: g.label } : { key: null, label: parsed[i].name }));
}
