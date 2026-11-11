// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { PersonalEnzymes, formatPersonalEnzymes, parsePersonalEnzymes, type PersonalEnzymeStorage } from "./personalEnzymes.ts";
import { enzymePreferences, findCutSites, reactionEnzymes, rescanSites, scanSites, selectSites, type EnzymeFilter, type EnzymeOptions, type EnzymeSource } from "./enzymes.ts";
import { prunePick } from "./enzymePick.ts";

const options = (enzymeSource: EnzymeSource = "personal", enzymeFilter: EnzymeFilter = "all"): EnzymeOptions => ({ enzymeSource, enzymeFilter, labEnzymes: ["EcoRI"], personalEnzymes: ["EcoRI", "BamHI", "HindIII"] });
const sequence = "TTGAATTCTTGAATTCTTGAATTCTTGGATCCTTGGATCCTTAAGCTTTT";

test("each source has independent membership and supports every cut filter", () => {
  for (const source of ["common", "lab", "personal"] as const) {
    const enzymes = (filter: EnzymeFilter) => [...new Set(findCutSites(sequence, false, options(source, filter)).map(c => c.enzyme).filter(n => ["EcoRI", "BamHI", "HindIII"].includes(n)))];
    assert.deepEqual(enzymes("unique"), source === "lab" ? [] : ["HindIII"]);
    assert.deepEqual(enzymes("unique6"), enzymes("unique"));
    assert.deepEqual(enzymes("unique2"), source === "lab" ? [] : ["BamHI", "HindIII"]);
    assert.ok(enzymes("all").includes("EcoRI"));
  }
  assert.deepEqual(findCutSites(sequence, false, { ...options(), personalEnzymes: [] }), []);
  assert.deepEqual(findCutSites(sequence, false, { ...options("lab"), labEnzymes: [] }), []);
});

test("personal names preserve aliases and cuts, and 6+ includes non-common names", () => {
  const o = { ...options("personal", "unique6"), personalEnzymes: ["Acc65I", "Esp3I"] };
  const sites = findCutSites("TTTTTGGTACCTTTTTCGTCTCTTTTTTTTTTTT", false, o);
  assert.deepEqual(sites.map(c => c.enzyme), ["Acc65I", "Esp3I"]);
  assert.equal(sites[0].cut, 6);
  assert.equal(sites[0].overhang.length, 4);
  assert.ok(!sites.some(c => c.enzyme === "KpnI" || c.enzyme === "BsmBI"));
});

test("personal sites cross the origin, include reverse hits, and rescan after edits", () => {
  const o = { ...options(), personalEnzymes: ["EcoRI", "BsaI", "Acc65I"] };
  const before = "AATTCTTTGAGACCTTTG";
  const sites = findCutSites(before, true, o);
  assert.ok(sites.some(c => c.enzyme === "EcoRI" && c.start > c.end));
  assert.ok(sites.some(c => c.enzyme === "BsaI" && !c.forward));
  const after = before.slice(0, 10) + "GGTACC" + before.slice(10);
  const hits = scanSites(before, true, o.personalEnzymes);
  assert.deepEqual(selectSites(rescanSites({ sequence: before, circular: true, hits }, after, true, o.personalEnzymes), o), findCutSites(after, true, o));
});

test("filter changes prune picks using complete enzyme cut counts", () => {
  const hits = findCutSites(sequence, false, options());
  const site = hits.find(c => c.enzyme === "EcoRI")!;
  const picked = { range: { start: site.start, end: site.end }, caret: 0, focus: { kind: "cutsite" as const, id: site.id }, enzymes: ["EcoRI", "HindIII"] };
  const next = prunePick(picked, findCutSites(sequence, false, options("personal", "unique")));
  assert.equal(next?.site?.enzyme, "HindIII");
  assert.deepEqual(next?.enzymes, ["HindIII"]);
});

test("legacy preferences migrate and explicit new choices keep visibility independent", () => {
  const cases = [
    ["unique6", "common", "unique6", true], ["unique", "common", "unique", true], ["unique2", "common", "unique2", true],
    ["lab1", "lab", "unique", true], ["lab2", "lab", "unique2", true], ["lab", "lab", "all", true], ["none", "common", "unique6", false]
  ] as const;
  for (const [enzymeSet, enzymeSource, enzymeFilter, cutsites] of cases)
    assert.deepEqual(enzymePreferences({ enzymeSet }), { enzymeSource, enzymeFilter, cutsites });
  assert.deepEqual(enzymePreferences({ enzymeSource: "personal", enzymeFilter: "all" }), { enzymeSource: "personal", enzymeFilter: "all", cutsites: true });
  // A visibility saved by an earlier build doesn't override the setting for new files.
  assert.deepEqual(enzymePreferences({ enzymeSource: "lab", cutsites: false } as Parameters<typeof enzymePreferences>[0], true).cutsites, true);
  assert.deepEqual(enzymePreferences({ enzymeSource: "bad", enzymeFilter: "bad" }, false), { enzymeSource: "common", enzymeFilter: "unique6", cutsites: false });
});

