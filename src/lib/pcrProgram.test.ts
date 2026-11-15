// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The cycling program against NEB's protocols (src/lib/pcrProtocols.ts). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { NEB_POLYMERASES } from "./polymerases.ts";
import { PCR_PROTOCOLS, templatesFor } from "./pcrProtocols.ts";
import { durationText, extensionSeconds, FIRST_CYCLES, offerTwoStages, pcrProgram, programNotes, programText, templateNotes } from "./pcrProgram.ts";

const steps = (st: ReturnType<typeof pcrProgram>, i: number) => st![i].steps.map(s => [s.name, s.temp, s.seconds]);

test("Q5 on a plasmid follows NEB's routine conditions", () => {
  const p = pcrProgram({ polymerase: "q5", template: "plasmid", length: 737, ta: 64.6 })!;
  assert.equal(p.length, 3);
  assert.deepEqual(steps(p, 0), [["Initial denaturation", 98, 30]]);
  assert.equal(p[1].cycles, 25);
  // 737 bp at 20 s/kb is 14.7 s, up to the next 5.
  assert.deepEqual(steps(p, 1), [["Denature", 98, 10], ["Anneal", 65, 20], ["Extend", 72, 15]]);
  assert.deepEqual(steps(p, 2), [["Final extension", 72, 120], ["Hold", 4, null]]);
});

test("a complex template gets more cycles and a longer extension", () => {
  const p = pcrProgram({ polymerase: "q5", template: "complex", length: 2000, ta: 60 })!;
  assert.equal(p[1].cycles, 30);
  assert.equal(p[1].steps[2].seconds, 60);
  assert.equal(pcrProgram({ polymerase: "q5", template: "plasmid", length: 2000, ta: 60 })![1].steps[2].seconds, 40);
});

test("Q5 extends longer past 6 kb, and never for less than 10 s", () => {
  const q5 = PCR_PROTOCOLS.q5;
  assert.equal(extensionSeconds(q5, "plasmid", 6000), 120);
  assert.equal(extensionSeconds(q5, "plasmid", 8000), 360);
  assert.equal(extensionSeconds(q5, "plasmid", 200), 10);
});

test("annealing and extension become one step from the polymerase's temperature", () => {
  const at = (polymerase: string, ta: number) => pcrProgram({ polymerase, template: "plasmid", length: 1000, ta })![1].steps.map(s => s.name);
  assert.deepEqual(at("q5", 71.4), ["Denature", "Anneal", "Extend"]);
  assert.deepEqual(at("q5", 71.6), ["Denature", "Anneal and extend"]);
  assert.deepEqual(at("onetaq", 67), ["Denature", "Anneal", "Extend"]);
  assert.deepEqual(at("onetaq", 68), ["Denature", "Anneal and extend"]);
  // NEB: above 65 °C for Taq.
  assert.deepEqual(at("taq", 65), ["Denature", "Anneal", "Extend"]);
  assert.deepEqual(at("taq", 66), ["Denature", "Anneal and extend"]);
  const merged = pcrProgram({ polymerase: "q5", template: "plasmid", length: 1000, ta: 72 })![1].steps[1];
  assert.deepEqual([merged.temp, merged.seconds], [72, 20]);
});

test("Phusion, OneTaq and Taq follow their own protocols", () => {
  const ph = pcrProgram({ polymerase: "phusion", template: "plasmid", length: 2000, ta: 62 })!;
  assert.deepEqual(steps(ph, 0), [["Initial denaturation", 98, 30]]);
  assert.deepEqual(steps(ph, 1), [["Denature", 98, 10], ["Anneal", 62, 20], ["Extend", 72, 30]]);
  assert.deepEqual(steps(ph, 2)[0], ["Final extension", 72, 300]);
  const one = pcrProgram({ polymerase: "onetaq", template: "plasmid", length: 2000, ta: 55 })!;
  assert.deepEqual(steps(one, 0), [["Initial denaturation", 94, 30]]);
  assert.deepEqual(steps(one, 1), [["Denature", 94, 20], ["Anneal", 55, 30], ["Extend", 68, 120]]);
  assert.deepEqual(steps(one, 2)[0], ["Final extension", 68, 600]);
  const taq = pcrProgram({ polymerase: "taq", template: "plasmid", length: 1500, ta: 55 })!;
  assert.deepEqual(steps(taq, 0), [["Initial denaturation", 95, 30]]);
  assert.deepEqual(steps(taq, 1), [["Denature", 95, 20], ["Anneal", 55, 30], ["Extend", 68, 90]]);
  assert.deepEqual(steps(taq, 2)[0], ["Final extension", 68, 300]);
  assert.equal(pcrProgram({ polymerase: "onetaq-gc", template: "plasmid", length: 500, ta: 55 })![1].steps[2].temp, 68);
});

