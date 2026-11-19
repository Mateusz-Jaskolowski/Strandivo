// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The reaction mix against NEB's protocol tables (src/lib/pcrMix.ts). The tables below are
// NEB's own, both columns, so a changed number here must come off a protocol page. Run with:
// npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { fmtVolume, MAX_STOCK, MAX_TEMPLATE, MIX_DEFAULTS, MIX_EXTRAS, MIX_RECIPES, MIX_VOLUMES, mixRecipe, mixSource, mixText, pcrMix, readMixPrefs, SMALL_VOLUME, type MixInput } from "./pcrMix.ts";
import { PCR_PROTOCOLS } from "./pcrProtocols.ts";
import { nebPolymerase } from "./polymerases.ts";

/** A reaction as NEB's table sets it up: its own 10 µM primers and 1 µl of template, one tube. */
const neb = (polymerase: string, volume: number): MixInput => ({ polymerase, volume, reactions: 1, extra: 0, primerStock: 10, templateVolume: 1 });

/** Each row's name, per-reaction volume and NEB final concentration, in table order. */
function rows(polymerase: string, volume: number, optional: string[] = []): [string, number, string][] {
  const mix = pcrMix({ ...neb(polymerase, volume), optional })!;
  return mix.rows.map(row => [row.name, row.each, row.final]);
}

// NEB #M0491, "PCR Using Q5 High-Fidelity DNA Polymerase".
test("Q5's recipe is NEB's own table, in both of its columns", () => {
  const recipe = mixRecipe("q5")!;
  assert.equal(recipe.product, "Q5 High-Fidelity DNA Polymerase");
  assert.equal(recipe.number, "M0491");
  assert.deepEqual(recipe.volumes, [25, 50]);
  assert.equal(recipe.dilute, "The Q5 High-Fidelity DNA Polymerase may be diluted in 1X Q5 Reaction Buffer just prior to use to reduce pipetting errors.");
  assert.deepEqual(rows("q5", 50, ["5X Q5 High GC Enhancer"]), [
    ["5X Q5 Reaction Buffer", 10, "1X"],
    ["10 mM dNTPs", 1, "200 µM"],
    ["10 µM forward primer", 2.5, "0.5 µM"],
    ["10 µM reverse primer", 2.5, "0.5 µM"],
    ["5X Q5 High GC Enhancer", 10, "1X"],
    ["Q5 High-Fidelity DNA Polymerase", 0.5, "0.02 U/µl"],
    ["Nuclease-free water", 22.5, ""],
    ["Template DNA", 1, "< 1,000 ng"]
  ]);
  assert.deepEqual(rows("q5", 25, ["5X Q5 High GC Enhancer"]), [
    ["5X Q5 Reaction Buffer", 5, "1X"],
    ["10 mM dNTPs", 0.5, "200 µM"],
    ["10 µM forward primer", 1.25, "0.5 µM"],
    ["10 µM reverse primer", 1.25, "0.5 µM"],
    ["5X Q5 High GC Enhancer", 5, "1X"],
    ["Q5 High-Fidelity DNA Polymerase", 0.25, "0.02 U/µl"],
    ["Nuclease-free water", 10.75, ""],
    ["Template DNA", 1, "< 1,000 ng"]
  ]);
  // The enhancer is NEB's own option, so it is only in the reaction when it is asked for.
  const plain = rows("q5", 50);
  assert.ok(!plain.some(([name]) => name === "5X Q5 High GC Enhancer"));
  assert.deepEqual(plain.find(([name]) => name === "Nuclease-free water"), ["Nuclease-free water", 32.5, ""]);
});

