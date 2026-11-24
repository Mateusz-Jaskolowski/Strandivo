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
  escapeHtml,
  mdText,
  paperForLocale,
  PCR_PLAN_SHEET_CSS,
  pcrPlanGelLayout,
  pcrPlanGelSvg,
  pcrPlanHtml,
  pcrPlanMarkdown,
  pcrPlanOverviewSvg,
  planFileName,
  planPdfFileName,
  planWarnings,
  PRINT_GC_FILL,
  PRINT_GC_KEY,
  readPlanPaper,
  readPlanSections,
  suggestedPlanTitle,
  type PcrPlanSections
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
  linear?: boolean;
  /** Overrides the chosen digest's score, to stand for one whose bands are hard to tell apart. */
  digestScore?: number;
} = {}) {
  const d = puc19();
  if (opts.templateName !== undefined) d.name = opts.templateName;
  if (opts.linear) d.circular = false;
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
  const offered = overview.digests[opts.digestIndex ?? 0] ?? null;
  const digest = offered && opts.digestScore !== undefined ? { ...offered, score: opts.digestScore } : offered;
  const ladder = LADDERS.find(l => l.id === opts.ladderId) ?? LADDERS[0];
  const prefs: MixPrefs = {
    ...MIX_DEFAULTS,
    volume: opts.volume !== undefined ? opts.volume : MIX_DEFAULTS.volume,
    extra: opts.extra ?? MIX_DEFAULTS.extra
  };
  const mix = effectivePcrMix(polymerase, product.length, { reactions: opts.reactions ?? 1, optional: opts.optional ?? [] }, prefs);

  const snapshotInput: Parameters<typeof buildPcrPlanSnapshot>[0] = {
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
  };
  const snapshot = buildPcrPlanSnapshot(snapshotInput);
  return { d, f, r, product, overview, digest, ladder, mix, snapshot, input: snapshotInput };
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
  // The header still carries the distinct export date.
  assert.match(html, /Plan exported 2026-11-19/);
  // Blank notes leave ruled writing lines.
  assert.equal((html.match(/class="sv-sheet-notes-line"/g) ?? []).length, 4);
});

