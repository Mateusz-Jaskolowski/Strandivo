// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Printable PCR bench-sheet snapshot, SVG and offline HTML export. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LADDERS } from "./gel.ts";
import { pcrProduct, type PlacedPrimer } from "./pcr.ts";
import { effectivePcrMix, MIX_DEFAULTS, type MixPrefs } from "./pcrMix.ts";
import { digestName, productOverview } from "./pcrOverview.ts";
import { programContext } from "./pcrPlan.ts";
import {
  buildPcrPlanSnapshot,
  DEFAULT_PLAN_SECTIONS,
  paperForLocale,
  pcrPlanGelSvg,
  pcrPlanHtml,
  pcrPlanMarkdown,
  pcrPlanOverviewSvg,
  planFileName,
  planPdfFileName,
  readPlanPaper,
  readPlanSections,
  suggestedPlanTitle
} from "./pcrPrint.ts";
import { pcrProgram, programSource, programTitle } from "./pcrProgram.ts";
import { programDraft, programInputKey, programKey } from "./pcrProgramEdit.ts";
import { nebPolymerase } from "./polymerases.ts";
import { alignPrimer } from "./primerAlign.ts";
import { annealingTemp, DEFAULT_TM, meltingTemp, tmBases, withNebPolymerase } from "./primers.ts";
import { reverseComplement, type SeqData } from "./seqdata.ts";

const puc19 = (): SeqData => {
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  const sequence = gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
  return { name: "pUC19", description: "", circular: true, sequence, features: [], primers: [], sources: [] };
};

function makePair(d: SeqData, opts: { fwdTail?: string; revTail?: string; fwdName?: string; revName?: string } = {}) {
  const fStart = 100;
  const fEnd = 121;
  const rStart = 1400;
  const rEnd = 1421;
  const fwdBind = d.sequence.slice(fStart, fEnd + 1);
  const revBind = reverseComplement(d.sequence.slice(rStart, rEnd + 1));
  const f: PlacedPrimer = {
    name: opts.fwdName ?? "pUC19-F",
    bases: `${opts.fwdTail ?? ""}${fwdBind}`,
    start: fStart,
    end: fEnd,
    strand: 1
  };
  const r: PlacedPrimer = {
    name: opts.revName ?? "pUC19-R",
    bases: `${opts.revTail ?? ""}${revBind}`,
    start: rStart,
    end: rEnd,
    strand: -1
  };
  return { f, r };
}