// NEB #M0530. Its smaller reaction is 20 µl, so the volumes are two fifths of the 50 µl ones.
test("Phusion's recipe is NEB's own table, in both of its columns", () => {
  const recipe = mixRecipe("phusion")!;
  assert.equal(recipe.product, "Phusion High-Fidelity DNA Polymerase");
  assert.equal(recipe.number, "M0530");
  assert.deepEqual(recipe.volumes, [20, 50]);
  assert.equal(recipe.dilute, "Phusion DNA Polymerase may be diluted in 1X Phusion HF or GC Buffer just prior to use to reduce pipetting errors.");
  assert.deepEqual(rows("phusion", 50, ["DMSO"]), [
    ["5X Phusion HF or GC Buffer", 10, "1X"],
    ["10 mM dNTPs", 1, "200 µM"],
    ["10 µM forward primer", 2.5, "0.5 µM"],
    ["10 µM reverse primer", 2.5, "0.5 µM"],
    ["DMSO", 1.5, "3%"],
    ["Phusion DNA Polymerase", 0.5, "1.0 units/50 µl PCR"],
    ["Nuclease-free water", 31, ""],
    ["Template DNA", 1, "< 250 ng"]
  ]);
  assert.deepEqual(rows("phusion", 20, ["DMSO"]), [
    ["5X Phusion HF or GC Buffer", 4, "1X"],
    ["10 mM dNTPs", 0.4, "200 µM"],
    ["10 µM forward primer", 1, "0.5 µM"],
    ["10 µM reverse primer", 1, "0.5 µM"],
    ["DMSO", 0.6, "3%"],
    ["Phusion DNA Polymerase", 0.2, "1.0 units/50 µl PCR"],
    ["Nuclease-free water", 11.8, ""],
    ["Template DNA", 1, "< 250 ng"]
  ]);
  assert.ok(!rows("phusion", 50).some(([name]) => name === "DMSO"));
});

// NEB #M0481. Its footnote puts the GC buffer in the Standard buffer's row, and names a High
// GC Enhancer with no amount, which is why there is no row for one.
test("OneTaq's recipe is NEB's own table, and the GC buffer takes the buffer's row", () => {
  for (const [id, buffer] of [
    ["onetaq", "5X OneTaq Standard Reaction Buffer"],
    ["onetaq-gc", "5X OneTaq GC Reaction Buffer"]
  ] as const) {
    const recipe = mixRecipe(id)!;
    assert.equal(recipe.product, "OneTaq Hot Start DNA Polymerase", id);
    assert.equal(recipe.number, "M0481", id);
    assert.deepEqual(recipe.volumes, [25, 50], id);
    assert.equal(recipe.dilute, undefined, id);
    assert.deepEqual(rows(id, 25), [
      [buffer, 5, "1X"],
      ["10 mM dNTPs", 0.5, "200 µM"],
      ["10 µM forward primer", 0.5, "0.2 µM"],
      ["10 µM reverse primer", 0.5, "0.2 µM"],
      ["OneTaq Hot Start DNA Polymerase", 0.125, "1.25 units/50 µl PCR"],
      ["Nuclease-free water", 17.375, ""],
      ["Template DNA", 1, "< 1,000 ng"]
    ]);
    assert.deepEqual(rows(id, 50), [
      [buffer, 10, "1X"],
      ["10 mM dNTPs", 1, "200 µM"],
      ["10 µM forward primer", 1, "0.2 µM"],
      ["10 µM reverse primer", 1, "0.2 µM"],
      ["OneTaq Hot Start DNA Polymerase", 0.25, "1.25 units/50 µl PCR"],
      ["Nuclease-free water", 35.75, ""],
      ["Template DNA", 1, "< 1,000 ng"]
    ]);
    assert.ok(!recipe.components.some(c => c.name.includes("Enhancer")), id);
  }
});

// NEB #M0273, the only one of the four with a 10X buffer.
test("Taq's recipe is NEB's own table, with a tenth of the volume as buffer", () => {
  const recipe = mixRecipe("taq")!;
  assert.equal(recipe.product, "Taq DNA Polymerase with Standard Taq Buffer");
  assert.equal(recipe.number, "M0273");
  assert.deepEqual(recipe.volumes, [25, 50]);
  assert.equal(recipe.dilute, undefined);
  assert.deepEqual(rows("taq", 50), [
    ["10X Standard Taq Reaction Buffer", 5, "1X"],
    ["10 mM dNTPs", 1, "200 µM"],
    ["10 µM forward primer", 1, "0.2 µM (0.05–1 µM)"],
    ["10 µM reverse primer", 1, "0.2 µM (0.05–1 µM)"],
    ["Taq DNA Polymerase", 0.25, "1.25 units/50 µl PCR"],
    ["Nuclease-free water", 40.75, ""],
    ["Template DNA", 1, "< 1,000 ng"]
  ]);
  assert.deepEqual(rows("taq", 25), [
    ["10X Standard Taq Reaction Buffer", 2.5, "1X"],
    ["10 mM dNTPs", 0.5, "200 µM"],
    ["10 µM forward primer", 0.5, "0.2 µM (0.05–1 µM)"],
    ["10 µM reverse primer", 0.5, "0.2 µM (0.05–1 µM)"],
    ["Taq DNA Polymerase", 0.125, "1.25 units/50 µl PCR"],
    ["Nuclease-free water", 19.875, ""],
    ["Template DNA", 1, "< 1,000 ng"]
  ]);
});

