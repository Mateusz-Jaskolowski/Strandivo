// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The cycling program against NEB's protocols (src/lib/pcrProtocols.ts). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { NEB_POLYMERASES } from "./polymerases.ts";
import { PCR_PROTOCOLS, templatesFor } from "./pcrProtocols.ts";
import { durationText, extensionSeconds, FIRST_CYCLES, offerTwoStages, pcrProgram, programNotes, programSource, programText, programTitle, templateNotes, twoStagesPossible } from "./pcrProgram.ts";

const steps = (st: ReturnType<typeof pcrProgram>, i: number) => st![i].steps.map(s => [s.name, s.temp, s.seconds]);

test("Q5 on a plasmid follows NEB's routine conditions", () => {
  const p = pcrProgram({ polymerase: "q5", template: "plasmid", length: 737, ta: 64.6 })!;
  assert.equal(p.length, 3);
  assert.deepEqual(steps(p, 0), [["Initial denaturation", 98, 30]]);
  assert.equal(p[1].cycles, 25);
  // 737 bp at 15 s/kb is 11.1 s, up to the next 5.
  assert.deepEqual(steps(p, 1), [["Denature", 98, 10], ["Anneal", 65, 20], ["Extend", 72, 15]]);
  assert.deepEqual(steps(p, 2), [["Final extension", 72, 120], ["Hold", 4, null]]);
});

test("a complex template gets more cycles and a longer extension", () => {
  const p = pcrProgram({ polymerase: "q5", template: "complex", length: 2000, ta: 60 })!;
  assert.equal(p[1].cycles, 30);
  assert.equal(p[1].steps[2].seconds, 60);
  assert.equal(pcrProgram({ polymerase: "q5", template: "plasmid", length: 2000, ta: 60 })![1].steps[2].seconds, 30);
});

test("Q5 extends longer past 6 kb on either template, and never for less than 10 s", () => {
  const q5 = PCR_PROTOCOLS.q5;
  // A plasmid: 15 s/kb up to 6 kb, 30 s/kb above (the top of NEB's pDNA ranges).
  assert.equal(extensionSeconds(q5, "plasmid", 6000), 90);
  assert.equal(extensionSeconds(q5, "plasmid", 6001), 185);
  assert.equal(extensionSeconds(q5, "plasmid", 8000), 240);
  // Complex: 30 s/kb up to 6 kb, 45 s/kb above.
  assert.equal(extensionSeconds(q5, "complex", 6000), 180);
  assert.equal(extensionSeconds(q5, "complex", 6001), 275);
  assert.equal(extensionSeconds(q5, "complex", 8000), 360);
  assert.equal(extensionSeconds(q5, "plasmid", 200), 10);
});

test("Taq and OneTaq extend a short product for 45 s, as NEB advises below 1 kb", () => {
  for (const id of ["taq", "onetaq"]) {
    const p = PCR_PROTOCOLS[id];
    assert.equal(extensionSeconds(p, "plasmid", 200), 45, id);
    assert.equal(extensionSeconds(p, "plasmid", 500), 45, id);
    assert.equal(extensionSeconds(p, "plasmid", 800), 50, id);
    assert.equal(extensionSeconds(p, "complex", 1000), 60, id);
    assert.equal(extensionSeconds(p, "complex", 2000), 120, id);
  }
  // Q5 gives no such floor, so the program's own 10 s stays.
  assert.equal(extensionSeconds(PCR_PROTOCOLS.q5, "plasmid", 200), 10);
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
  assert.deepEqual([merged.temp, merged.seconds], [72, 15]);
});

test("Phusion, OneTaq and Taq follow their own protocols", () => {
  const ph = pcrProgram({ polymerase: "phusion", template: "plasmid", length: 2000, ta: 62 })!;
  assert.deepEqual(steps(ph, 0), [["Initial denaturation", 98, 30]]);
  assert.deepEqual(steps(ph, 1), [["Denature", 98, 10], ["Anneal", 62, 20], ["Extend", 72, 30]]);
  assert.deepEqual(steps(ph, 2)[0], ["Final extension", 72, 300]);
  const one = pcrProgram({ polymerase: "onetaq", template: "plasmid", length: 2000, ta: 55 })!;
  assert.deepEqual(steps(one, 0), [["Initial denaturation", 94, 30]]);
  assert.deepEqual(steps(one, 1), [["Denature", 94, 20], ["Anneal", 55, 30], ["Extend", 68, 120]]);
  assert.deepEqual(steps(one, 2)[0], ["Final extension", 68, 300]);
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
  assert.equal(offerTwoStages(65, null), false);
  // Judged on the gain itself: these show as 56 and 61 °C but are 4.3 °C apart, and 65 to 69.6 is 4.6.
  assert.equal(offerTwoStages(56.3, 60.6), false);
  assert.equal(offerTwoStages(65, 69.6), false);
  // A gain of 5 °C to 0.1 °C is enough, whichever way the sum rounds.
  assert.equal(offerTwoStages(56.3, 61.3), true);
  assert.equal(offerTwoStages(54.6, 59.6), true);
});