test("the snapshot note and export date ride on the header's lines, and there is no footer", () => {
  const { snapshot } = buildScenario();
  const html = pcrPlanHtml(snapshot, { title: "", experimentDate: "", notes: "" });
  const head = html.match(/<header class="sv-sheet-head">([\s\S]*?)<\/header>/)?.[1] ?? "";
  assert.match(
    head,
    /<div class="sv-sheet-kicker"><span>PCR Plan · Bench Sheet<\/span><span class="sv-sheet-head-note">Planning snapshot only — not a record that PCR was performed\.<\/span><\/div>/
  );
  assert.match(head, /<p class="sv-sheet-sub"><span>Template: [^]*?<\/span><span class="sv-sheet-head-note">Plan exported 2026-11-19 · Strandivo<\/span><\/p>/);
  // Said once each, and nothing after the last section to spill onto a page of its own.
  assert.equal(html.split("Planning snapshot only").length, 2);
  assert.equal(html.split("Plan exported").length, 2);
  assert.equal(/<footer|sv-sheet-foot/.test(html), false);
  assert.match(html, /<\/section>\s*<\/article>/);
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

test("a stale edited program is noted once: in its section, or among the warnings when the section is left out", () => {
  const { snapshot } = buildScenario({ editAnnealTemp: "60", staleKey: true });
  assert.equal(snapshot.program?.stale, true);
  assert.match(snapshot.programWarning ?? "", /earlier setup/);
  assert.equal(snapshot.warnings.some(w => /earlier setup/i.test(w)), false);
  const meta = { title: "Stale edit", experimentDate: "", notes: "" };
  const count = (text: string) => (text.match(/earlier setup/g) ?? []).length;

  const html = pcrPlanHtml(snapshot, meta);
  assert.equal(count(html), 1);
  assert.match(html, /Program edits were kept from an earlier setup/);
  const md = pcrPlanMarkdown(snapshot, meta);
  assert.equal(count(md), 1);
  assert.match(md, /> Note: Program edits were kept from an earlier setup/);

  const off = { ...DEFAULT_PLAN_SECTIONS, program: false };
  assert.deepEqual(planWarnings(snapshot, off), [snapshot.programWarning]);
  const htmlOff = pcrPlanHtml(snapshot, meta, off);
  assert.equal(count(htmlOff), 1);
  assert.match(htmlOff, /<li>Cycling program edits were kept from an earlier setup/);
  const mdOff = pcrPlanMarkdown(snapshot, meta, off);
  assert.equal(count(mdOff), 1);
  assert.match(mdOff, /## Warnings & notes\n\n- Cycling program edits were kept from an earlier setup/);
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
  assert.ok(md.startsWith("# Bench \\| Run \\#1\n"));
  assert.equal(md.includes("**Experiment date:**"), false);
  assert.ok(md.includes("`gcgcgaattc"));
  assert.ok(md.includes("## Cycling program (Edited)"));
  assert.ok(md.includes("**62.5 °C**"));
  assert.ok(md.includes("5 reactions (+10% extra → 5.5× master mix)"));
  assert.ok(md.includes("## Simulated gel"));
  assert.equal(md.includes("## Product map"), false);
  // Notes keep their line break as a hard break.
  assert.ok(md.includes("Line A\\\nLine B"));
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

// ---------- exact values, sections, warnings and escaping ----------

const SECTION_KEYS = Object.keys(DEFAULT_PLAN_SECTIONS) as (keyof PcrPlanSections)[];

test("the snapshot holds the fixture's exact product, primers, program and mix", () => {
  const { snapshot } = buildScenario({ editAnnealTemp: "61.5", editCycles: "28", reactions: 5, extra: 10 });
  // Primers at 101–122 and 1,401–1,422: 1,322 bp, as the positions say.
  assert.equal(snapshot.product.length, 1322);
  assert.equal(snapshot.template.spanText, "101–1,422 of 2,686 bp");
  assert.deepEqual(
    snapshot.primers.map(p => [p.role, p.length, p.binds]),
    [
      ["Forward", 22, "101–122 →"],
      ["Reverse", 22, "← 1,401–1,422"]
    ]
  );
  // NEB's Q5 plasmid program, with the anneal and cycles edited and the generated values kept.
  assert.deepEqual(
    snapshot.program?.stages.map(st => [st.cycles, st.originalCycles, st.steps.map(s => [s.name, s.temp, s.originalTemp, s.seconds, s.originalSeconds])]),
    [
      [null, null, [["Initial denaturation", 98, 98, 30, 30]]],
      [28, 25, [["Denature", 98, 98, 10, 10], ["Anneal", 61.5, 65, 20, 20], ["Extend", 72, 72, 20, 20]]],
      [null, null, [["Final extension", 72, 72, 120, 120], ["Hold", 4, 4, null, null]]]
    ]
  );
  // NEB's Q5 table for 25 µl, five reactions and 10% more (5.5×).
  assert.equal(snapshot.mix?.mixReactions, 5.5);
  assert.equal(snapshot.mix?.perTube, 24);
  assert.equal(snapshot.mix?.mixTotal, 132);
  assert.deepEqual(
    snapshot.mix?.rows.map(r => [r.name, r.each, r.mix]),
    [
      ["5X Q5 Reaction Buffer", 5, 27.5],
      ["10 mM dNTPs", 0.5, 2.75],
      ["10 µM forward primer", 1.25, 6.875],
      ["10 µM reverse primer", 1.25, 6.875],
      ["Q5 High-Fidelity DNA Polymerase", 0.25, 1.375],
      ["Nuclease-free water", 15.75, 86.625],
      ["Template DNA", 1, null]
    ]
  );

  const html = pcrPlanHtml(snapshot, { title: "Exact", experimentDate: "", notes: "" });
  assert.match(html, /<td class="sv-sheet-name">pUC19-F<\/td>/);
  assert.match(html, /1,322 bp · 55\.2% GC/);
  assert.match(html, /<span class="sv-sheet-edited">61\.5 °C<\/span><span class="sv-sheet-orig">\(gen\. 65 °C\)<\/span>/);
  assert.match(html, /<span class="sv-sheet-edited">28 cycles<\/span><span class="sv-sheet-orig">\(gen\. 25\)<\/span>/);
  for (const v of ["27.5", "2.75", "6.88", "1.38", "86.6", ">24<", ">132<"]) assert.ok(html.includes(v), v);
  const md = pcrPlanMarkdown(snapshot, { title: "Exact", experimentDate: "", notes: "" });
  assert.ok(md.includes("| &nbsp;&nbsp;Anneal | **61.5 °C** (gen. 65 °C) | 20 s |"));
  assert.ok(md.includes("| 10 µM forward primer | 1.25 | 6.88 | 0.5 µM |"));
  assert.ok(md.includes("| **Master mix** | **24** | **132** | |"));
});

test("the gel lanes and their bands sit where their sizes run against the ladder", () => {
  const { snapshot } = buildScenario();
  assert.equal(snapshot.gel.ladder.id, "1kb");
  assert.deepEqual(
    snapshot.gel.lanes.map(l => [l.number, l.what, l.sizesText]),
    [
      [1, "Template, supercoiled", "2,686 bp"],
      [2, "Template, BtsI", "1,507 + 1,159 + 20 bp"],
      [3, "Product, uncut", "1,322 bp"],
      [4, "Product, BtsI", "830 + 492 bp"]
    ]
  );
  const layout = pcrPlanGelLayout(snapshot.gel);
  const ladderY = (size: number) => layout.ladderBands.find(b => b.size === size)!.y;
  const band = (size: number) => layout.sampleBands.find(b => b.size === size)!;
  // Bigger fragments run less far: each band lies between the ladder bands around it.
  assert.ok(ladderY(1500) < band(1322).y && band(1322).y < ladderY(1000));
  assert.ok(ladderY(1000) < band(830).y && band(830).y < ladderY(500));
  // The supercoiled plasmid runs as about 1,880 bp, not at its 2,686 bp, and is drawn dashed.
  assert.equal(band(2686).uncut, true);
  assert.ok(ladderY(2000) < band(2686).y && band(2686).y < ladderY(1500));
  assert.ok(band(830).x > band(1322).x, "the digest lane is right of the uncut product");
});

test("every section can be left out on its own, in the HTML and the Markdown, and the choice is stored", () => {
  const { snapshot } = buildScenario({ reactions: 4 });
  const meta = { title: "Sections", experimentDate: "", notes: "" };
  const htmlMarks: Record<keyof PcrPlanSections, string> = {
    primers: '<h2 class="sv-sheet-sec-title">Primers (5′→3′)</h2>',
    productMap: 'class="sv-sheet-map-svg',
    gel: 'class="sv-sheet-gel-svg"',
    program: '<h2 class="sv-sheet-sec-title">Cycling program</h2>',
    mix: '<h2 class="sv-sheet-sec-title">Reaction mix</h2>',
    notes: '<h2 class="sv-sheet-sec-title">Bench notes &amp; observations</h2>'
  };
  const mdMarks: Record<keyof PcrPlanSections, string> = {
    primers: "## Primers (5′→3′)",
    productMap: "## Product map",
    gel: "## Simulated gel",
    program: "## Cycling program",
    mix: "## Reaction mix",
    notes: "## Bench notes & observations"
  };
  for (const key of SECTION_KEYS) {
    const sections = { ...DEFAULT_PLAN_SECTIONS, [key]: false };
    const html = pcrPlanHtml(snapshot, meta, sections).split("<body>")[1];
    const md = pcrPlanMarkdown(snapshot, meta, sections);
    for (const other of SECTION_KEYS) {
      assert.equal(html.includes(htmlMarks[other]), other !== key, `HTML without ${key}: ${other}`);
      assert.equal(md.includes(mdMarks[other]), other !== key, `Markdown without ${key}: ${other}`);
    }
    assert.deepEqual(readPlanSections(JSON.parse(JSON.stringify(sections))), sections, `stored without ${key}`);
  }
  const none = Object.fromEntries(SECTION_KEYS.map(k => [k, false])) as unknown as PcrPlanSections;
  const bare = pcrPlanMarkdown(snapshot, meta, none);
  for (const key of SECTION_KEYS) assert.equal(bare.includes(mdMarks[key]), false, key);
  assert.ok(bare.includes("- **Predicted product:** 1,322 bp"));
});

test("rendering never changes the snapshot or what it was built from", () => {
  const tmWarning = "One or both primer Tms could not be calculated, so annealing and cycling predictions are incomplete.";
  const given = ["Template has a nick."];
  const scenarios = [
    { label: "known Tms", built: buildScenario({ editAnnealTemp: "61", staleKey: true, reactions: 3, digestScore: 0.01 }), tmWarned: false },
    // An unknown Tm takes the branch that adds a warning to a copy of the input's list.
    { label: "unknown Tm", built: buildScenario({ polymerase: "q5", unknownTm: true, warnings: given }), tmWarned: true }
  ];
  for (const { label, built, tmWarned } of scenarios) {
    const { snapshot, input } = built;
    assert.equal(snapshot.warnings.includes(tmWarning), tmWarned, `${label}: the Tm warning`);
    const before = structuredClone(snapshot);
    const inputBefore = structuredClone({ draft: input.programDraft, mix: input.mix, digest: input.digest, warnings: input.warnings, primers: [input.forward, input.reverse] });
    const meta = { title: "Twice", experimentDate: "2026-11-30", notes: "a\nb" };
    for (const key of [null, ...SECTION_KEYS]) {
      const sections = key ? { ...DEFAULT_PLAN_SECTIONS, [key]: false } : DEFAULT_PLAN_SECTIONS;
      pcrPlanHtml(snapshot, meta, sections);
      pcrPlanMarkdown(snapshot, meta, sections);
      planWarnings(snapshot, sections);
    }
    assert.deepEqual(snapshot, before, label);
    const again = buildPcrPlanSnapshot(input);
    assert.deepEqual(again, before, `${label}: a second build gives the same snapshot`);
    assert.deepEqual({ draft: input.programDraft, mix: input.mix, digest: input.digest, warnings: input.warnings, primers: [input.forward, input.reverse] }, inputBefore, label);
  }
  const unknown = scenarios[1].built;
  assert.deepEqual(unknown.input.warnings, ["Template has a nick."], "the input's own list has no Tm warning");
  assert.deepEqual(unknown.snapshot.warnings, [...given, tmWarning]);
});

test("a hard-to-read digest is said once: with the gel, or among the warnings without it", () => {
  const { snapshot } = buildScenario({ digestScore: 0.01 });
  assert.match(snapshot.digestWarning ?? "", /^Selected digest \(BtsI\) has small or closely spaced bands/);
  const meta = { title: "Close bands", experimentDate: "", notes: "" };
  const said = (text: string) => (text.match(/hard to (?:resolve|tell apart)/g) ?? []).length;
  assert.equal(said(pcrPlanHtml(snapshot, meta)), 1);
  assert.equal(said(pcrPlanMarkdown(snapshot, meta)), 1);
  const noGel = { ...DEFAULT_PLAN_SECTIONS, gel: false };
  assert.equal(said(pcrPlanHtml(snapshot, meta, noGel)), 1);
  assert.match(pcrPlanMarkdown(snapshot, meta, noGel), /- Selected digest \(BtsI\) has small/);
});

test("a digest the template cannot run is explained with the gel or among the warnings, without adding a lane", () => {
  const pad = "ACGT".repeat(25);
  const sequence = pad + "CATGCATG" + pad + "CATG" + pad;
  const { input } = buildScenario();
  const template = { ...input.template, sequence };
  const forward: PlacedPrimer = { name: "F", start: 150, end: 169, strand: 1, bases: sequence.slice(150, 170) };
  const reverse: PlacedPrimer = { name: "R", start: 250, end: 269, strand: -1, bases: reverseComplement(sequence.slice(250, 270)) };
  const product = pcrProduct(sequence, true, forward, reverse);
  assert.ok(product);
  const overview = productOverview(product, sequence, true, { enzymeSource: "lab", enzymeFilter: "all", labEnzymes: ["NlaIII"], personalEnzymes: [] });
  const digest = overview.digests.find(candidate => digestName(candidate) === "NlaIII");
  assert.ok(digest);
  const setup = { ...input, template, forward, reverse, product, overview, digest, alignF: alignPrimer(forward, sequence), alignR: alignPrimer(reverse, sequence) };
  const snapshot = buildPcrPlanSnapshot(setup);
  const notice = "The template's NlaIII digest isn't shown. The cuts overlap on the two strands, so their fragments can’t be simulated.";
  assert.deepEqual(snapshot.gel.lanes.map(lane => [lane.what, lane.sizes]), [
    ["Template, supercoiled", [312]], ["Product, uncut", [120]], ["Product, NlaIII", [62, 58]]
  ]);
  assert.equal(snapshot.gel.templateDigestNotice, notice);

  const meta = { title: "Withheld digest", experimentDate: "", notes: "" };
  const noGel = { ...DEFAULT_PLAN_SECTIONS, gel: false };
  assert.equal(planWarnings(snapshot, DEFAULT_PLAN_SECTIONS).includes(notice), false);
  assert.ok(planWarnings(snapshot, noGel).includes(notice));
  const htmlNotice = escapeHtml(notice);
  const mdNotice = mdText(notice);
  const html = pcrPlanHtml(snapshot, meta);
  const md = pcrPlanMarkdown(snapshot, meta);
  assert.equal(html.split(htmlNotice).length - 1, 1);
  assert.equal(md.split(mdNotice).length - 1, 1);
  assert.ok(html.includes(`<p class="sv-sheet-note">${htmlNotice}</p>`));
  assert.ok(md.includes(`_${mdNotice}_`));
  const htmlOff = pcrPlanHtml(snapshot, meta, noGel);
  const mdOff = pcrPlanMarkdown(snapshot, meta, noGel);
  assert.equal(htmlOff.split(htmlNotice).length - 1, 1);
  assert.equal(mdOff.split(mdNotice).length - 1, 1);
  assert.ok(htmlOff.includes(`<li>${htmlNotice}</li>`));
  assert.ok(mdOff.includes(`\n- ${mdNotice}\n`));
  assert.equal(buildPcrPlanSnapshot({ ...setup, digest: null }).gel.templateDigestNotice, null);
  assert.equal(buildPcrPlanSnapshot({ ...setup, templateKind: "complex" }).gel.templateDigestNotice, null);
});

test("the supercoiled band is explained only when a lane draws one", () => {
  const meta = { title: "Lanes", experimentDate: "", notes: "" };
  const circular = buildScenario().snapshot;
  assert.ok(circular.gel.lanes.some(l => l.runsAs !== undefined));
  assert.match(pcrPlanHtml(circular, meta), /Template carryover runs fainter than the product; the dashed band is supercoiled plasmid\./);
  assert.match(pcrPlanMarkdown(circular, meta), /Supercoiled plasmid runs faster than linear DNA/);

  const linear = buildScenario({ linear: true }).snapshot;
  assert.ok(linear.gel.hasTemplateLanes, "a linear template still has its own lane");
  assert.equal(linear.gel.lanes.some(l => l.runsAs !== undefined), false);
  for (const text of [pcrPlanHtml(linear, meta).split("<body>")[1], pcrPlanMarkdown(linear, meta)]) {
    assert.match(text, /Template carryover runs fainter than the product\./);
    assert.equal(/supercoiled|dashed/i.test(text), false);
  }
});

/** The cells of a GFM table row, split at pipes no backslash escapes, as GFM and markdown-it split them. */
function tableCells(row: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let slashes = 0;
  for (const c of row.trim().slice(1, -1)) {
    if (c === "|" && slashes % 2 === 0) {
      cells.push(cell.trim());
      cell = "";
    } else cell += c;
    slashes = c === "\\" ? slashes + 1 : 0;
  }
  cells.push(cell.trim());
  return cells;
}
/** What a CommonMark reader shows for escaped text: a backslash before punctuation is dropped. */
const unescapeMd = (text: string) => text.replace(/\\([!-/:-@[-`{-~])/g, "$1");

test("Markdown keeps names and notes literal: a backslash before a pipe stays in one cell, punctuation stays inert", () => {
  const literal = 'pre\\|post *em* _u_ `code` [a](b) <b>x</b> &amp; $x$ #1 ~~s~~ 🧪';
  const { snapshot } = buildScenario({ fwdName: `${literal}\nnext line`, templateName: "pUC19 <v2> | *demo*" });
  const md = pcrPlanMarkdown(snapshot, { title: "T", experimentDate: "", notes: "" });
  const row = md.split("\n").find(l => l.startsWith("| Forward |"))!;
  const cells = tableCells(row);
  assert.equal(cells.length, 6, row);
  assert.equal(unescapeMd(cells[1]), `${literal} next line`);
  // Every Markdown character in the cell is escaped, so nothing in the name formats.
  assert.equal(/(^|[^\\])(\\\\)*[`*_[\]<>|~&$#]/.test(cells[1]), false, cells[1]);
  assert.ok(cells[1].includes("pre\\\\\\|post"));
  assert.equal(mdText("a\\|b"), "a\\\\\\|b");
  assert.ok(md.includes("- **Template:** pUC19 \\<v2\\> \\| \\*demo\\* (2,686 bp"));
});

test("Markdown keeps a name with any line ending in one cell: \\r\\n, a bare \\r and \\n", () => {
  for (const [label, ending] of [["CRLF", "\r\n"], ["CR", "\r"], ["LF", "\n"]]) {
    const name = `fwd${ending}injected | line`;
    const { snapshot } = buildScenario({ fwdName: name, templateName: `tpl${ending}name` });
    const md = pcrPlanMarkdown(snapshot, { title: `Ti${ending}tle`, experimentDate: "", notes: "" });
    const lines = md.split("\n");
    const header = lines.find(l => l.startsWith("| Dir |"))!;
    const row = lines.find(l => l.startsWith("| Forward |"));
    assert.ok(row, `${label}: the primer's row is one line`);
    assert.equal(tableCells(row).length, tableCells(header).length, `${label}: ${row}`);
    assert.equal(unescapeMd(tableCells(row)[1]), "fwd injected | line", label);
    assert.equal(md.includes("\r"), false, `${label}: no carriage return is left in the Markdown`);
    assert.ok(md.startsWith("# Ti tle\n"), label);
    assert.ok(md.includes("- **Template:** tpl name ("), label);
  }
  assert.equal(mdText("a\r\nb\rc\nd"), "a b c d");
});

test("Markdown notes are literal text with their line breaks kept", () => {
  const { snapshot } = buildScenario();
  const notes = "- not a list\n1. not a step\n# not a heading\n> not a quote\n---\n+ not a list\n1) not a step\n===\n\nAfter a blank line *still* plain \\";
  const md = pcrPlanMarkdown(snapshot, { title: "Notes", experimentDate: "", notes });
  const body = md.split("## Bench notes & observations\n\n")[1].split("\n\n---\n")[0];
  assert.equal(
    body,
    ["\\- not a list\\", "1\\. not a step\\", "\\# not a heading\\", "\\> not a quote\\", "\\---\\", "\\+ not a list\\", "1\\) not a step\\", "\\===", "", "After a blank line \\*still\\* plain \\\\"].join("\n")
  );
});

test("Markdown prints bases in a code span only when they are all letters, and as escaped text otherwise", () => {
  const { snapshot } = buildScenario({ fwdTail: "GCGCGAATTC" });
  const meta = { title: "Bases", experimentDate: "", notes: "" };
  const rowOf = (s: typeof snapshot, role: string) => pcrPlanMarkdown(s, meta).split("\n").find(l => l.startsWith(`| ${role} |`))!;
  const forward = snapshot.primers[0];
  assert.equal(forward.sequence, forward.sequence.replace(/[^A-Za-z]/g, ""));
  assert.ok(rowOf(snapshot, "Forward").includes(`| \`${forward.sequence}\` |`), "letters only: a code span");
  // A file can give a primer anything: what Markdown treats specially must not format, split the cell or reach a code span.
  const odd = "ACGT*N_x|a\\b`c`<d>";
  const withForward = (sequence: string): typeof snapshot => ({ ...snapshot, primers: [{ ...forward, sequence }, snapshot.primers[1]] });
  const changed = withForward(odd);
  const row = rowOf(changed, "Forward");
  assert.ok(row.includes("| ACGT\\*N\\_x\\|a\\\\b\\`c\\`\\<d\\> |"), row);
  assert.equal(row.includes("`" + odd), false, "not in a code span");
  assert.equal(tableCells(row).length, 6, row);
  assert.equal(unescapeMd(tableCells(row)[2]), odd);
  // An empty sequence is not letters either: no empty code span.
  assert.equal(rowOf(withForward(""), "Forward").includes("``"), false);
});

test("the Markdown's predicted product line is pinned: bases, GC to one decimal and the tail note", () => {
  const plain = pcrPlanMarkdown(buildScenario().snapshot, { title: "Product", experimentDate: "", notes: "" });
  assert.ok(plain.split("\n").includes("- **Predicted product:** 1,322 bp · 55.2% GC"), plain);
  const tailed = buildScenario({ fwdTail: "GCGCGAATTC" }).snapshot;
  assert.equal(tailed.product.hasTails, true);
  const line = pcrPlanMarkdown(tailed, { title: "Product", experimentDate: "", notes: "" })
    .split("\n")
    .find(l => l.startsWith("- **Predicted product:**"));
  assert.equal(line, `- **Predicted product:** ${tailed.product.length.toLocaleString("en-US")} bp · ${tailed.product.gcPercent.toFixed(1)}% GC (5′ tails incl.)`);
  assert.match(line!, /^- \*\*Predicted product:\*\* 1,332 bp · \d\d\.\d% GC \(5′ tails incl\.\)$/);
});

test("Markdown warnings are escaped like every other text", () => {
  const { snapshot } = buildScenario({ warnings: ["Primer *F* | bad <b> text_1", "Plain note."] });
  const md = pcrPlanMarkdown(snapshot, { title: "Warn", experimentDate: "", notes: "" });
  const lines = md.split("\n");
  const at = lines.indexOf("## Warnings & notes");
  assert.ok(at > 0);
  assert.deepEqual(lines.slice(at + 1, at + 5), ["", "- Primer \\*F\\* \\| bad \\<b\\> text\\_1", "- Plain note.", ""]);
  assert.equal(md.includes("Primer *F*"), false);
});

test("Markdown notes of only spaces and line breaks are the same as no notes", () => {
  const { snapshot } = buildScenario();
  const empty = pcrPlanMarkdown(snapshot, { title: "Blank", experimentDate: "", notes: "" });
  for (const notes of ["   ", " \t ", "  \n   \n ", "\r\n  \r\n"]) {
    assert.equal(pcrPlanMarkdown(snapshot, { title: "Blank", experimentDate: "", notes }), empty, JSON.stringify(notes));
  }
  assert.ok(empty.includes("## Bench notes & observations\n\n_None_"));
});

test("an edited cycle count is bold once in the Markdown row", () => {
  const { snapshot } = buildScenario({ editCycles: "28" });
  const md = pcrPlanMarkdown(snapshot, { title: "Cycles", experimentDate: "", notes: "" });
  assert.ok(md.includes("| Repeat **28 cycles** (gen. 25) | | |"));
  assert.equal(/\*\*Repeat|\*\*\*\*/.test(md), false);
  const plain = pcrPlanMarkdown(buildScenario().snapshot, { title: "Cycles", experimentDate: "", notes: "" });
  assert.ok(plain.includes("| Repeat 25 cycles | | |"));
});

test("names and sequences from the file are escaped in the saved HTML, which stays offline", () => {
  const { snapshot } = buildScenario({ fwdName: '<img src=x onerror=alert(1)>"F"', templateName: "pUC19 <script>x</script>" });
  const html = pcrPlanHtml(snapshot, { title: "Escapes", experimentDate: "", notes: "" });
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;&quot;F&quot;"));
  assert.ok(html.includes("pUC19 &lt;script&gt;x&lt;/script&gt;"));
  assert.equal(/<img\b|<script\b|<link\b|\s(?:src|href)=["']|url\(|@import/i.test(html), false);
});

test("the master mix total is printed once, as the table's last row", () => {
  const { snapshot } = buildScenario({ reactions: 5 });
  const html = pcrPlanHtml(snapshot, { title: "Total", experimentDate: "", notes: "" });
  assert.equal((html.match(/<td>Master mix<\/td>/g) ?? []).length, 1);
  assert.equal(html.includes("<tfoot"), false);
  assert.match(html, /<tr class="sv-sheet-total"><td>Master mix<\/td>[^]*?<\/tr><\/tbody>/);
  // One reaction needs no total.
  const single = pcrPlanHtml(buildScenario({ reactions: 1 }).snapshot, { title: "One", experimentDate: "", notes: "" });
  assert.equal(single.includes("Master mix</td>"), false);
});

test("short sections and blank writing lines are kept on one page; written notes may run on", () => {
  const { snapshot } = buildScenario({ reactions: 5 });
  const blank = pcrPlanHtml(snapshot, { title: "Breaks", experimentDate: "", notes: "" });
  for (const title of ["Primers (5′→3′)", "Cycling program", "Reaction mix", "Bench notes &amp; observations"]) {
    assert.match(blank, new RegExp(`<section class="sv-sheet-sec sv-sheet-avoid">\\s*<div class="sv-sheet-sec-head">\\s*<h2 class="sv-sheet-sec-title">${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), title);
  }
  const written = pcrPlanHtml(snapshot, { title: "Breaks", experimentDate: "", notes: "Fourteen lines…" });
  assert.match(written, /<section class="sv-sheet-sec">\s*<div class="sv-sheet-sec-head">\s*<h2 class="sv-sheet-sec-title">Bench notes/);
});

test("the GC strip's five levels read apart in grey and each has a key", () => {
  // Grey as a printer driver or Ghostscript makes it (0.30 R + 0.59 G + 0.11 B).
  const grey = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return 0.3 * r + 0.59 * g + 0.11 * b;
  };
  const levels = PRINT_GC_KEY.map(k => grey(PRINT_GC_FILL[k.level]));
  for (let i = 0; i < levels.length; i++) for (let j = i + 1; j < levels.length; j++) assert.ok(Math.abs(levels[i] - levels[j]) >= 30, `${PRINT_GC_KEY[i].level} vs ${PRINT_GC_KEY[j].level}`);
  assert.deepEqual(
    PRINT_GC_KEY.map(k => k.label),
    ["AT-rich (<35%)", "35–40%", "40–60%", "60–65%", "GC-rich (>65%)"]
  );
  const html = pcrPlanHtml(buildScenario().snapshot, { title: "GC", experimentDate: "", notes: "" });
  for (const k of PRINT_GC_KEY) assert.ok(html.includes(`background:${PRINT_GC_FILL[k.level]}"></span>${k.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}`), k.label);
});

test("suggested file names keep whole characters, fit in bytes and avoid names Windows keeps", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const emoji = planFileName("🧪".repeat(60));
  assert.ok(bytes(emoji) <= 160 && emoji.endsWith(".html"));
  assert.equal(emoji.replace(/\.html$/, ""), "🧪".repeat(emoji.replace(/\.html$/, "").length / 2), "no half emoji");
  const family = "👩‍🔬".repeat(20);
  const cut = planPdfFileName(family).replace(/\.pdf$/, "");
  assert.ok(family.startsWith(cut) && cut.length % "👩‍🔬".length === 0, "a joined emoji is never split");
  const cjk = planFileName("聚合酶链式反应".repeat(20));
  assert.ok(bytes(cjk) <= 160, String(bytes(cjk)));
  assert.equal(planFileName("CON"), "PCR plan CON.html");
  assert.equal(planFileName("nul.backup"), "PCR plan nul.backup.html");
  // Every device name Windows keeps, with or without an extension and in any case.
  for (const [title, kept] of [
    ["LPT1", "PCR plan LPT1"],
    ["lpt³", "PCR plan lpt³"],
    ["aux", "PCR plan aux"],
    ["AUX.log", "PCR plan AUX.log"],
    ["PRN.txt", "PCR plan PRN.txt"],
    ["prn", "PCR plan prn"],
    ["COM1", "PCR plan COM1"],
    ["com²", "PCR plan com²"],
    ["Com9.backup", "PCR plan Com9.backup"]
  ]) {
    assert.equal(planFileName(title), `${kept}.html`, title);
    assert.equal(planPdfFileName(title), `${kept}.pdf`, title);
  }
  assert.equal(planPdfFileName("CON"), "PCR plan CON.pdf");
  assert.equal(planPdfFileName("nul.backup"), "PCR plan nul.backup.pdf");
  // Names that only start like a device are left alone.
  for (const title of ["com", "LPT", "COM10", "auxiliary", "Printer run"]) assert.equal(planFileName(title), `${title}.html`, title);
  assert.equal(planFileName("Console run"), "Console run.html");
  assert.equal(planFileName("..hidden.."), "hidden.html");
  assert.equal(planFileName("a\tb\nc\u0007d"), "a b c d.html");
  assert.equal(planFileName("Run: 1/2 <final>?"), "Run- 1-2 -final-.html");
  assert.equal(planFileName("é"), "é.html", "NFC");
});

// ---------- the two stylesheets ----------

/** `selector → declarations` for each rule, with the @media it sits in, comments dropped. */
function cssRules(css: string): Map<string, string> {
  const rules = new Map<string, string>();
  const text = css.replace(/\/\*[^]*?\*\//g, "");
  const walk = (block: string, media: string) => {
    let i = 0;
    for (let open = block.indexOf("{", i); open >= 0; open = block.indexOf("{", i)) {
      const head = block.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      for (; j < block.length && depth > 0; j++) depth += block[j] === "{" ? 1 : block[j] === "}" ? -1 : 0;
      const inner = block.slice(open + 1, j - 1);
      if (head.startsWith("@media")) walk(inner, head.replace(/\s+/g, " "));
      else
        for (const sel of head.split(",").map(x => x.trim().replace(/\s+/g, " ")))
          rules.set(`${media}|${sel}`, inner.split(";").map(d => d.trim().replace(/\s+/g, " ")).filter(Boolean).join("; "));
      i = j;
    }
  };
  walk(text, "");
  return rules;
}

const documentCss = readFileSync(new URL("../doc/document.css", import.meta.url), "utf8");
const liveSheetCss = documentCss.slice(documentCss.indexOf("/* ---------- printable PCR plan preview & bench sheet ---------- */"));

test("the in-app sheet and the saved file share their sheet styles", () => {
  const live = cssRules(liveSheetCss);
  const saved = cssRules(PCR_PLAN_SHEET_CSS);
  // The in-app sheet uses the app's monospace token; the page and paper around it differ by design.
  const mono = (decls: string) => decls.replace("font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", "font-family: var(--mono)");
  const own = new Set(["|.sv-sheet", "@media print|.sv-sheet"]);
  let compared = 0;
  for (const [key, decls] of saved) {
    const selector = key.split("|")[1];
    if (!selector.startsWith(".sv-sheet") || own.has(key)) continue;
    assert.equal(live.get(key), mono(decls), key);
    compared++;
  }
  assert.ok(compared > 50, String(compared));
});

test("the in-app sheet's map and gel are drawn in the colours of the saved file's", () => {
  const hex = /#[0-9a-f]{3,8}\b/gi;
  // A product with sites that name themselves (unique and not) and a crowd of close ones, so every kind of mark is drawn.
  const { snapshot } = buildScenario({ digestIndex: 0 });
  const cutSites = [
    { enzyme: "UniqueI", cut: 100, unique: true },
    { enzyme: "TwiceI", cut: 400, unique: false },
    ...Array.from({ length: 12 }, (_, i) => ({ enzyme: `Near${i}`, cut: 700 + i * 3, unique: i % 2 === 0 }))
  ];
  const drawn = { ...snapshot, product: { ...snapshot.product, cutSites } };
  const html = pcrPlanHtml(drawn, { title: "Colours", experimentDate: "", notes: "" }).split("<body>")[1];
  const svgs = html.match(/<svg\b[^]*?<\/svg>/g) ?? [];
  const mapSvg = svgs.filter(s => s.includes('class="sv-sheet-map-svg'));
  const gelSvg = svgs.filter(s => s.includes('class="sv-sheet-gel-svg'));
  assert.equal(mapSvg.length, 1);
  assert.equal(gelSvg.length, 1);
  assert.equal(mapSvg[0], pcrPlanOverviewSvg(drawn.product), "the saved file draws the map pcrPlanOverviewSvg gives");
  assert.equal(gelSvg[0], pcrPlanGelSvg(drawn.gel), "the saved file draws the gel pcrPlanGelSvg gives");

  // Saved file: colours in `fill` and `stroke` attributes. The strip's levels are one table both sheets read.
  const strip = new Set(Object.values(PRINT_GC_FILL).map(c => c.toLowerCase()));
  const attributes = [...(mapSvg[0] + gelSvg[0]).matchAll(/\b(?:fill|stroke)="(#[0-9a-fA-F]{3,8})"/g)].map(m => m[1].toLowerCase());
  assert.ok(attributes.some(c => strip.has(c)), "the strip is drawn");
  const savedColours = new Set(attributes.filter(c => !strip.has(c)));

  // In-app sheet: colours the stylesheet gives the classes of the map's and gel's marks (not their boxes' borders or backgrounds).
  const liveColours = new Set<string>();
  for (const [key, decls] of cssRules(liveSheetCss)) {
    const [media, selector] = key.split("|");
    if (media !== "" || !/^\.sv-sheet-(map|gel)-/.test(selector)) continue;
    for (const decl of decls.split("; ")) {
      const [prop, value] = [decl.slice(0, decl.indexOf(":")).trim(), decl.slice(decl.indexOf(":") + 1)];
      if (prop === "fill" || prop === "stroke") for (const c of value.match(hex) ?? []) liveColours.add(c.toLowerCase());
    }
  }
  assert.ok(savedColours.size >= 12 && liveColours.size >= 12, `${savedColours.size} saved, ${liveColours.size} live`);
  assert.deepEqual([...savedColours].sort(), [...liveColours].sort());
});

test("the sheet keeps its columns on paper, prints light, and breaks only where it should", () => {
  const live = cssRules(liveSheetCss);
  const saved = cssRules(PCR_PLAN_SHEET_CSS);
  // The narrow-window layout is for screens only: A4's printable width is about 720 px in some engines.
  for (const media of new Set([...live.keys()].map(k => k.split("|")[0]))) {
    if (/max-width/.test(media)) assert.match(media, /^@media screen and/, media);
  }
  assert.match(live.get("@media print|html.sv-printing") ?? "", /color-scheme: light !important/);
  assert.match(saved.get("|:root") ?? "", /color-scheme: light/);
  for (const rules of [live, saved]) {
    assert.match(rules.get("|.sv-sheet-avoid") ?? "", /break-inside: avoid/);
    assert.match(rules.get("|.sv-sheet-two-col") ?? "", /break-inside: avoid/);
    assert.match(rules.get("|.sv-sheet-total") ?? "", /break-before: avoid/);
    assert.match(rules.get("|.sv-sheet-table .sv-sheet-num") ?? "", /text-align: right/);
    assert.match(rules.get("|.sv-sheet-table .sv-sheet-step-indent") ?? "", /padding-left: 14px/);
    assert.equal([...rules.values()].some(d => d.includes("!important") && /text-align|padding-left/.test(d)), false);
  }
});
