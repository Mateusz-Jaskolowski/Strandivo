// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Matching a clone to a region's versions. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchVersion, searchVersion, slowToMatch, versionNames, type Version } from "./versionMatch.ts";

/** Every version compared in full: what the index must always agree with. */
function slowly(versions: Version[], query: string, wild = "", exact = false) {
  const same = (x: string, y: string) => x === y || x === wild || y === wild;
  const distance = (a: string, b: string) => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (same(a[i - 1], b[j - 1]) ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  };
  const d = versions.map(v => distance(v.bases, query));
  const best = Math.min(...d);
  if (exact && best > 0) return null;
  return { versions: d.flatMap((x, i) => (x === best ? [i] : [])), distance: best };
}

let seed = 11;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};
const word = (letters: string, length: number) => Array.from({ length }, () => letters[Math.floor(random() * letters.length)]).join("");
/** A copy of `s` with `n` random substitutions, insertions or deletions. */
function changed(s: string, n: number, letters: string): string {
  for (let k = 0; k < n; k++) {
    const at = Math.floor(random() * (s.length + 1));
    const kind = Math.floor(random() * 3);
    const c = letters[Math.floor(random() * letters.length)];
    s = kind === 0 && at < s.length ? s.slice(0, at) + c + s.slice(at + 1) : kind === 1 || at >= s.length ? s.slice(0, at) + c + s.slice(at) : s.slice(0, at) + s.slice(at + 1);
  }
  return s;
}

test("the index finds what comparing every version finds, ties included", () => {
  // Short words in a small alphabet, so clones are often as close to several versions.
  for (const [letters, wild] of [["ACGT", ""], ["ACDEFGHIKLMNPQRSTVWY", "X"], ["AGS", "X"]] as const) {
    for (let round = 0; round < 6; round++) {
      const versions: Version[] = Array.from({ length: 200 + Math.floor(random() * 200) }, (_, i) => ({ name: `v${i + 1}`, bases: word(letters, 3 + Math.floor(random() * 6)) }));
      // Some versions with a wildcard, some repeated.
      if (wild) for (let i = 0; i < 10; i++) versions[Math.floor(random() * versions.length)].bases += wild;
      versions.push({ ...versions[5], name: "again" });
      for (let q = 0; q < 60; q++) {
        let query = q % 4 === 3 ? word(letters, 2 + Math.floor(random() * 9)) : changed(versions[Math.floor(random() * versions.length)].bases.replace(wild || "_", ""), q % 4, letters);
        if (wild && q % 7 === 0) query = query.slice(0, 1) + wild + query.slice(2);
        if (!query) continue;
        assert.deepEqual(matchVersion(versions, query, { wild }), slowly(versions, query, wild), `${query} among ${letters}`);
        assert.deepEqual(matchVersion(versions, query, { wild, exact: true }), slowly(versions, query, wild, true), `${query} exactly`);
      }
    }
  }
});

test("a short list is compared version by version, with the same answers", () => {
  const versions = [
    { name: "v1", bases: "GFTFSSYA" },
    { name: "v2", bases: "GRTFSNYA" },
    { name: "v3", bases: "GFTFSSYA" },
    { name: "open", bases: "GXTFSSYA" }
  ];
  assert.deepEqual(matchVersion(versions, "GFTFSSYA", { wild: "X" }), { versions: [0, 2, 3], distance: 0 });
  assert.deepEqual(matchVersion(versions, "GRTFSSYA", { wild: "X" }), { versions: [3], distance: 0 });
  assert.deepEqual(matchVersion(versions, "GRTFSSYW", { wild: "X" }), { versions: [3], distance: 1 });
  assert.deepEqual(matchVersion(versions, "GKTFSNYA", { wild: "X", exact: true }), null);
  // An uncertain residue in the clone matches whatever a version has there.
  assert.deepEqual(matchVersion(versions, "GXTFSNYA", { wild: "X", exact: true }), { versions: [1], distance: 0 });
  assert.equal(matchVersion([], "GFT"), null);
});

test("a long list is indexed once and finds a clone among a hundred thousand versions at once", () => {
  const letters = "ACDEFGHIKLMNPQRSTVWY";
  const versions = Array.from({ length: 100_000 }, (_, i) => ({ name: `v${i + 1}`, bases: word(letters, 6 + (i % 11)) }));
  matchVersion(versions, "MKV", { wild: "X" });
  const started = performance.now();
  const target = versions[77_777].bases;
  const one = target.slice(0, 2) + (target[2] === "W" ? "Y" : "W") + target.slice(3);
  const exact = matchVersion(versions, target, { wild: "X", exact: true })!;
  const near = matchVersion(versions, one, { wild: "X" })!;
  assert.ok(exact.versions.includes(77_777));
  assert.equal(near.distance, 1);
  assert.ok(near.versions.includes(77_777));
  assert.ok(performance.now() - started < 200, "lookups, not a hundred thousand comparisons");
});

test("a search run a step at a time pauses often, and its answer is kept", () => {
  const letters = "ACGT";
  const versions = Array.from({ length: 50_000 }, (_, i) => ({ name: `v${i + 1}`, bases: word(letters, 30 + (i % 20)) }));
  const query = word(letters, 40);
  const steps = searchVersion({ versions, query, wild: "", exact: false });
  let pauses = 0;
  let r = steps.next();
  for (; !r.done; r = steps.next()) pauses++;
  assert.ok(pauses > 5, `paused ${pauses} times`);
  assert.deepEqual(r.value, slowly(versions, query));
  // Asked again, the answer is there at once.
  const again = searchVersion({ versions, query, wild: "", exact: false }).next();
  assert.equal(again.done, true);
  assert.deepEqual(matchVersion(versions, query), r.value);
});

test("versions as close are named together", () => {
  assert.equal(versionNames(["v2"]), "v2");
  assert.equal(versionNames(["v2", "v7"]), "v2 or v7");
  assert.equal(versionNames(["v2", "v7", "v9"]), "v2, v7 or v9");
  assert.equal(versionNames(["v2", "v7", "v9", "v11", "v12"]), "v2, v7 or 3 more");
});

test("matching is slow from 15,000 versions of 20 amino acids, fewer if longer", () => {
  assert.equal(slowToMatch(15_000, 15_000 * 20), true);
  assert.equal(slowToMatch(14_000, 14_000 * 20), false);
  assert.equal(slowToMatch(100_000, 100_000 * 6), false);
  assert.equal(slowToMatch(170_000, 170_000 * 6), true);
  assert.equal(slowToMatch(1_700, 1_700 * 60), true);
  assert.equal(slowToMatch(1_600, 1_600 * 60), false);
  assert.equal(slowToMatch(0, 0), false);
});