test("a colony gets the long first denaturation where NEB gives one", () => {
  assert.equal(pcrProgram({ polymerase: "taq", template: "colony", length: 500, ta: 55 })![0].steps[0].seconds, 300);
  assert.equal(pcrProgram({ polymerase: "onetaq", template: "colony", length: 500, ta: 55 })![0].steps[0].seconds, 180);
  assert.deepEqual(templatesFor("taq"), ["plasmid", "complex", "colony"]);
  assert.deepEqual(templatesFor("q5"), ["plasmid", "complex"]);
  assert.deepEqual(templatesFor("phusion"), ["plasmid", "complex"]);
});

test("two stages: the first cycles anneal on the pairing parts, the rest on the whole primers", () => {
  const p = pcrProgram({ polymerase: "q5", template: "plasmid", length: 737, ta: 65, taFull: 72, twoStage: true })!;
  assert.equal(p.length, 4);
  assert.equal(p[1].cycles, FIRST_CYCLES);
  assert.equal(p[2].cycles, 25 - FIRST_CYCLES);
  assert.deepEqual(steps(p, 1), [["Denature", 98, 10], ["Anneal", 65, 20], ["Extend", 72, 15]]);
  // 72 °C is where Q5 anneals and extends in one step.
  assert.deepEqual(steps(p, 2), [["Denature", 98, 10], ["Anneal and extend", 72, 15]]);
  // Without the flag, or without a second temperature, there is one stage.
  assert.equal(pcrProgram({ polymerase: "q5", template: "plasmid", length: 737, ta: 65, taFull: 72 })!.length, 3);
  assert.equal(pcrProgram({ polymerase: "q5", template: "plasmid", length: 737, ta: 65, twoStage: true })!.length, 3);
});

test("a second stage is offered when the whole primers anneal 5 °C higher", () => {
  assert.equal(offerTwoStages(65, 70), true);
  assert.equal(offerTwoStages(65, 69.4), false);
  assert.equal(offerTwoStages(65, 69.6), true);
  assert.equal(offerTwoStages(65, null), false);
});

test("a polymerase with no protocol has no program", () => {
  assert.equal(pcrProgram({ polymerase: "q5u", template: "plasmid", length: 500, ta: 60 }), null);
  assert.deepEqual(programNotes("q5u", 500, "plasmid"), []);
  // Every polymerase with a protocol is one the Tm method knows.
  for (const id of Object.keys(PCR_PROTOCOLS)) assert.ok(NEB_POLYMERASES.some(p => p.id === id), id);
});

test("durations read as people say them", () => {
  assert.equal(durationText(30), "30 s");
  assert.equal(durationText(60), "1 min");
  assert.equal(durationText(90), "1 min 30 s");
  assert.equal(durationText(600), "10 min");
});

test("the program as text", () => {
  const p = pcrProgram({ polymerase: "q5", template: "plasmid", length: 737, ta: 65 })!;
  assert.equal(
    programText(p, "Q5 High-Fidelity, 737 bp"),
    [
      "Q5 High-Fidelity, 737 bp",
      "Initial denaturation: 98 °C, 30 s",
      "25 cycles:",
      "  Denature: 98 °C, 10 s",
      "  Anneal: 65 °C, 20 s",
      "  Extend: 72 °C, 15 s",
      "Final extension: 72 °C, 2 min",
      "Hold: 4 °C"
    ].join("\n")
  );
});

test("the notes say what the choices change", () => {
  const t = templateNotes("taq");
  assert.deepEqual(t.map(n => n.label), ["Plasmid", "Genomic DNA or cDNA", "Colony"]);
  assert.match(t[2].text, /5 min at 95 °C, then 30 cycles/);
  assert.equal(templateNotes("q5").length, 2);
  const n = programNotes("q5", 737, "plasmid");
  assert.match(n[1], /20 s for each kb of product at 72 °C, so 737 bp gets 15 s/);
});
