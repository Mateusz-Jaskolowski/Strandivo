// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The reaction mix against NEB's protocol tables (src/lib/pcrMix.ts). The tables below are
// NEB's own, both columns, so a changed number here must come off a protocol page. Run with:
// npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { fmtVolume, MIX_DEFAULTS, MIX_RECIPES, mixRecipe, mixSource, mixText, pcrMix, readMixPrefs, SMALL_VOLUME, type MixInput } from "./pcrMix.ts";
import { PCR_PROTOCOLS } from "./pcrProtocols.ts";
import { nebPolymerase } from "./polymerases.ts";

/** A reaction as NEB's table sets it up: its own 10 µM primers and 1 µl of template, one tube. */
const neb = (polymerase: string, volume: number): MixInput => ({ polymerase, volume, reactions: 1, extra: 0, primerStock: 10, templateVolume: 1 });

/** Each component's volume in one reaction, by the name NEB's table gives it. */
function column(polymerase: string, volume: number, optional: string[] = []): Record<string, number> {
  const mix = pcrMix({ ...neb(polymerase, volume), optional })!;
  return Object.fromEntries(mix.rows.map(row => [row.name, row.each]));
}

// NEB #M0491, "PCR Using Q5 High-Fidelity DNA Polymerase".
test("Q5's recipe is NEB's own table, in both of its columns", () => {
  assert.deepEqual(column("q5", 50, ["5X Q5 High GC Enhancer"]), {
    "5X Q5 Reaction Buffer": 10,
    "10 mM dNTPs": 1,
    "10 µM forward primer": 2.5,
    "10 µM reverse primer": 2.5,
    "5X Q5 High GC Enhancer": 10,
    "Q5 High-Fidelity DNA Polymerase": 0.5,
    "Nuclease-free water": 22.5,
    "Template DNA": 1
  });
  assert.deepEqual(column("q5", 25, ["5X Q5 High GC Enhancer"]), {
    "5X Q5 Reaction Buffer": 5,
    "10 mM dNTPs": 0.5,
    "10 µM forward primer": 1.25,
    "10 µM reverse primer": 1.25,
    "5X Q5 High GC Enhancer": 5,
    "Q5 High-Fidelity DNA Polymerase": 0.25,
    "Nuclease-free water": 10.75,
    "Template DNA": 1
  });
  // The enhancer is NEB's own option, so it is only in the reaction when it is asked for.
  assert.equal(column("q5", 50)["5X Q5 High GC Enhancer"], undefined);
  assert.equal(column("q5", 50)["Nuclease-free water"], 32.5);
});

// NEB #M0530. Its smaller reaction is 20 µl, so the volumes are two fifths of the 50 µl ones.
test("Phusion's recipe is NEB's own table, in both of its columns", () => {
  assert.deepEqual(column("phusion", 50, ["DMSO"]), {
    "5X Phusion HF or GC Buffer": 10,
    "10 mM dNTPs": 1,
    "10 µM forward primer": 2.5,
    "10 µM reverse primer": 2.5,
    DMSO: 1.5,
    "Phusion DNA Polymerase": 0.5,
    "Nuclease-free water": 31,
    "Template DNA": 1
  });
  assert.deepEqual(column("phusion", 20, ["DMSO"]), {
    "5X Phusion HF or GC Buffer": 4,
    "10 mM dNTPs": 0.4,
    "10 µM forward primer": 1,
    "10 µM reverse primer": 1,
    DMSO: 0.6,
    "Phusion DNA Polymerase": 0.2,
    "Nuclease-free water": 11.8,
    "Template DNA": 1
  });
  assert.deepEqual(mixRecipe("phusion")!.volumes, [20, 50]);
});

// NEB #M0481. Its footnote puts the GC buffer in the Standard buffer's row, and names a High
// GC Enhancer with no amount, which is why there is no row for one.
test("OneTaq's recipe is NEB's own table, and the GC buffer takes the buffer's row", () => {
  assert.deepEqual(column("onetaq", 25), {
    "5X OneTaq Standard Reaction Buffer": 5,
    "10 mM dNTPs": 0.5,
    "10 µM forward primer": 0.5,
    "10 µM reverse primer": 0.5,
    "OneTaq Hot Start DNA Polymerase": 0.125,
    "Nuclease-free water": 17.375,
    "Template DNA": 1
  });
  assert.equal(column("onetaq", 50)["OneTaq Hot Start DNA Polymerase"], 0.25);
  assert.equal(column("onetaq-gc", 25)["5X OneTaq GC Reaction Buffer"], 5);
  assert.deepEqual(
    mixRecipe("onetaq-gc")!.components.map(c => c.name),
    mixRecipe("onetaq")!.components.map(c => (c.role === "buffer" ? "5X OneTaq GC Reaction Buffer" : c.name))
  );
  assert.ok(!mixRecipe("onetaq")!.components.some(c => c.name.includes("Enhancer")));
});