test("a second stage is made only where it can be used", () => {
  const base = { polymerase: "q5", template: "plasmid" as const, length: 737, ta: 65 };
  // Tails that raise annealing by less than 5 °C, or none at all, leave one stage even if two were asked for.
  assert.equal(twoStagesPossible({ ...base, taFull: 68 }), false);
  assert.equal(pcrProgram({ ...base, taFull: 68, twoStage: true })!.length, 3);
  assert.equal(pcrProgram({ ...base, taFull: null, twoStage: true })!.length, 3);
  assert.equal(twoStagesPossible({ ...base, taFull: 72 }), true);
  assert.equal(twoStagesPossible({ ...base, polymerase: "q5u", taFull: 72 }), false);
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
  assert.match(n[1], /15 s for each kb of product at 72 °C, so 737 bp gets 15 s\./);
  // The time reads as the program shows it, and the shortest step is owned up to.
  assert.match(programNotes("q5", 8000, "plasmid")[1], /30 s for each kb of product at 72 °C, so 8,000 bp gets 4 min\./);
  assert.match(programNotes("q5", 200, "plasmid")[1], /so 200 bp gets 10 s, the shortest step used\./);
  assert.match(programNotes("taq", 200, "plasmid")[1], /so 200 bp gets 45 s, the least NEB suggests for a short product\./);
  // Its source by number, and that other products of the same Tm rule may cycle differently.
  const notes = programNotes("onetaq", 1000, "plasmid");
  assert.match(notes.at(-2)!, /\(M0481\)/);
  assert.match(notes.at(-1)!, /Other products .* check their own protocol\./);
});

test("the program names the product its protocol is for, by NEB's own name and number", () => {
  // "OneTaq, Standard buffer" in the menu follows the protocol of OneTaq Hot Start, and says so.
  assert.equal(programSource("onetaq"), "OneTaq Hot Start DNA Polymerase · NEB M0481");
  assert.equal(programSource("onetaq-gc"), "OneTaq Hot Start DNA Polymerase · NEB M0481");
  assert.equal(programSource("q5"), "Q5 High-Fidelity DNA Polymerase · NEB M0491");
  assert.equal(programSource("phusion"), "Phusion High-Fidelity DNA Polymerase · NEB M0530");
  assert.equal(programSource("taq"), "Taq DNA Polymerase with Standard Taq Buffer · NEB M0273");
  assert.equal(programSource("q5u"), null);
  assert.equal(programTitle("onetaq", 1234), "OneTaq Hot Start DNA Polymerase (NEB M0481), 1,234 bp");
  assert.equal(programTitle("q5u", 500), "500 bp");
  // Every product name is in its protocol's own title, so the two can't drift apart.
  for (const p of Object.values(PCR_PROTOCOLS)) assert.ok(p.source.includes(p.product), p.source);
});

test("the template notes only claim a longer extension where the protocol gives one", () => {
  // OneTaq and Taq extend 1 min/kb on any template, so only the cycles differ.
  for (const id of ["onetaq", "taq"]) {
    const [plasmid, complex] = templateNotes(id);
    assert.doesNotMatch(plasmid.text + complex.text, /for each kb|extension/, id);
    assert.match(plasmid.text, /, so 25 cycles do\.$/);
    assert.match(complex.text, /, so it takes 30 cycles\.$/);
  }
  const [plasmid, complex] = templateNotes("q5");
  assert.match(plasmid.text, /, so 25 cycles and 15 s for each kb do\.$/);
  assert.match(complex.text, /, so it takes 30 cycles and 30 s for each kb\.$/);
  // A product past 6 kb has a rate of its own on each template, and the notes give them.
  const [longPlasmid, longComplex] = templateNotes("q5", 8000);
  assert.match(longPlasmid.text, /, so 25 cycles and 30 s for each kb do\.$/);
  assert.match(longComplex.text, /, so it takes 30 cycles and 45 s for each kb\.$/);
  assert.match(templateNotes("taq")[2].text, /, so it starts with 5 min at 95 °C, then 30 cycles\.$/);
  // No protocol: the reasons alone, with nothing to quote.
  assert.doesNotMatch(templateNotes("q5u")[0].text, /\d/);
  // Each is one sentence.
  for (const id of ["q5", "taq", "q5u"]) for (const n of templateNotes(id)) assert.doesNotMatch(n.text.slice(0, -1), /\. /, n.text);
});
