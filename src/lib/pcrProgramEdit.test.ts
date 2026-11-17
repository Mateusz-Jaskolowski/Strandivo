// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { pcrProgram } from "./pcrProgram.ts";
import {
  acceptProgramValue,
  cancelProgramValue,
  editedProgramText,
  MAX_TEMP,
  MIN_TEMP,
  parseProgramValue,
  programInputKey,
  programDraft,
  programKey,
  programRows,
  programTemperatureY,
  readProgram,
  syncProgram,
  type ProgramSnapshot
} from "./pcrProgramEdit.ts";

const snapshot = (key = "q5", twoStage = false): ProgramSnapshot => ({
  key,
  title: "Q5 (NEB M0491), 878 bp",
  source: "Q5 · NEB M0491",
  context: "Plasmid · 878 bp",
  stages: pcrProgram({ polymerase: "q5", template: "plasmid", length: 878, ta: 66, taFull: 72, twoStage })!
});

test("cancel restores the last accepted field even after an external redraw", () => {
  const d = programDraft(snapshot()),
    key = programKey(1, 1, "seconds");
  d.values[key] = "45 s";
  acceptProgramValue(d, key);
  d.values[key] = "unfinished";
  acceptProgramValue(d, key);
  assert.equal(syncProgram(d, snapshot("changed")), d);
  assert.equal(cancelProgramValue(d, key), true);
  assert.equal(d.values[key], "45 s");
  assert.equal(cancelProgramValue(d, key), false);
});

test("edited temperatures, durations and counts are copied from the current raw fields", () => {
  const original = snapshot(),
    d = programDraft(original);
  d.values[programKey(1, 1, "temp")] = "64.5";
  d.values[programKey(1, 1, "seconds")] = "1 min 30 s";
  d.values[programKey(1, 0, "cycles")] = "30";
  const result = readProgram(d);
  assert.deepEqual(result.errors, []);
  assert.equal(result.modified, true);
  assert.equal(result.stages[1].steps[1].temp, 64.5);
  assert.match(editedProgramText(d)!, /Modified PCR program; based on Q5 \(NEB M0491\)/);
  assert.match(editedProgramText(d)!, /30 cycles:\n.*\n  Anneal: 64.5 °C, 1 min 30 s/);
  assert.equal(original.stages[1].steps[1].temp, 66);
  d.values[programKey(1, 1, "seconds")] = "90.1";
  assert.match(editedProgramText(d)!, /90.1 s/);
});

test("unfinished and invalid fields prevent copying and survive input changes", () => {
  const d = programDraft(snapshot());
  for (const bad of ["", "-", "NaN", "Infinity", "0x10"]) {
    d.values[programKey(1, 1, "temp")] = bad;
    assert.equal(editedProgramText(d), null, bad);
    assert.equal(syncProgram(d, snapshot("changed")), d);
    assert.equal(syncProgram(d, null), d);
  }
  assert.equal(parseProgramValue("seconds", "0 s"), null);
  assert.equal(parseProgramValue("seconds", "-20"), null);
  assert.equal(parseProgramValue("seconds", "2 min junk"), null);
  assert.equal(parseProgramValue("cycles", "25.5"), null);
  assert.equal(parseProgramValue("cycles", "0"), null);
  assert.equal(parseProgramValue("seconds", "1m 30sec"), 90);
  assert.equal(parseProgramValue("seconds", "20.5"), 20.5);
});

test("a temperature outside a cycler's range is a slip, not a program", () => {
  assert.equal(parseProgramValue("temp", "980"), null);
  assert.equal(parseProgramValue("temp", "-5"), null);
  assert.equal(parseProgramValue("temp", String(MIN_TEMP)), MIN_TEMP);
  assert.equal(parseProgramValue("temp", String(MAX_TEMP)), MAX_TEMP);
  assert.equal(parseProgramValue("temp", "98.5"), 98.5);
  const d = programDraft(snapshot());
  d.values[programKey(1, 0, "temp")] = "980";
  assert.equal(editedProgramText(d), null);
});

test("the program's key follows what the program is made from, and nothing else", () => {
  const input = { polymerase: "q5", template: "plasmid", length: 878, ta: 66, taFull: 72 } as const;
  assert.equal(programInputKey(input), programInputKey({ ...input, twoStage: false }));
  for (const other of [{ polymerase: "taq" }, { template: "colony" }, { length: 879 }, { ta: 65 }, { taFull: 71 }, { twoStage: true }] as const) {
    assert.notEqual(programInputKey({ ...input, ...other }), programInputKey(input), JSON.stringify(other));
  }
  // A primer renamed, or a Tm setting that leaves the annealing temperature where it was,
  // makes the same program, so an edited one is not reported as made for another setup.
  assert.equal(syncProgram(programDraft(snapshot(programInputKey(input))), snapshot(programInputKey(input)))!.original.key, programInputKey(input));
});

test("untouched programs follow inputs; custom programs keep their baseline and provenance", () => {
  const first = snapshot(),
    next = { ...snapshot("onetaq"), title: "OneTaq (NEB M0481)", source: "OneTaq" };
  const d = programDraft(first);
  assert.equal(syncProgram(d, first), d);
  assert.equal(syncProgram(d, next)!.original, next);
  d.values[programKey(1, 1, "seconds")] = "30 s";
  assert.equal(syncProgram(d, next), d);
  assert.match(editedProgramText(d)!, /Q5 \(NEB M0491\)/);
  assert.doesNotMatch(editedProgramText(d)!, /OneTaq/);
  const reset = programDraft(next);
  assert.equal(readProgram(reset).modified, false);
  assert.equal(syncProgram(reset, null), null);
});

test("equivalent formatting does not mark a program modified; both stages edit independently", () => {
  const d = programDraft(snapshot("two", true));
  d.values[programKey(1, 0, "temp")] = "98.0";
  d.values[programKey(2, 1, "seconds")] = "0 min 15 s";
  assert.equal(readProgram(d).modified, false);
  d.values[programKey(1, 0, "cycles")] = "4";
  d.values[programKey(2, 0, "cycles")] = "26";
  d.values[programKey(2, 1, "seconds")] = "45";
  assert.match(editedProgramText(d)!, /4 cycles:/);
  assert.match(editedProgramText(d)!, /26 cycles:/);
  assert.match(editedProgramText(d)!, /Anneal and extend: 72 °C, 45 s/);
  assert.equal(readProgram(d).stages.at(-1)!.steps.at(-1)!.seconds, null);
});

test("line layout wraps whole cycle groups and bounds the labels at supported widths", () => {
  for (const twoStage of [false, true])
    for (const width of [278, 320, 480, 720]) {
      const stages = snapshot("layout", twoStage).stages;
      const rows = programRows(stages, width);
      assert.equal(rows.flatMap(r => r.steps).length, stages.flatMap(s => s.steps).length);
      for (const row of rows) {
        assert.ok(row.width <= width + 0.01);
        for (const p of row.steps) assert.ok(p.width >= 88 && p.x >= 0 && p.x + p.width <= row.width);
      }
      for (const st of stages) for (const s of st.steps) assert.ok(programTemperatureY(s.temp, stages) >= 53 && programTemperatureY(s.temp, stages) <= 163);
    }
});