// NEB #M0273, the only one of the four with a 10X buffer.
test("Taq's recipe is NEB's own table, with a tenth of the volume as buffer", () => {
  assert.deepEqual(column("taq", 50), {
    "10X Standard Taq Reaction Buffer": 5,
    "10 mM dNTPs": 1,
    "10 µM forward primer": 1,
    "10 µM reverse primer": 1,
    "Taq DNA Polymerase": 0.25,
    "Nuclease-free water": 40.75,
    "Template DNA": 1
  });
  assert.equal(column("taq", 25)["10X Standard Taq Reaction Buffer"], 2.5);
});

test("every polymerase with a program has a recipe, and its primers match its Tm settings", () => {
  // Both come off the same protocol page, so one without the other is a page read by halves.
  assert.deepEqual(Object.keys(MIX_RECIPES).sort(), Object.keys(PCR_PROTOCOLS).sort());
  for (const [id, recipe] of Object.entries(MIX_RECIPES)) {
    // The final primer concentration is in NEB's table and in polymerases.ts, for the Tm.
    assert.equal(recipe.primerFinal, nebPolymerase(id).primer, id);
    assert.ok(recipe.number.startsWith("M"), id);
    // NEB gives two volumes; the dialog starts at the smaller.
    assert.ok(recipe.volumes[0] < recipe.volumes[1], id);
  }
  assert.equal(mixRecipe("vent"), null);
  assert.equal(pcrMix(neb("vent", 50)), null);
});

test("the master mix holds every reaction's worth but the template", () => {
  // One tube is made once, so its extra counts for nothing and there is no mix to share out.
  assert.equal(pcrMix({ ...neb("q5", 25), extra: 20 })!.mixReactions, 1);
  const mix = pcrMix({ ...neb("q5", 50), reactions: 8, extra: 10 })!;
  // Eight reactions and a tenth over, so the mix is made for 8.8 of them.
  assert.equal(mix.mixReactions, 8.8);
  const row = (name: string) => mix.rows.find(r => r.name === name)!;
  assert.equal(row("5X Q5 Reaction Buffer").mix, 88);
  assert.equal(row("Q5 High-Fidelity DNA Polymerase").mix, 4.4);
  // The template is what the tubes differ in, so it is the one thing left out of the mix.
  assert.equal(row("Template DNA").mix, null);
  assert.equal(mix.perTube, 49);
  assert.equal(mix.mixTotal, 431.2);
  assert.equal(mix.used, 50);
});

test("water takes up what the template leaves, and says so when there is none", () => {
  const roomy = pcrMix({ ...neb("q5", 50), templateVolume: 5 })!;
  assert.equal(roomy.rows.find(r => r.role === "water")!.each, 28.5);
  assert.equal(roomy.used, 50);
  assert.deepEqual(roomy.warnings, []);
  // More template than the reaction has room for: water cannot go below nothing.
  const over = pcrMix({ ...neb("q5", 25), templateVolume: 20 })!;
  assert.equal(over.rows.find(r => r.role === "water")!.each, 0);
  assert.equal(over.used, 28.25);
  assert.match(over.warnings[0], /come to 28.3 µl, more than the 25 µl reaction/);
});

test("a primer's volume follows its stock to NEB's concentration", () => {
  // 0.5 µM of a 100 µM stock is a tenth of what NEB's 10 µM stock gives.
  const strong = pcrMix({ ...neb("q5", 50), primerStock: 100 })!;
  const primer = strong.rows.find(r => r.role === "primer")!;
  assert.equal(primer.each, 0.25);
  assert.equal(primer.name, "100 µM forward primer");
  assert.equal(strong.warnings[0], "Too little to pipette accurately: 100 µM forward primer 0.25 µl, 100 µM reverse primer 0.25 µl. NEB's table uses a 10 µM primer.");
  // A 1 µM stock reaches 0.2 µM only by filling a fifth of a OneTaq reaction.
  assert.equal(pcrMix({ ...neb("onetaq", 25), primerStock: 1 })!.rows.find(r => r.role === "primer")!.each, 5);
});