test("reaction lists retain selected enzymes even outside membership, search and cut limits", () => {
  const counts = new Map([["EcoRI", 3], ["BamHI", 2], ["HindIII", 1]]);
  assert.deepEqual(reactionEnzymes(counts, ["BamHI"], ["EcoRI", "Acc65I"], 1, "hind"), ["Acc65I", "EcoRI"]);
  assert.deepEqual(reactionEnzymes(counts, ["BamHI", "HindIII"], [], 1), ["HindIII"]);
  assert.deepEqual(reactionEnzymes(counts, [], []), []);
});

function storage(initial: string | null = null) {
  let raw = initial;
  let notify = () => {};
  const kept: string[] = [];
  let failSave = false;
  const backend: PersonalEnzymeStorage = {
    load: async () => raw,
    save: async text => { if (failSave) throw new Error("Disk full"); raw = text; },
    setAside: async () => { if (raw !== null) kept.push(raw); raw = null; return "backup.json"; },
    listen: async fn => { notify = fn; return () => {}; }
  };
  return { backend, kept, raw: () => raw, fail: (value: boolean) => { failSave = value; }, external: (text: string) => { raw = text; notify(); } };
}

test("saved personal lists normalise duplicates and retain unknown names", () => {
  assert.deepEqual(parsePersonalEnzymes(formatPersonalEnzymes([" ecori ", "EcoRI", "acc65i", "NewEnzI"])), ["Acc65I", "EcoRI", "NewEnzI"]);
  for (const text of ['{broken', '{"version":2,"enzymes":[]}', '{"version":1,"enzymes":[4]}', '{"version":1,"enzymes":[""]}']) assert.throws(() => parsePersonalEnzymes(text));
});

test("personal list saves serially, survives reopening and keeps known name references stable", async () => {
  const s = storage(formatPersonalEnzymes(["NewEnzI"]));
  const list = new PersonalEnzymes(s.backend);
  await list.ready;
  await Promise.all([list.set("EcoRI", true), list.set("Acc65I", true)]);
  assert.deepEqual(list.all, ["Acc65I", "EcoRI", "NewEnzI"]);
  assert.deepEqual(list.names, ["Acc65I", "EcoRI"]);
  const names = list.names;
  await list.set("ecori", true);
  await list.set("NewEnzI", false);
  assert.equal(list.names, names);
  const reopened = new PersonalEnzymes(s.backend);
  await reopened.ready;
  assert.deepEqual(reopened.all, ["Acc65I", "EcoRI"]);
});

test("failed saves keep the published and saved list, and later writes still succeed", async () => {
  const s = storage(formatPersonalEnzymes(["EcoRI"]));
  const list = new PersonalEnzymes(s.backend);
  await list.ready;
  const names = list.names;
  s.fail(true);
  await assert.rejects(list.set("BamHI", true), /Disk full/);
  assert.equal(list.names, names);
  assert.deepEqual(parsePersonalEnzymes(s.raw()!), ["EcoRI"]);
  s.fail(false);
  await list.set("BamHI", true);
  assert.deepEqual(list.names, ["BamHI", "EcoRI"]);
});

test("external changes reach subscribers and an edit preserves other windows' additions", async () => {
  const s = storage();
  const list = new PersonalEnzymes(s.backend);
  await list.ready;
  let changed = 0;
  const off = list.onChange(() => changed++);
  s.external(formatPersonalEnzymes(["HindIII"]));
  await list.reload();
  assert.deepEqual(list.names, ["HindIII"]);
  assert.ok(changed > 0);
  await list.set("EcoRI", true);
  assert.deepEqual(list.names, ["EcoRI", "HindIII"]);
  off();
});

test("unreadable storage blocks writes until recovery preserves the old file", async () => {
  const s = storage("{damaged");
  const list = new PersonalEnzymes(s.backend);
  await list.ready;
  assert.ok(list.error);
  await assert.rejects(list.set("EcoRI", true), /Couldn't read/);
  assert.equal(s.raw(), "{damaged");
  await list.startNew();
  assert.deepEqual(s.kept, ["{damaged"]);
  assert.equal(list.error, "");
  await list.set("EcoRI", true);
  assert.deepEqual(list.names, ["EcoRI"]);
});