test("every polymerase with a program has a recipe, its primers match its Tm settings, and the menus cover its volumes", () => {
  // Both come off the same protocol page, so one without the other is a page read by halves.
  assert.deepEqual(Object.keys(MIX_RECIPES).sort(), Object.keys(PCR_PROTOCOLS).sort());
  for (const [id, recipe] of Object.entries(MIX_RECIPES)) {
    // The final primer concentration is in NEB's table and in polymerases.ts, for the Tm.
    assert.equal(recipe.primerFinal, nebPolymerase(id).primer, id);
    assert.ok(recipe.number.startsWith("M"), id);
    // NEB gives two volumes; the dialog starts at the smaller, and the Volume menu must offer both.
    assert.ok(recipe.volumes[0] < recipe.volumes[1], id);
    for (const v of recipe.volumes) assert.ok(MIX_VOLUMES.includes(v), `${id} volume ${v} missing from MIX_VOLUMES`);
  }
  assert.ok(MIX_EXTRAS.includes(MIX_DEFAULTS.extra));
  assert.deepEqual([...MIX_VOLUMES].sort((a, b) => a - b), [...MIX_VOLUMES]);
  assert.deepEqual([...MIX_EXTRAS].sort((a, b) => a - b), [...MIX_EXTRAS]);
  assert.equal(mixRecipe("vent"), null);
  assert.equal(pcrMix(neb("vent", 50)), null);
});

test("the master mix holds every reaction's worth but the template, optional components included", () => {
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

  // Optional components scale into the master mix too, displacing water rather than changing the total.
  const withGc = pcrMix({ ...neb("q5", 50), reactions: 8, extra: 10, optional: ["5X Q5 High GC Enhancer"] })!;
  const gcRow = withGc.rows.find(r => r.name === "5X Q5 High GC Enhancer")!;
  assert.equal(gcRow.each, 10);
  assert.equal(gcRow.mix, 88);
  assert.equal(withGc.mixTotal, 431.2);
});

