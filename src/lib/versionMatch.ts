// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Which of a variable region's versions a clone has: exactly, or the closest by edit
// distance, with every version that is as close. A long list (a library can have a million
// versions) is indexed once: its sequences in a hash and its versions by length. A clone
// that is a version, or one change from one, is then found by lookups, and others by
// comparing lengths nearest first, giving each comparison up as soon as it can't win.
// Short lists are compared one by one, which is as fast. Pure, so it is unit-tested.

export interface Version {
  name: string;
  /** DNA bases or amino acids, as the design holds them. */
  bases: string;
}

export interface VersionMatch {
  /** The closest versions' indices, in the design's order: several when equally close. */
  versions: number[];
  /** Their edit distance from the clone's sequence. */
  distance: number;
}

/** Below this many versions, comparing each one is as fast as building an index. */
const INDEX_FROM = 64;

/**
 * Comparing a clone with every version takes about versions × length² steps, which is what
 * finding the closest one comes to for a clone close to none. From the work of 15,000
 * versions of 20 amino acids on (about 167,000 of 6, or 1,700 of 60) that is some 30 ms a
 * clone, a few seconds for a plate, and exact matching suits the library better.
 */
export const SLOW_MATCHING = 15_000 * 20 * 20;

/** Whether finding closest versions among `count` versions of `letters` in all is slow. */
export const slowToMatch = (count: number, letters: number) => count > 0 && (letters * letters) / count >= SLOW_MATCHING;

const slow = new WeakMap<Version[], boolean>();
/** `slowToMatch` for a design's versions, worked out once for each list. */
export function slowVersions(versions: Version[]): boolean {
  let known = slow.get(versions);
  if (known === undefined) slow.set(versions, (known = slowToMatch(versions.length, versions.reduce((n, v) => n + v.bases.length, 0))));
  return known;
}

/** A search for a clone's version, as `matchVersion` takes it. */
export interface VersionSearch {
  versions: Version[];
  query: string;
  /** Stands for anything, in a version or the query (X for amino acids). */
  wild: string;
  exact: boolean;
}

interface VersionIndex {
  /** Each sequence's versions, for versions without a wildcard. */
  exact: Map<string, number[]>;
  /** Every version, by length, and the lengths. */
  byLength: Map<number, number[]>;
  lengths: number[];
  /** Versions with a wildcard, which no lookup finds. */
  wild: number[];
  /** Every letter the versions use, to spell sequences one change from a clone's. */
  letters: string[];
  longest: number;
}

/** Steps between pauses of a search run a little at a time (`searchVersion`). */
const STEP = 2_000;

const indexes = new WeakMap<Version[], Map<string, VersionIndex>>();
// Searches done, by list, as identical clones ask the same and the views ask again.
const found = new WeakMap<Version[], Map<string, VersionMatch | null>>();

function* indexOf(versions: Version[], wild: string): Generator<void, VersionIndex> {
  const byWild = indexes.get(versions) ?? new Map<string, VersionIndex>();
  indexes.set(versions, byWild);
  const known = byWild.get(wild);
  if (known) return known;
  const ix: VersionIndex = { exact: new Map(), byLength: new Map(), lengths: [], wild: [], letters: [], longest: 0 };
  const letters = new Set<string>();
  for (let i = 0; i < versions.length; i++) {
    if (i % (STEP * 10) === STEP * 10 - 1) yield;
    const s = versions[i].bases;
    const group = ix.byLength.get(s.length);
    if (group) group.push(i);
    else ix.byLength.set(s.length, [i]);
    ix.longest = Math.max(ix.longest, s.length);
    if (wild && s.includes(wild)) {
      ix.wild.push(i);
      continue;
    }
    const same = ix.exact.get(s);
    if (same) same.push(i);
    else ix.exact.set(s, [i]);
    for (const c of s) letters.add(c);
  }
  ix.lengths = [...ix.byLength.keys()];
  ix.letters = [...letters];
  byWild.set(wild, ix);
  return ix;
}

const sameWith = (wild: string) => (a: string, b: string) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && a[i] !== wild && b[i] !== wild) return false;
  return true;
};

/**
 * Edit distance between `a` and `b`, where `wild` matches anything; `bound + 1` once it is
 * sure to be more than `bound`. `p` and `q` are rows at least `b.length + 1` long.
 */
function distance(a: string, b: string, wild: string, bound: number, p: Int32Array, q: Int32Array): number {
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  for (let j = 0; j <= b.length; j++) p[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const x = a[i - 1];
    q[0] = i;
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const y = b[j - 1];
      const v = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (x === y || x === wild || y === wild ? 0 : 1));
      q[j] = v;
      if (v < low) low = v;
    }
    if (low > bound) return bound + 1;
    const t = p;
    p = q;
    q = t;
  }
  return p[b.length];
}