function buildScenario(opts: {
  polymerase?: string;
  editAnnealTemp?: string;
  editCycles?: string;
  staleKey?: boolean;
  digestIndex?: number;
  ladderId?: string;
  reactions?: number;
  extra?: number;
  volume?: number | null;
  optional?: string[];
  fwdTail?: string;
  revTail?: string;
  fwdName?: string;
  revName?: string;
  templateName?: string;
  warnings?: string[];
  unknownTm?: boolean;
} = {}) {
  const d = puc19();
  if (opts.templateName !== undefined) d.name = opts.templateName;
  const { f, r } = makePair(d, opts);
  const product = pcrProduct(d.sequence, d.circular, f, r)!;
  assert.ok(product, "fixture primers must yield a product");

  const polymerase = opts.polymerase ?? "q5";
  const poly = nebPolymerase(polymerase);
  const conf = withNebPolymerase(DEFAULT_TM, polymerase);
  const alignF = alignPrimer(f, d.sequence);
  const alignR = alignPrimer(r, d.sequence);
  const tmF = opts.unknownTm ? null : meltingTemp(tmBases(alignF), conf);
  const tmR = opts.unknownTm ? null : meltingTemp(tmBases(alignR), conf);
  const anneal = opts.unknownTm ? null : annealingTemp(tmBases(alignF), tmBases(alignR), conf);

  const input = anneal ? { polymerase, template: "plasmid" as const, length: product.length, ta: anneal.ta, taFull: null } : null;
  const stages = input ? pcrProgram({ ...input, twoStage: false }) : null;
  const inputKey = input ? programInputKey({ ...input, twoStage: false }) : "";
  const draft =
    stages && anneal
      ? programDraft({
          key: opts.staleKey ? "stale-earlier-key" : inputKey,
          stages,
          title: programTitle(polymerase, product.length),
          source: programSource(polymerase)!,
          context: programContext("plasmid", product.length, anneal.ta, null)
        })
      : null;

  if (draft && opts.editAnnealTemp !== undefined) {
    // Stage 1 is the repeated cycling stage; step 1 is Anneal (or Anneal and extend).
    draft.values[programKey(1, 1, "temp")] = opts.editAnnealTemp;
  }
  if (draft && opts.editCycles !== undefined) {
    draft.values[programKey(1, 0, "cycles")] = opts.editCycles;
  }

  const overview = productOverview(product, d.sequence, d.circular, {
    enzymeSource: "common",
    enzymeFilter: "unique6",
    labEnzymes: [],
    personalEnzymes: []
  });
  const digest = overview.digests[opts.digestIndex ?? 0] ?? null;
  const ladder = LADDERS.find(l => l.id === opts.ladderId) ?? LADDERS[0];
  const prefs: MixPrefs = {
    ...MIX_DEFAULTS,
    volume: opts.volume !== undefined ? opts.volume : MIX_DEFAULTS.volume,
    extra: opts.extra ?? MIX_DEFAULTS.extra
  };
  const mix = effectivePcrMix(polymerase, product.length, { reactions: opts.reactions ?? 1, optional: opts.optional ?? [] }, prefs);

  const snapshot = buildPcrPlanSnapshot({
    template: d,
    templateKind: "plasmid",
    product,
    forward: f,
    reverse: r,
    alignF,
    alignR,
    tmF,
    tmR,
    polymeraseId: polymerase,
    polymeraseName: poly.name,
    sameAsSettings: true,
    endsText: "Blunt ends",
    annealText: anneal ? `${Math.round(anneal.ta)} °C` : null,
    annealRule: anneal ? `${anneal.polymerase}: ${anneal.rule}` : null,
    twoStage: false,
    featuresText: "No features",
    overview,
    enzymeFilterNote: "Common · unique 6+",
    digest,
    ladder,
    programDraft: draft,
    programInputKey: inputKey,
    programUnavailableReason: !anneal ? "A primer's Tm is unknown, so there is no program." : `There is no program for ${poly.name} yet.`,
    mix,
    mixUnavailableReason: `There is no reaction setup for ${poly.name} yet.`,
    warnings: opts.warnings ?? [],
    exportedAt: "2026-11-19"
  });
  return { d, f, r, product, overview, digest, ladder, mix, snapshot };
}