test("water takes up what the template leaves, and says so when there is none", () => {
  const roomy = pcrMix({ ...neb("q5", 50), templateVolume: 5 })!;
  assert.equal(roomy.rows.find(r => r.role === "water")!.each, 28.5);
  assert.equal(roomy.used, 50);
  assert.deepEqual(roomy.warnings, []);
  // Exactly full (0 µl water left) fits without warning; half a microlitre past that warns.
  const exact = pcrMix({ ...neb("q5", 50), templateVolume: 33.5 })!;
  assert.equal(exact.rows.find(r => r.role === "water")!.each, 0);
  assert.equal(exact.used, 50);
  assert.deepEqual(exact.warnings, []);
  const justOver = pcrMix({ ...neb("q5", 50), templateVolume: 34 })!;
  assert.equal(justOver.rows.find(r => r.role === "water")!.each, 0);
  assert.equal(justOver.used, 50.5);
  assert.equal(justOver.warnings[0], "The components come to 50.5 µl, more than the 50 µl reaction: use less template or a larger reaction.");
  // More template than the reaction has room for: water cannot go below nothing.
  const over = pcrMix({ ...neb("q5", 25), templateVolume: 20 })!;
  assert.equal(over.rows.find(r => r.role === "water")!.each, 0);
  assert.equal(over.used, 28.25);
  assert.match(over.warnings[0], /come to 28.3 µl, more than the 25 µl reaction: use less template or a larger reaction\./);
  // A dilute primer stock that overflows on its own cannot be fixed by less template or a larger reaction.
  const diluteOnly = pcrMix({ ...neb("q5", 25), primerStock: 1 })!;
  assert.match(diluteOnly.warnings[0], /more than the 25 µl reaction: use a more concentrated primer stock\.$/);
  // A dilute stock combined with a large template names the stock alongside template and reaction volume.
  const diluteAndTemplate = pcrMix({ ...neb("q5", 25), primerStock: 2, templateVolume: 10 })!;
  assert.match(diluteAndTemplate.warnings[0], /more than the 25 µl reaction: use a more concentrated primer stock, less template or a larger reaction\.$/);
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
  // Q5's protocol offers a dilution, so its warning passes NEB's own sentence on verbatim.
  const q5 = pcrMix(neb("q5", 10))!;
  assert.equal(
    q5.warnings[0],
    "Too little to pipette accurately: 10 mM dNTPs 0.2 µl, Q5 High-Fidelity DNA Polymerase 0.1 µl. The Q5 High-Fidelity DNA Polymerase may be diluted in 1X Q5 Reaction Buffer just prior to use to reduce pipetting errors."
  );
  // Taq's protocol says nothing about diluting it, so neither does the warning.
  assert.equal(pcrMix(neb("taq", 25))!.warnings[0], "Too little to pipette accurately: Taq DNA Polymerase 0.125 µl.");
  // NEB's own 20 µl Phusion reaction asks for 0.4 µl of dNTPs, so both are named in one line.
  assert.equal(pcrMix(neb("phusion", 20))!.warnings.length, 1);
  assert.equal(
    pcrMix(neb("phusion", 20))!.warnings[0],
    "Too little to pipette accurately: 10 mM dNTPs 0.4 µl, Phusion DNA Polymerase 0.2 µl. Phusion DNA Polymerase may be diluted in 1X Phusion HF or GC Buffer just prior to use to reduce pipetting errors."
  );
  // Optional components under the threshold are named too (Phusion 10 µl has 0.3 µl DMSO).
  const smallDmso = pcrMix({ ...neb("phusion", 10), optional: ["DMSO"] })!;
  assert.match(smallDmso.warnings[0], /DMSO 0\.3 µl/);
  // Small primers at NEB's own 10 µM stock do not get the 10 µM stock note; a non-10 µM stock (even below 10) does.
  const oneTaq10 = pcrMix(neb("onetaq", 10))!;
  assert.match(oneTaq10.warnings[0], /10 µM forward primer 0\.2 µl/);
  assert.doesNotMatch(oneTaq10.warnings[0], /NEB's table uses a 10 µM primer/);
  const oneTaqStock5 = pcrMix({ ...neb("onetaq", 10), primerStock: 5 })!;
  assert.match(oneTaqStock5.warnings[0], /5 µM forward primer 0\.4 µl/);
  assert.match(oneTaqStock5.warnings[0], /NEB's table uses a 10 µM primer\./);
  // Water and template below 0.5 µl are not called out as small pipetting volumes.
  const tinyWater = pcrMix({ ...neb("q5", 50), templateVolume: 33.25 })!;
  assert.equal(tinyWater.rows.find(r => r.role === "water")!.each, 0.25);
  assert.deepEqual(tinyWater.warnings, []);
  const tinyTemplate = pcrMix({ ...neb("q5", 50), templateVolume: 0.25 })!;
  assert.deepEqual(tinyTemplate.warnings, []);
  assert.equal(SMALL_VOLUME, 0.5);
});

test("OneTaq shows NEB's 3–6 kb enzyme footnote when the product is in that range", () => {
  const note = "For amplicons between 3–6 kb, use 2.5–5 units/50 µl rxn.";
  assert.ok(pcrMix({ ...neb("onetaq", 50), reactions: 8, productLength: 3000 })!.warnings.includes(note));
  assert.ok(pcrMix({ ...neb("onetaq", 50), reactions: 8, productLength: 4500 })!.warnings.includes(note));
  assert.ok(pcrMix({ ...neb("onetaq-gc", 50), reactions: 8, productLength: 6000 })!.warnings.includes(note));
  assert.deepEqual(pcrMix({ ...neb("onetaq", 50), reactions: 8, productLength: 2999 })!.warnings, []);
  assert.deepEqual(pcrMix({ ...neb("onetaq", 50), reactions: 8, productLength: 6001 })!.warnings, []);
  assert.deepEqual(pcrMix({ ...neb("onetaq", 50), reactions: 8 })!.warnings, []);
  assert.deepEqual(pcrMix({ ...neb("q5", 50), productLength: 4500 })!.warnings, []);
});

test("volumes are written with the decimals a pipette can set", () => {
  assert.equal(fmtVolume(0.125), "0.125");
  assert.equal(fmtVolume(2.5), "2.5");
  assert.equal(fmtVolume(10), "10");
  assert.equal(fmtVolume(13.75), "13.8");
  assert.equal(fmtVolume(431.2), "431.2");
  assert.equal(fmtVolume(0), "0");
});

test("the copied mix names NEB's product, what each tube takes, and any warnings", () => {
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
      "Template DNA: 1 µl in each tube",
      "Note: Too little to pipette accurately: Taq DNA Polymerase 0.25 µl."
    ].join("\n")
  );
  // With a mix there is a second volume for each line, and what it comes to at the end.
  const many = mixText(pcrMix({ ...neb("taq", 50), reactions: 4, extra: 5 })!).split("\n");
  assert.equal(many[0], "Taq DNA Polymerase with Standard Taq Buffer (NEB M0273), 50 µl × 4.2 reactions");
  assert.equal(many[1], "10X Standard Taq Reaction Buffer: 5 µl, 21 µl in the mix");
  assert.equal(many.at(-2), "Template DNA: 1 µl in each tube");
  assert.equal(many.at(-1), "Master mix: 205.8 µl in all, 49 µl per tube");
  // An over-full mix carries its warning into the copied text rather than looking fine.
  const over = mixText(pcrMix({ ...neb("q5", 25), templateVolume: 20 })!);
  assert.match(over, /Note: The components come to 28\.3 µl, more than the 25 µl reaction/);
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
  assert.equal(readMixPrefs({ primerStock: MAX_STOCK }).primerStock, MAX_STOCK);
  assert.equal(readMixPrefs({ primerStock: MAX_STOCK + 0.1 }).primerStock, 10);
  // Template volume may be 0 (e.g. a no-template control), up to MAX_TEMPLATE inclusive.
  assert.equal(readMixPrefs({ templateVolume: 0 }).templateVolume, 0);
  assert.ok(Object.is(readMixPrefs({ templateVolume: -0 }).templateVolume, 0));
  assert.equal(readMixPrefs({ templateVolume: -0.1 }).templateVolume, 1);
  assert.equal(readMixPrefs({ templateVolume: MAX_TEMPLATE }).templateVolume, MAX_TEMPLATE);
  assert.equal(readMixPrefs({ templateVolume: MAX_TEMPLATE + 0.1 }).templateVolume, 1);
  assert.equal(readMixPrefs({ templateVolume: 1e6 }).templateVolume, 1);
});