/** The search itself, pausing every few thousand comparisons. */
function* search({ versions, query, wild, exact }: VersionSearch): Generator<void, VersionMatch | null> {
  if (!versions.length) return null;
  const same = sameWith(wild);
  const rows = (longest: number) => [new Int32Array(Math.max(query.length, longest) + 2), new Int32Array(Math.max(query.length, longest) + 2)];

  if (versions.length < INDEX_FROM) {
    if (exact) {
      const hits = versions.flatMap((v, i) => (same(v.bases, query) ? [i] : []));
      return hits.length ? { versions: hits, distance: 0 } : null;
    }
    const [p, q] = rows(Math.max(...versions.map(v => v.bases.length)));
    let best = Infinity;
    let out: number[] = [];
    versions.forEach((v, i) => {
      const d = distance(v.bases, query, wild, best, p, q);
      if (d < best) {
        best = d;
        out = [i];
      } else if (d === best) out.push(i);
    });
    return { versions: out, distance: best };
  }

  const ix = yield* indexOf(versions, wild);
  const uncertain = !!wild && query.includes(wild);
  // The clone's own sequence: a lookup, unless its wildcards make it a comparison.
  const exactly = uncertain
    ? (ix.byLength.get(query.length) ?? []).filter(i => same(versions[i].bases, query))
    : [...(ix.exact.get(query) ?? []), ...ix.wild.filter(i => same(versions[i].bases, query))].sort((a, b) => a - b);
  if (exactly.length) return { versions: exactly, distance: 0 };
  if (exact) return null;

  const [p, q] = rows(ix.longest);
  if (!uncertain) {
    // One change away: every substitution, deletion and insertion of the clone, looked up.
    const near = new Set<number>();
    const look = (s: string) => {
      for (const i of ix.exact.get(s) ?? []) near.add(i);
    };
    for (let at = 0; at <= query.length; at++) {
      const head = query.slice(0, at);
      if (at < query.length) {
        const tail = query.slice(at + 1);
        look(head + tail);
        for (const c of ix.letters) if (c !== query[at]) look(head + c + tail);
      }
      for (const c of ix.letters) look(head + c + query.slice(at));
    }
    for (const i of ix.wild) if (distance(versions[i].bases, query, wild, 1, p, q) <= 1) near.add(i);
    if (near.size) return { versions: [...near].sort((a, b) => a - b), distance: 1 };
  }

  // Further: lengths nearest first, until the difference in length alone is too much.
  let best = Infinity;
  let out: number[] = [];
  let steps = 0;
  const lengths = [...ix.lengths].sort((a, b) => Math.abs(a - query.length) - Math.abs(b - query.length) || a - b);
  for (const length of lengths) {
    if (Math.abs(length - query.length) > best) break;
    for (const i of ix.byLength.get(length)!) {
      if (++steps % STEP === 0) yield;
      const d = distance(versions[i].bases, query, wild, best, p, q);
      if (d < best) {
        best = d;
        out = [i];
      } else if (d === best) out.push(i);
    }
  }
  return { versions: out.sort((a, b) => a - b), distance: best };
}

/**
 * A search run a little at a time: each step does a few thousand comparisons, so a caller
 * can draw between them. Returns what `matchVersion` would, and remembers it for that.
 */
export function* searchVersion(s: VersionSearch): Generator<void, VersionMatch | null> {
  const key = `${s.exact ? "=" : "~"}${s.wild}:${s.query}`;
  const done = found.get(s.versions) ?? new Map<string, VersionMatch | null>();
  found.set(s.versions, done);
  if (done.has(key)) return done.get(key)!;
  const result = yield* search(s);
  done.set(key, result);
  return result;
}

/**
 * The version a clone's sequence is: with `exact`, only one it is letter for letter (null
 * if none), else the closest. `wild` (X for amino acids) stands for anything, in a version
 * or in the clone's sequence (a codon with an uncertain base).
 */
export function matchVersion(versions: Version[], query: string, o: { wild?: string; exact?: boolean } = {}): VersionMatch | null {
  const steps = searchVersion({ versions, query, wild: o.wild ?? "", exact: !!o.exact });
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** "v2", "v2 or v7", "v2, v7 or v9", "v2, v7 or 3 more": versions that are as close. */
export function versionNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} or ${names[2]}`;
  return `${names[0]}, ${names[1]} or ${(names.length - 2).toLocaleString("en-GB")} more`;
}