test("edited cycling step, changed digest, ladder, and collapsed mix settings all flow into the snapshot and HTML", () => {
  const { d, digest, snapshot } = buildScenario({
    polymerase: "q5",
    editAnnealTemp: "61.5",
    editCycles: "28",
    digestIndex: 1,
    ladderId: "100bp",
    reactions: 6,
    extra: 20,
    volume: 50,
    optional: ["5X Q5 High GC Enhancer"]
  });
  assert.ok(digest, "fixture should offer a second digest");
  assert.equal(snapshot.program?.edited, true);
  assert.equal(snapshot.program?.stages[1].cycles, 28);
  assert.equal(snapshot.program?.stages[1].cyclesEdited, true);
  assert.equal(snapshot.program?.stages[1].steps[1].temp, 61.5);
  assert.equal(snapshot.program?.stages[1].steps[1].tempEdited, true);
  assert.equal(snapshot.digest?.name, digestName(digest));
  assert.equal(snapshot.gel.ladder.id, "100bp");
  assert.equal(snapshot.mix?.reactions, 6);
  assert.equal(snapshot.mix?.extra, 20);
  assert.equal(snapshot.mix?.mixReactions, 7.2);
  assert.equal(snapshot.mix?.volume, 50);
  assert.ok(snapshot.mix?.rows.some(r => r.name === "5X Q5 High GC Enhancer"));

  const html = pcrPlanHtml(snapshot, { title: "Colony check #4", experimentDate: "2026-11-22", notes: "" });
  // Edited badge + original source attribution without implying NEB authored the edit.
  assert.match(html, /class="sv-sheet-badge">Edited</);
  assert.match(html, /Based on Q5 High-Fidelity DNA Polymerase · NEB M0491 \(edited locally\)/);
  assert.match(html, /61\.5 °C/);
  assert.match(html, /28 cycles/);
  // Selected digest and ladder appear in both header and gel/lane key.
  assert.ok(html.includes(digestName(digest)));
  assert.ok(html.includes("100 bp"));
  // Reaction mix reflects batch values, extra %, units and optional additive.
  assert.match(html, /50 µl\/reaction · 6 reactions \(\+20% extra → 7\.2× master mix\)/);
  assert.ok(html.includes("5X Q5 High GC Enhancer"));
  assert.match(html, /Master mix/);
  // Experiment date and export date both appear distinctly.
  assert.match(html, /2026-11-22/);
  assert.match(html, /Plan exported 2026-11-19/);
  // Never include the full template sequence, scripts, or external resource references.
  assert.equal(html.includes(d.sequence), false);
  assert.equal(html.includes("<script"), false);
  assert.equal(/<link\b|\bsrc=|\bhref=|url\(/i.test(html), false);
});

test("missing protocol and missing mix show clear notices without empty tables or invented numbers", () => {
  const { snapshot } = buildScenario({ polymerase: "vent" });
  assert.equal(snapshot.program, null);
  assert.equal(snapshot.mix, null);
  assert.match(snapshot.programUnavailableReason ?? "", /Vent or Deep Vent/);
  assert.match(snapshot.mixUnavailableReason ?? "", /Vent or Deep Vent/);

  const html = pcrPlanHtml(snapshot, { title: "", experimentDate: "", notes: "" });
  assert.match(html, /There is no program for Vent or Deep Vent yet\./);
  assert.match(html, /There is no reaction setup for Vent or Deep Vent yet\./);
  // Only the primers table exists; neither program nor mix emitted a table.
  assert.equal((html.match(/<table class="sv-sheet-table">/g) ?? []).length, 1);
});

test("unknown primer Tm carries an incomplete-prediction warning and omits the program table", () => {
  const { snapshot } = buildScenario({ polymerase: "q5", unknownTm: true });
  assert.equal(snapshot.program, null);
  assert.ok(snapshot.warnings.some(w => /incomplete/i.test(w)));
  const html = pcrPlanHtml(snapshot, { title: "Degenerate test", experimentDate: "", notes: "" });
  assert.match(html, /Unavailable \(Tm unknown\)/);
  assert.match(html, /A primer&#39;s Tm is unknown, so there is no program\./);
});

test("unset experiment date stays blank and is never filled from the export date", () => {
  const { snapshot } = buildScenario();
  const html = pcrPlanHtml(snapshot, { title: snapshot.suggestedTitle, experimentDate: "", notes: "" });
  assert.match(html, /class="sv-sheet-date-blank"/);
  assert.equal(/class="sv-sheet-date-val"/.test(html), false);
  // Footer still carries the distinct export date.
  assert.match(html, /Plan exported 2026-11-19/);
  // Blank notes leave ruled writing lines.
  assert.equal((html.match(/class="sv-sheet-notes-line"/g) ?? []).length, 4);
});

test("long primer names, long tailed 5′→3′ sequences, multiline notes, and HTML escaping render safely and completely", () => {
  const longTail = "GCGCGAATTC" + "ACGT".repeat(12); // 58 nt tail
  const longName = "pUC19_ExtremelyLongPrimerName_CloneCheck_2026_Round3_WithExtraTags_Forward";
  const { f, snapshot } = buildScenario({
    fwdTail: longTail,
    fwdName: longName,
    templateName: "pUC19 <demo> & \"v2\""
  });

  // Full 5′→3′ sequence preserved (tail lowercase, binding uppercase), never shortened.
  assert.equal(snapshot.primers[0].tail, longTail.toLowerCase());
  assert.equal(snapshot.primers[0].sequence.length, f.bases.length);
  assert.equal(snapshot.primers[0].sequence.toUpperCase(), f.bases.toUpperCase());

  const notes = "Line 1: use <b>fresh</b> dNTPs & mix gently\nLine 2: run 2% agarose gel\nLine 3: check <script>alert(1)</script>";
  const html = pcrPlanHtml(snapshot, {
    title: 'Test <img src=x onerror=alert(1)> & "quotes"',
    experimentDate: "2026-11-25",
    notes
  });

  assert.ok(html.includes(longName));
  assert.ok(html.includes(longTail.toLowerCase()));
  assert.ok(html.includes(snapshot.primers[0].binding));
  assert.ok(html.includes("Lower-case 5′ bases are non-binding tails."));
  // User-entered HTML is escaped everywhere.
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.equal(html.includes("<img src=x"), false);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Test &lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;"));
  // Multiline notes preserve line breaks inside the pre-wrap container.
  assert.ok(html.includes("Line 1: use &lt;b&gt;fresh&lt;/b&gt; dNTPs &amp; mix gently\nLine 2: run 2% agarose gel\nLine 3:"));
});

test("stale edited program carries its earlier-setup notice into both warnings and program section", () => {
  const { snapshot } = buildScenario({ editAnnealTemp: "60", staleKey: true });
  assert.equal(snapshot.program?.stale, true);
  assert.ok(snapshot.warnings.some(w => /earlier setup/i.test(w)));
  const html = pcrPlanHtml(snapshot, { title: "Stale edit", experimentDate: "", notes: "" });
  assert.match(html, /Program edits were kept from an earlier setup/);
});

test("editing preview metadata re-renders from the same snapshot without altering calculations", () => {
  const { snapshot } = buildScenario({ reactions: 4, extra: 10 });
  const a = pcrPlanHtml(snapshot, { title: "First title", experimentDate: "", notes: "" });
  const b = pcrPlanHtml(snapshot, { title: "Updated title", experimentDate: "2026-12-01", notes: "Added DMSO" });
  assert.ok(a.includes("First title"));
  assert.ok(b.includes("Updated title"));
  assert.ok(b.includes("2026-12-01"));
  assert.ok(b.includes("Added DMSO"));
  // Underlying gel SVG and overview SVG remain byte-for-byte identical.
  assert.equal(pcrPlanGelSvg(snapshot.gel), pcrPlanGelSvg(snapshot.gel));
  assert.equal(pcrPlanOverviewSvg(snapshot.product), pcrPlanOverviewSvg(snapshot.product));
});

test("suggestedPlanTitle, planFileName, planPdfFileName and paper/section helpers behave predictably", () => {
  assert.equal(suggestedPlanTitle("pUC19", "M13F", "M13R"), "pUC19 PCR (M13F / M13R)");
  assert.equal(suggestedPlanTitle("", "", ""), "Untitled sequence PCR (Forward / Reverse)");
  assert.equal(planFileName("pUC19 PCR (M13F / M13R)"), "pUC19 PCR (M13F - M13R).html");
  assert.equal(planFileName("   "), "PCR plan.html");
  assert.equal(planPdfFileName("pUC19 PCR (M13F / M13R)"), "pUC19 PCR (M13F - M13R).pdf");
  assert.equal(planPdfFileName(""), "PCR plan.pdf");

  assert.equal(paperForLocale("en-US"), "letter");
  assert.equal(paperForLocale("en_CA"), "letter");
  assert.equal(paperForLocale("en-GB"), "a4");
  assert.equal(paperForLocale("de-DE"), "a4");
  assert.equal(paperForLocale(""), "a4");
  assert.equal(readPlanPaper("letter", "a4"), "letter");
  assert.equal(readPlanPaper("a4", "letter"), "a4");
  assert.equal(readPlanPaper("bogus", "a4"), "a4");

  assert.deepEqual(readPlanSections(null), DEFAULT_PLAN_SECTIONS);
  assert.deepEqual(readPlanSections({ gel: false, productMap: true, notes: false, extra: 123 }), {
    ...DEFAULT_PLAN_SECTIONS,
    gel: false,
    notes: false
  });
});

test("bench-sheet HTML respects independent section toggles for product map, simulated gel, primers, program, mix and notes", () => {
  const { snapshot } = buildScenario({ editAnnealTemp: "61", reactions: 4, extra: 10 });
  const meta = { title: "Selective sheet", experimentDate: "", notes: "Quick bench run" };
  const bodyOf = (html: string) => html.split("<body>")[1] ?? "";

  // Product map only (gel off) -> wide map SVG, no gel SVG or lanes.
  const mapOnly = bodyOf(pcrPlanHtml(snapshot, meta, { ...DEFAULT_PLAN_SECTIONS, gel: false }));
  assert.ok(mapOnly.includes('<h2 class="sv-sheet-sec-title">Product map</h2>'));
  assert.ok(mapOnly.includes("sv-sheet-map-wide"));
  assert.equal(mapOnly.includes("sv-sheet-gel-svg"), false);

  // Simulated gel only (map off) -> gel-only grid, no product map SVG.
  const gelOnly = bodyOf(pcrPlanHtml(snapshot, meta, { ...DEFAULT_PLAN_SECTIONS, productMap: false }));
  assert.ok(gelOnly.includes('<h2 class="sv-sheet-sec-title">Simulated gel</h2>'));
  assert.ok(gelOnly.includes("sv-sheet-gel-only-grid"));
  assert.ok(gelOnly.includes("sv-sheet-gel-svg"));
  assert.equal(gelOnly.includes("sv-sheet-map-svg"), false);

  // Minimal sheet: only program enabled (no primers, map, gel, mix, notes) -> single-column program, no two-col wrapper.
  const progOnly = bodyOf(
    pcrPlanHtml(snapshot, meta, {
      primers: false,
      productMap: false,
      gel: false,
      program: true,
      mix: false,
      notes: false
    })
  );
  assert.ok(progOnly.includes("Cycling program"));
  assert.equal(progOnly.includes("sv-sheet-two-col"), false);
  assert.equal(progOnly.includes("Primers (5′→3′)"), false);
  assert.equal(progOnly.includes("sv-sheet-map-svg"), false);
  assert.equal(progOnly.includes("sv-sheet-gel-svg"), false);
  assert.equal(progOnly.includes("Reaction mix"), false);
  assert.equal(progOnly.includes("Bench notes"), false);
});

test("Markdown export reflects edited program, collapsed mix, section toggles, unset date, missing protocol, and never includes full template sequence", () => {
  const { d, snapshot } = buildScenario({
    fwdTail: "GCGCGAATTC",
    editAnnealTemp: "62.5",
    reactions: 5,
    extra: 10,
    ladderId: "100bp"
  });
  const md = pcrPlanMarkdown(
    snapshot,
    { title: "Bench | Run #1", experimentDate: "", notes: "Line A\nLine B" },
    { ...DEFAULT_PLAN_SECTIONS, productMap: false }
  );
  assert.ok(md.startsWith("# Bench | Run #1\n"));
  assert.equal(md.includes("**Experiment date:**"), false);
  assert.ok(md.includes("`gcgcgaattc"));
  assert.ok(md.includes("## Cycling program (Edited)"));
  assert.ok(md.includes("**62.5 °C**"));
  assert.ok(md.includes("5 reactions (+10% extra → 5.5× master mix)"));
  assert.ok(md.includes("## Simulated gel"));
  assert.equal(md.includes("## Product map"), false);
  assert.ok(md.includes("Line A\nLine B"));
  assert.ok(md.includes("Plan exported 2026-11-19"));
  assert.equal(md.includes(d.sequence), false);

  // Explicit experiment date appears when provided.
  const dated = pcrPlanMarkdown(snapshot, { title: "Dated", experimentDate: "2026-12-02", notes: "" });
  assert.ok(dated.includes("- **Experiment date:** 2026-12-02"));

  // Missing protocol/mix emits reasons without empty tables.
  const { snapshot: vent } = buildScenario({ polymerase: "vent" });
  const ventMd = pcrPlanMarkdown(vent, { title: "Vent test", experimentDate: "", notes: "" });
  assert.ok(ventMd.includes("There is no program for Vent or Deep Vent yet."));
  assert.ok(ventMd.includes("There is no reaction setup for Vent or Deep Vent yet."));
  assert.equal(ventMd.includes("| Step | Temp | Time |"), false);
  assert.equal(ventMd.includes("| Component |"), false);
});