test("mix prefs persist through localStorage, keep 0 µl template, and survive bad or failing storage", async () => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const withStorage = async (storage: Pick<Storage, "getItem" | "setItem"> | undefined, tag: string, run: (mod: typeof import("../pcrMixPrefs.ts")) => void) => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: storage });
    try {
      const mod = (await import(`../pcrMixPrefs.ts?case=${tag}`)) as typeof import("../pcrMixPrefs.ts");
      run(mod);
    } finally {
      if (prev) Object.defineProperty(globalThis, "localStorage", prev);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  };
  const mem = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      map,
      storage: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => {
          map.set(k, v);
        }
      }
    };
  };

  // Empty store falls back to defaults; partial saves keep the rest, including templateVolume 0.
  const m1 = mem();
  await withStorage(m1.storage, "empty", ({ mixPrefs, saveMixPrefs }) => {
    assert.deepEqual(mixPrefs(), MIX_DEFAULTS);
    saveMixPrefs({ volume: 50, templateVolume: 2.5 });
    assert.deepEqual(mixPrefs(), { volume: 50, extra: 10, primerStock: 10, templateVolume: 2.5 });
    saveMixPrefs({ templateVolume: 0 });
    assert.deepEqual(mixPrefs(), { volume: 50, extra: 10, primerStock: 10, templateVolume: 0 });
    assert.deepEqual(JSON.parse(m1.map.get("strandivo.pcrMix")!), { volume: 50, extra: 10, primerStock: 10, templateVolume: 0 });
  });

  // Stored values load back cleanly, including 0 µl template.
  const m2 = mem({ "strandivo.pcrMix": JSON.stringify({ volume: 20, extra: 5, primerStock: 25, templateVolume: 0 }) });
  await withStorage(m2.storage, "loaded", ({ mixPrefs }) => {
    assert.deepEqual(mixPrefs(), { volume: 20, extra: 5, primerStock: 25, templateVolume: 0 });
  });

  // Malformed JSON falls back to defaults without throwing.
  const m3 = mem({ "strandivo.pcrMix": "{broken" });
  await withStorage(m3.storage, "malformed", ({ mixPrefs }) => {
    assert.deepEqual(mixPrefs(), MIX_DEFAULTS);
  });

  // Throwing storage falls back on load and keeps saves in memory.
  const throwing = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    }
  };
  await withStorage(throwing, "throwing", ({ mixPrefs, saveMixPrefs }) => {
    assert.deepEqual(mixPrefs(), MIX_DEFAULTS);
    saveMixPrefs({ extra: 20, primerStock: 50 });
    assert.deepEqual(mixPrefs(), { volume: null, extra: 20, primerStock: 50, templateVolume: 1 });
  });
});
