// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { pcrProgram } from "./pcrProgram.ts";
import { PCR_PROTOCOLS, templatesFor } from "./pcrProtocols.ts";
import {
  acceptProgramValue,
  cancelProgramValue,
  editedProgramText,
  MAX_CYCLES,
  MAX_SECONDS,
  MAX_TEMP,
  MIN_TEMP,
  parseProgramValue,
  programInputKey,
  programDraft,
  programKey,
  programRows,
  PROGRAM_LIMITS,
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
  assert.equal(MIN_TEMP, 4);
  assert.equal(MAX_TEMP, 100);
  assert.equal(parseProgramValue("temp", "980"), null);
  assert.equal(parseProgramValue("temp", "-5"), null);
  assert.equal(parseProgramValue("temp", "0"), null);
  // Either side of each end: 4 °C is where a hold step sits, and 100 °C is as hot as it goes.
  assert.equal(parseProgramValue("temp", "3.9"), null);
  assert.equal(parseProgramValue("temp", "4"), 4);
  assert.equal(parseProgramValue("temp", "4.1"), 4.1);
  assert.equal(parseProgramValue("temp", "99.9"), 99.9);
  assert.equal(parseProgramValue("temp", "100"), 100);
  assert.equal(parseProgramValue("temp", "100.1"), null);
  assert.equal(parseProgramValue("temp", String(MIN_TEMP)), MIN_TEMP);
  assert.equal(parseProgramValue("temp", String(MAX_TEMP)), MAX_TEMP);
  assert.equal(parseProgramValue("temp", "98.5"), 98.5);
  const d = programDraft(snapshot());
  d.values[programKey(1, 0, "temp")] = "980";
  assert.equal(editedProgramText(d), null);
});

test("cycles are whole numbers from 1 to 99", () => {
  assert.equal(MAX_CYCLES, 99);
  assert.equal(parseProgramValue("cycles", "0"), null);
  assert.equal(parseProgramValue("cycles", "1"), 1);
  assert.equal(parseProgramValue("cycles", "99"), 99);
  assert.equal(parseProgramValue("cycles", "100"), null);
  assert.equal(parseProgramValue("cycles", "3000"), null);
  assert.equal(parseProgramValue("cycles", "99999999999999999999"), null);
  assert.equal(parseProgramValue("cycles", "25.5"), null);
  const d = programDraft(snapshot());
  d.values[programKey(1, 0, "cycles")] = "3000";
  assert.equal(editedProgramText(d), null);
  assert.deepEqual(readProgram(d).errors, [programKey(1, 0, "cycles")]);
  d.values[programKey(1, 0, "cycles")] = "99";
  assert.match(editedProgramText(d)!, /99 cycles:/);
});

test("a step lasts at most 60 minutes, however it is written", () => {
  assert.equal(MAX_SECONDS, 3600);
  assert.equal(parseProgramValue("seconds", "3600"), 3600);
  assert.equal(parseProgramValue("seconds", "60 min"), 3600);
  assert.equal(parseProgramValue("seconds", "59 min 59 s"), 3599);
  assert.equal(parseProgramValue("seconds", "3600.5"), null);
  assert.equal(parseProgramValue("seconds", "60 min 1 s"), null);
  assert.equal(parseProgramValue("seconds", "61 min"), null);
  assert.equal(parseProgramValue("seconds", "99999999999999999999"), null);
  assert.equal(parseProgramValue("seconds", "0"), null);
  assert.equal(parseProgramValue("seconds", "0.5"), 0.5);
  const d = programDraft(snapshot());
  d.values[programKey(1, 1, "seconds")] = "99999999999999999999";
  assert.equal(editedProgramText(d), null);
});

test("a comma is not a decimal point, and the message says to use one", () => {
  // The app reads commas as thousands, so "58,5" is refused rather than read as 585 or 58.5.
  assert.equal(parseProgramValue("temp", "58,5"), null);
  assert.equal(parseProgramValue("seconds", "1,5"), null);
  assert.equal(parseProgramValue("seconds", "1,5 min"), null);
  assert.equal(parseProgramValue("cycles", "2,5"), null);
  assert.equal(parseProgramValue("cycles", "1,000"), null);
  assert.equal(parseProgramValue("temp", "58.5"), 58.5);
  const d = programDraft(snapshot());
  d.values[programKey(1, 1, "temp")] = "58,5";
  assert.deepEqual(readProgram(d).errors, [programKey(1, 1, "temp")]);
  assert.equal(PROGRAM_LIMITS, "Temperatures 4–100 °C, 1–99 whole cycles, steps up to 60 min. Use a point for decimals.");
  // Ranges are written with a dash, not as "from 4 to 100".
  assert.doesNotMatch(PROGRAM_LIMITS, /\bfrom \d+ to \d+/);
});

test("every program the protocols generate is within its own limits", () => {
  for (const [polymerase] of Object.entries(PCR_PROTOCOLS))
    for (const template of templatesFor(polymerase))
      for (const length of [60, 878, 5000, 20000])
        for (const twoStage of [false, true]) {
          const stages = pcrProgram({ polymerase, template, length, ta: 66, taFull: 72, twoStage });
          if (!stages) continue;
          const draft = programDraft({ ...snapshot(), stages });
          assert.deepEqual(readProgram(draft).errors, [], `${polymerase} ${template} ${length} bp`);
          assert.equal(readProgram(draft).modified, false);
        }
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