test("a volume too small to pipette is named, with NEB's dilution where it gives one", () => {
  // OneTaq's 0.125 µl of enzyme in a 25 µl reaction is the usual culprit.
  const one = pcrMix(neb("onetaq", 25))!;
  assert.equal(one.warnings.length, 1);
  assert.equal(one.warnings[0], "Too little to pipette accurately: OneTaq Hot Start DNA Polymerase 0.125 µl.");
  // Mix enough of it and the volume you pipette is no longer small, so the warning goes.
  assert.deepEqual(pcrMix({ ...neb("onetaq", 25), reactions: 8, extra: 10 })!.warnings, []);
  // A mix for two reactions still leaves 0.25 µl, and the warning says more mix would not help.
  assert.match(pcrMix({ ...neb("onetaq", 25), reactions: 2 })!.warnings[0], /^Too little to pipette accurately, even in the mix: OneTaq Hot Start DNA Polymerase 0.25 µl.$/);
  // Q5's protocol offers a dilution, so its warning passes NEB's own sentence on.
  const q5 = pcrMix(neb("q5", 10))!;
  assert.match(q5.warnings[0], /^Too little to pipette accurately: .*Q5 High-Fidelity DNA Polymerase 0.1 µl. Q5 may be diluted in 1X Q5 Reaction Buffer/);
  // Taq's protocol says nothing about diluting it, so neither does the warning.
  assert.equal(pcrMix(neb("taq", 25))!.warnings[0], "Too little to pipette accurately: Taq DNA Polymerase 0.125 µl.");
  // NEB's own 20 µl Phusion reaction asks for 0.4 µl of dNTPs, so both are named in one line.
  assert.equal(pcrMix(neb("phusion", 20))!.warnings.length, 1);
  assert.match(pcrMix(neb("phusion", 20))!.warnings[0], /^Too little to pipette accurately: 10 mM dNTPs 0.4 µl, Phusion DNA Polymerase 0.2 µl. Phusion may be diluted/);
  assert.equal(SMALL_VOLUME, 0.5);
});

test("volumes are written with the decimals a pipette can set", () => {
  assert.equal(fmtVolume(0.125), "0.125");
  assert.equal(fmtVolume(2.5), "2.5");
  assert.equal(fmtVolume(10), "10");
  assert.equal(fmtVolume(13.75), "13.8");
  assert.equal(fmtVolume(431.2), "431.2");
  assert.equal(fmtVolume(0), "0");
});

test("the copied mix names NEB's product and what each tube takes", () => {
  const one = mixText(pcrMix(neb("taq", 50))!);
  assert.equal(
    one,
    [
      "Taq DNA Polymerase with Standard Taq Buffer (NEB M0273), 50 µl",
      "10X Standard Taq Reaction Buffer: 5 µl",
      "10 mM dNTPs: 1 µl",
      "10 µM forward primer: 1 µl",
      "10 µM reverse primer: 1 µl",
      "Taq DNA Polymerase: 0.25 µl",
      "Nuclease-free water: 40.8 µl",
      "Template DNA: 1 µl in each tube"
    ].join("\n")
  );
  // With a mix there is a second volume for each line, and what it comes to at the end.
  const many = mixText(pcrMix({ ...neb("taq", 50), reactions: 4, extra: 5 })!).split("\n");
  assert.equal(many[0], "Taq DNA Polymerase with Standard Taq Buffer (NEB M0273), 50 µl × 4.2 reactions");
  assert.equal(many[1], "10X Standard Taq Reaction Buffer: 5 µl, 21 µl in the mix");
  assert.equal(many.at(-2), "Template DNA: 1 µl in each tube");
  assert.equal(many.at(-1), "Master mix: 205.8 µl in all, 49 µl per tube");
  assert.equal(mixSource("taq"), "Taq DNA Polymerase with Standard Taq Buffer · NEB M0273");
  assert.equal(mixSource("vent"), null);
});

test("a kept setting is only taken back if the dialog still offers it", () => {
  assert.deepEqual(readMixPrefs({}), MIX_DEFAULTS);
  assert.deepEqual(readMixPrefs(null), MIX_DEFAULTS);
  // The volume stays null until one is picked, so each recipe starts at NEB's own.
  assert.equal(MIX_DEFAULTS.volume, null);
  assert.deepEqual(readMixPrefs({ volume: 50, extra: 5, primerStock: 100, templateVolume: 2.5 }), { volume: 50, extra: 5, primerStock: 100, templateVolume: 2.5 });
  // A volume or an extra the menus no longer hold falls back rather than being shown.
  assert.deepEqual(readMixPrefs({ volume: 37, extra: 7 }), MIX_DEFAULTS);
  assert.equal(readMixPrefs({ primerStock: 0 }).primerStock, 10);
  assert.equal(readMixPrefs({ primerStock: "10" }).primerStock, 10);
  assert.equal(readMixPrefs({ templateVolume: 1e6 }).templateVolume, 1);
});
