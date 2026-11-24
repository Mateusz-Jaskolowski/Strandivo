// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Preview dialog and native print mirror for a printable PCR bench sheet.
// Consumes one immutable PcrPlanSnapshot so preview, print, PDF, offline HTML and Markdown
// all stay identical while local metadata (title, date, notes) and section toggles update live.
// The sheet is built here as DOM for the preview and the print mirror, and as a string by
// `pcrPlanHtml` for the saved file: a change to one goes into the other, and their styles
// (`src/doc/document.css`, `PCR_PLAN_SHEET_CSS`) are held together by `pcrPrint.test.ts`.

import type { DocContext } from "../doc/context.ts";
import { fmtVolume } from "../lib/pcrMix.ts";
import {
  DEFAULT_PLAN_SECTIONS,
  mixSummaryText,
  paperForLocale,
  pcrPlanGelLayout,
  pcrPlanGelNotes,
  pcrPlanHtml,
  pcrPlanMarkdown,
  pcrPlanOverviewLayout,
  planFileName,
  planPdfFileName,
  planWarnings,
  PRINT_GC_FILL,
  PRINT_GC_KEY,
  readPlanPaper,
  readPlanSections,
  type PcrPlanMeta,
  type PcrPlanSections,
  type PcrPlanSnapshot,
  type PcrPlanStage,
  type PcrPlanStep,
  type PlanPaper
} from "../lib/pcrPrint.ts";
import { durationText } from "../lib/pcrProgram.ts";
import { canSavePdf, chooseSavePath, printWindow, saveText, saveWindowPdf } from "../platform.ts";
import { h, toast } from "../ui/dom.ts";
import { fmt } from "../ui/format.ts";
import { iconSvg } from "../ui/icons.ts";
import { s } from "../ui/svg.ts";
import { copyText } from "./inspector.ts";

const SECTIONS_KEY = "strandivo.pcrPrintSections";
const PAPER_KEY = "strandivo.pcrPrintPaper";

function loadSavedSections(): PcrPlanSections {
  try {
    return readPlanSections(JSON.parse(localStorage.getItem(SECTIONS_KEY) || "null"));
  } catch {
    return { ...DEFAULT_PLAN_SECTIONS };
  }
}

function savePrintPrefs(sections: PcrPlanSections, paper: PlanPaper) {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
    localStorage.setItem(PAPER_KEY, paper);
  } catch {
    /* storage unavailable */
  }
}

function loadSavedPaper(): PlanPaper {
  const fallback = paperForLocale(typeof navigator !== "undefined" ? navigator.language || "" : "");
  try {
    return readPlanPaper(localStorage.getItem(PAPER_KEY), fallback);
  } catch {
    return fallback;
  }
}

/** An error's message as a sentence, for after a colon in a toast. */
function errorText(e: unknown): string {
  const text = (e instanceof Error ? e.message : String(e)).trim();
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/**
 * The preview open now, if any. One at a time: both would print through the same page, and
 * focus can leave a dialog for the PCR dialog's button behind it.
 */
let openPreview: { focus: () => void } | null = null;

interface SheetHandles {
  el: HTMLElement;
  sync: (meta: PcrPlanMeta, sections: PcrPlanSections) => void;
}

function buildGelSvgDom(gel: PcrPlanSnapshot["gel"]): SVGSVGElement {
  const layout = pcrPlanGelLayout(gel);
  const root = s("svg", {
    width: layout.width,
    height: layout.height,
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    class: "sv-sheet-gel-svg",
    role: "img",
    "aria-label": gel.ariaLabel
  });
  root.appendChild(s("rect", { x: layout.gelX, y: layout.gelY, width: layout.gelWidth, height: layout.gelHeight, rx: 5, class: "sv-sheet-gel-bg" }));
  for (const w of layout.wells) {
    root.appendChild(s("rect", { x: w.x, y: w.y, width: w.width, height: w.height, rx: 1, class: "sv-sheet-gel-well" }));
  }
  for (const l of layout.laneLabels) {
    root.appendChild(s("text", { x: l.x, y: l.y, "text-anchor": "middle", class: "sv-sheet-gel-lane" }, l.label));
  }
  for (const lb of layout.ladderBands) {
    root.appendChild(s("rect", { x: lb.x, y: lb.y, width: lb.width, height: lb.height, rx: 0.8, class: "sv-sheet-gel-ladder-band", "fill-opacity": lb.opacity.toFixed(2) }));
    if (lb.label !== null) {
      root.appendChild(s("text", { x: lb.labelX, y: lb.labelY, "text-anchor": "end", class: "sv-sheet-gel-size" }, lb.label));
    }
  }
  for (const sb of layout.sampleBands) {
    root.appendChild(
      sb.uncut
        ? s("rect", { x: sb.x, y: sb.y, width: sb.width, height: sb.height, rx: 0.8, class: "sv-sheet-gel-band-uncut" })
        : s("rect", { x: sb.x, y: sb.y, width: sb.width, height: sb.height, rx: 0.8, class: "sv-sheet-gel-band", "fill-opacity": sb.opacity.toFixed(2) })
    );
  }
  return root;
}

function buildOverviewSvgDom(product: PcrPlanSnapshot["product"], width = 440): SVGSVGElement {
  const lay = pcrPlanOverviewLayout(product, width);
  const root = s("svg", {
    width: lay.width,
    height: lay.height,
    viewBox: `0 0 ${lay.width} ${lay.height}`,
    class: width > 460 ? "sv-sheet-map-svg sv-sheet-map-wide" : "sv-sheet-map-svg",
    role: "img",
    "aria-label": `Linear PCR product map (${fmt(product.length)} bp) with restriction cut sites and GC content strip`
  });
  for (const l of lay.labels) {
    const cx = l.x + l.width / 2;
    root.appendChild(s("polyline", { points: `${cx},${l.y + 13} ${cx},${l.y + 16} ${l.anchor},${lay.lineY}`, fill: "none", class: "sv-sheet-map-leader" }));
    root.appendChild(s("rect", { x: l.x, y: l.y, width: l.width, height: 13, rx: 2.5, class: l.unique ? "sv-sheet-map-chip-unique" : "sv-sheet-map-chip" }));
    root.appendChild(s("text", { x: cx, y: l.y + 9.5, "text-anchor": "middle", class: l.unique ? "sv-sheet-map-label-unique" : "sv-sheet-map-label" }, l.enzyme));
  }
  for (const c of lay.crowds) {
    const cx = c.x + c.width / 2;
    for (const t of c.ticks) {
      root.appendChild(s("line", { x1: t, y1: lay.lineY - 4, x2: t, y2: lay.lineY, class: "sv-sheet-map-tick" }));
    }
    root.appendChild(s("polyline", { points: `${cx},13 ${cx},16 ${c.anchor},${lay.lineY}`, fill: "none", class: "sv-sheet-map-leader" }));
    root.appendChild(s("rect", { x: c.x, y: c.y, width: c.width, height: 13, rx: 2.5, class: "sv-sheet-map-crowd" }));
    root.appendChild(s("text", { x: cx, y: c.y + 9.5, "text-anchor": "middle", class: "sv-sheet-map-crowd-label" }, `+${c.count}`));
  }
  root.appendChild(s("line", { x1: 0, y1: lay.lineY, x2: lay.width, y2: lay.lineY, class: "sv-sheet-map-backbone" }));
  root.appendChild(s("rect", { x: 0, y: lay.gcY, width: lay.width, height: lay.gcHeight, rx: 1.5, class: "sv-sheet-map-gc-bg" }));
  for (const r of lay.gcRects) {
    root.appendChild(s("rect", { x: r.x, y: lay.gcY, width: r.width, height: lay.gcHeight, fill: PRINT_GC_FILL[r.level] }));
  }
  root.appendChild(s("text", { x: 0, y: lay.gcY + lay.gcHeight + 11, class: "sv-sheet-map-end" }, "1"));
  root.appendChild(s("text", { x: lay.width, y: lay.gcY + lay.gcHeight + 11, "text-anchor": "end", class: "sv-sheet-map-end" }, `${fmt(product.length)} bp`));
  return root;
}

function stepTempNodes(step: PcrPlanStep): Node[] {
  const cur = `${step.temp} °C`;
  if (!step.tempEdited) return [document.createTextNode(cur)];
  return [h("span", { class: "sv-sheet-edited" }, cur), h("span", { class: "sv-sheet-orig" }, `(gen. ${step.originalTemp} °C)`)];
}

function stepTimeNodes(step: PcrPlanStep): Node[] {
  if (step.seconds === null) return [document.createTextNode("Hold (∞)")];
  const cur = durationText(step.seconds);
  if (!step.secondsEdited || step.originalSeconds === null) return [document.createTextNode(cur)];
  return [h("span", { class: "sv-sheet-edited" }, cur), h("span", { class: "sv-sheet-orig" }, `(gen. ${durationText(step.originalSeconds)})`)];
}

function stageCyclesNodes(stage: PcrPlanStage): Node[] {
  const cur = `${stage.cycles} cycles`;
  if (!stage.cyclesEdited || stage.originalCycles === null) return [document.createTextNode(cur)];
  return [h("span", { class: "sv-sheet-edited" }, cur), h("span", { class: "sv-sheet-orig" }, `(gen. ${stage.originalCycles})`)];
}

function buildSheetDom(snapshot: PcrPlanSnapshot, initialMeta: PcrPlanMeta, initialSections: PcrPlanSections): SheetHandles {
  const titleEl = h("h1", { class: "sv-sheet-title" });
  const dateSlot = h("div", { class: "sv-sheet-date-slot" });
  const notesSlot = h("div", { class: "sv-sheet-notes-slot" });

  const facts: [string, string][] = [
    ["Predicted product", `${fmt(snapshot.product.length)} bp · ${snapshot.product.gcPercent.toFixed(1)}% GC${snapshot.product.hasTails ? " (5′ tails incl.)" : ""}`],
    ["Polymerase", snapshot.polymerase.name],
    ["Annealing", snapshot.product.annealText ? `${snapshot.product.annealText}${snapshot.product.annealRule ? ` (${snapshot.product.annealRule})` : ""}` : "Unavailable (Tm unknown)"],
    ["Template span", snapshot.template.spanText],
    ["Product ends", snapshot.product.ends],
    ["Features", snapshot.product.featuresText]
  ];

  const primerNotes: string[] = [];
  if (snapshot.product.hasTails) primerNotes.push("Lower-case 5′ bases are non-binding tails.");
  if (snapshot.product.tmDiffText) primerNotes.push(`Primer Tms are ${snapshot.product.tmDiffText}.`);
  if (snapshot.polymerase.tmNote) primerNotes.push(`${snapshot.polymerase.tmNote}.`);

  const primersSection = h(
    "section",
    { class: "sv-sheet-sec sv-sheet-avoid", "data-sheet-sec": "primers" },
    h(
      "div",
      { class: "sv-sheet-sec-head" },
      h("h2", { class: "sv-sheet-sec-title" }, "Primers (5′→3′)"),
      h("span", { class: "sv-sheet-sec-meta" }, `${snapshot.polymerase.name} Tm rule`)
    ),
    h(
      "table",
      { class: "sv-sheet-table" },
      h(
        "thead",
        null,
        h("tr", null, h("th", null, "Dir"), h("th", null, "Name"), h("th", null, "Sequence (5′→3′)"), h("th", { class: "sv-sheet-num" }, "Len"), h("th", { class: "sv-sheet-num" }, "Tm"), h("th", null, "Binds"))
      ),
      h(
        "tbody",
        null,
        ...snapshot.primers.map(p =>
          h(
            "tr",
            null,
            h("td", null, p.role),
            h("td", { class: "sv-sheet-name" }, p.name),
            h("td", { class: "sv-sheet-seq" }, p.tail ? h("span", { class: "sv-sheet-tail" }, p.tail) : null, p.binding),
            h("td", { class: "sv-sheet-num sv-sheet-mono" }, `${fmt(p.length)} nt`),
            h("td", { class: "sv-sheet-num sv-sheet-mono" }, p.tm === null ? "—" : `${p.tm.toFixed(1)} °C`),
            h("td", { class: "sv-sheet-mono sv-sheet-dim" }, p.binds)
          )
        )
      )
    ),
    primerNotes.length ? h("p", { class: "sv-sheet-note" }, primerNotes.join(" ")) : null
  );

  const buildGcLegend = () =>
    h(
      "div",
      { class: "sv-sheet-gc-legend" },
      h("span", null, `GC (${fmt(snapshot.product.gcWindow)} bp window):`),
      ...PRINT_GC_KEY.map(k => h("span", null, h("span", { class: "sv-sheet-gc-swatch", style: { background: PRINT_GC_FILL[k.level] } }), k.label))
    );

  const gelNotes = pcrPlanGelNotes(snapshot.gel, true);
  const buildGelDetails = (): Node[] => [
    h("p", { class: "sv-sheet-note" }, h("strong", null, "Digest: "), snapshot.digest ? `${snapshot.digest.name} — ${snapshot.digestNote}` : snapshot.digestNote),
    h(
      "ul",
      { class: "sv-sheet-lanes", "aria-label": "Expected gel bands" },
      ...snapshot.gel.lanes.map(l =>
        h("li", null, h("span", { class: "sv-sheet-lane-no" }, String(l.number)), h("span", null, l.what), h("span", { class: "sv-sheet-mono" }, l.sizesText))
      )
    ),
    ...gelNotes.map(note => h("p", { class: "sv-sheet-note" }, note))
  ];

  const buildFlanksNote = () =>
    snapshot.product.tailFlankNotes.length
      ? h("p", { class: "sv-sheet-note" }, h("strong", null, "Tail cut-site flanks: "), snapshot.product.tailFlankNotes.join(" "))
      : null;

  const buildGelBox = () => h("div", { class: "sv-sheet-gel-box" }, buildGelSvgDom(snapshot.gel), h("div", { class: "sv-sheet-gel-caption" }, `M: ${snapshot.gel.ladder.name}`));

  const overviewSlot = h("div", { class: "sv-sheet-slot" });
  const warningsSlot = h("div", { class: "sv-sheet-slot" });
  const protocolSlot = h("div", { class: "sv-sheet-slot" });

  const programSection = snapshot.program
    ? (() => {
        const p = snapshot.program;
        const rows: HTMLElement[] = [];
        for (const st of p.stages) {
          if (st.cycles === null) {
            for (const step of st.steps) {
              rows.push(
                h(
                  "tr",
                  null,
                  h("td", null, step.name),
                  h("td", { class: "sv-sheet-num sv-sheet-mono" }, ...stepTempNodes(step)),
                  h("td", { class: "sv-sheet-num sv-sheet-mono" }, ...stepTimeNodes(step))
                )
              );
            }
          } else {
            rows.push(h("tr", { class: "sv-sheet-stage-row" }, h("td", { colSpan: 3 }, "Repeat ", ...stageCyclesNodes(st))));
            for (const step of st.steps) {
              rows.push(
                h(
                  "tr",
                  null,
                  h("td", { class: "sv-sheet-step-indent" }, step.name),
                  h("td", { class: "sv-sheet-num sv-sheet-mono" }, ...stepTempNodes(step)),
                  h("td", { class: "sv-sheet-num sv-sheet-mono" }, ...stepTimeNodes(step))
                )
              );
            }
          }
        }
        return h(
          "section",
          { class: "sv-sheet-sec sv-sheet-avoid", "data-sheet-sec": "program" },
          h(
            "div",
            { class: "sv-sheet-sec-head" },
            h("h2", { class: "sv-sheet-sec-title" }, "Cycling program"),
            p.edited ? h("span", { class: "sv-sheet-badge" }, "Edited") : null,
            h("span", { class: "sv-sheet-sec-meta" }, p.edited ? `Based on ${p.source} (edited locally)` : p.source)
          ),
          p.stale ? h("p", { class: "sv-sheet-note" }, h("strong", null, "Note: "), `Program edits were kept from an earlier setup (${p.context}).`) : null,
          h(
            "table",
            { class: "sv-sheet-table" },
            h("thead", null, h("tr", null, h("th", null, "Step"), h("th", { class: "sv-sheet-num" }, "Temp"), h("th", { class: "sv-sheet-num" }, "Time"))),
            h("tbody", null, ...rows)
          ),
          h("p", { class: "sv-sheet-note" }, `Baseline context: ${p.context}${p.edited ? ". Underlined values were edited from the generated protocol." : "."}`)
        );
      })()
    : h(
        "section",
        { class: "sv-sheet-sec sv-sheet-avoid", "data-sheet-sec": "program" },
        h("div", { class: "sv-sheet-sec-head" }, h("h2", { class: "sv-sheet-sec-title" }, "Cycling program")),
        h("div", { class: "sv-sheet-unavailable" }, snapshot.programUnavailableReason ?? "No cycling program available.")
      );

  const mixSection = snapshot.mix
    ? (() => {
        const m = snapshot.mix;
        const master = m.mixReactions > 1;
        return h(
          "section",
          { class: "sv-sheet-sec sv-sheet-avoid", "data-sheet-sec": "mix" },
          h(
            "div",
            { class: "sv-sheet-sec-head" },
            h("h2", { class: "sv-sheet-sec-title" }, "Reaction mix"),
            h("span", { class: "sv-sheet-sec-meta" }, m.source)
          ),
          h("p", { class: "sv-sheet-mix-params" }, mixSummaryText(m)),
          h(
            "table",
            { class: "sv-sheet-table" },
            h(
              "thead",
              null,
              h(
                "tr",
                null,
                h("th", null, "Component"),
                h("th", { class: "sv-sheet-num" }, "1× ", h("span", { class: "sv-sheet-unit" }, "(µl)")),
                master ? h("th", { class: "sv-sheet-num" }, "Mix ", h("span", { class: "sv-sheet-unit" }, `(${fmtVolume(m.mixReactions)}×, µl)`)) : null,
                h("th", null, "Final")
              )
            ),
            h(
              "tbody",
              null,
              ...m.rows.map(r =>
                h(
                  "tr",
                  { class: r.role === "template" ? "sv-sheet-mix-own" : undefined },
                  h("td", null, r.name),
                  h("td", { class: "sv-sheet-num sv-sheet-mono" }, fmtVolume(r.each)),
                  master ? h("td", { class: "sv-sheet-num sv-sheet-mono" }, r.mix === null ? "—" : fmtVolume(r.mix)) : null,
                  h("td", { class: "sv-sheet-dim" }, r.final)
                )
              ),
              // A last row rather than a tfoot, which a browser repeats on each page the table spans.
              master
                ? h(
                    "tr",
                    { class: "sv-sheet-total" },
                    h("td", null, "Master mix"),
                    h("td", { class: "sv-sheet-num sv-sheet-mono" }, fmtVolume(m.perTube)),
                    h("td", { class: "sv-sheet-num sv-sheet-mono" }, fmtVolume(m.mixTotal)),
                    h("td", null, "")
                  )
                : null
            )
          ),
          ...m.warnings.map(w => h("p", { class: "sv-sheet-note" }, h("strong", null, "Mix note: "), w)),
          h(
            "p",
            { class: "sv-sheet-note" },
            master
              ? "Master mix holds everything except template DNA; dispense mix into each tube, then add template."
              : "Add template DNA separately if splitting across tubes."
          ),
          m.scaledNote ? h("p", { class: "sv-sheet-note" }, m.scaledNote) : null
        );
      })()
    : h(
        "section",
        { class: "sv-sheet-sec sv-sheet-avoid", "data-sheet-sec": "mix" },
        h("div", { class: "sv-sheet-sec-head" }, h("h2", { class: "sv-sheet-sec-title" }, "Reaction mix")),
        h("div", { class: "sv-sheet-unavailable" }, snapshot.mixUnavailableReason ?? "No reaction mix available.")
      );

  const notesSection = h(
    "section",
    { class: "sv-sheet-sec", "data-sheet-sec": "notes" },
    h("div", { class: "sv-sheet-sec-head" }, h("h2", { class: "sv-sheet-sec-title" }, "Bench notes & observations")),
    notesSlot
  );

  const el = h(
    "article",
    { class: "sv-sheet", "data-pcr-sheet": "true" },
    h(
      "header",
      { class: "sv-sheet-head" },
      h(
        "div",
        { class: "sv-sheet-head-main" },
        h(
          "div",
          { class: "sv-sheet-kicker" },
          h("span", null, "PCR Plan · Bench Sheet"),
          h("span", { class: "sv-sheet-head-note" }, "Planning snapshot only — not a record that PCR was performed.")
        ),
        titleEl,
        h(
          "p",
          { class: "sv-sheet-sub" },
          h(
            "span",
            null,
            "Template: ",
            h("strong", null, snapshot.template.name),
            ` (${fmt(snapshot.template.length)} bp, ${snapshot.template.circular ? "circular" : "linear"} · ${snapshot.template.kindLabel})`
          ),
          h("span", { class: "sv-sheet-head-note" }, `Plan exported ${snapshot.exportedAt} · Strandivo`)
        )
      ),
      h("div", { class: "sv-sheet-date-box" }, h("span", { class: "sv-sheet-date-label" }, "Experiment date"), dateSlot)
    ),
    h(
      "section",
      { class: "sv-sheet-facts", "aria-label": "Plan summary" },
      ...facts.map(([k, v]) => h("div", { class: "sv-sheet-fact" }, h("div", { class: "sv-sheet-fact-k" }, k), h("div", { class: "sv-sheet-fact-v" }, v)))
    ),
    warningsSlot,
    primersSection,
    overviewSlot,
    protocolSlot,
    notesSection
  );

  let lastVisualMode = "";
  let lastProtocolMode = "";
  let lastWarnings = "";

  const sync = (meta: PcrPlanMeta, sections: PcrPlanSections) => {
    const title = meta.title.trim() || snapshot.suggestedTitle;
    titleEl.textContent = title;
    const expDate = meta.experimentDate.trim();
    if (expDate) {
      dateSlot.replaceChildren(h("span", { class: "sv-sheet-date-val sv-sheet-mono" }, expDate));
    } else {
      dateSlot.replaceChildren(h("span", { class: "sv-sheet-date-blank", "aria-label": "Unset" }));
    }
    const notes = meta.notes.replace(/\r\n/g, "\n");
    const hasNotes = notes.trim().length > 0;
    // Blank writing lines stay together; written notes may run onto the next page.
    notesSection.classList.toggle("sv-sheet-avoid", !hasNotes);
    if (hasNotes) {
      notesSlot.replaceChildren(h("div", { class: "sv-sheet-notes-text" }, notes));
    } else {
      notesSlot.replaceChildren(
        h(
          "div",
          { class: "sv-sheet-notes-lines", "aria-label": "Blank writing space for bench notes" },
          h("div", { class: "sv-sheet-notes-line" }),
          h("div", { class: "sv-sheet-notes-line" }),
          h("div", { class: "sv-sheet-notes-line" }),
          h("div", { class: "sv-sheet-notes-line" })
        )
      );
    }

    primersSection.hidden = !sections.primers;
    notesSection.hidden = !sections.notes;

    const warnings = planWarnings(snapshot, sections);
    if (warnings.join("\n") !== lastWarnings) {
      lastWarnings = warnings.join("\n");
      warningsSlot.replaceChildren(
        ...(warnings.length
          ? [
              h(
                "div",
                { class: "sv-sheet-warnings sv-sheet-avoid" },
                h("p", { class: "sv-sheet-warnings-title" }, "Warnings & notes"),
                h("ul", null, ...warnings.map(w => h("li", null, w)))
              )
            ]
          : [])
      );
    }

    const visualMode = `${sections.productMap ? "M" : ""}${sections.gel ? "G" : ""}`;
    if (visualMode !== lastVisualMode) {
      lastVisualMode = visualMode;
      if (visualMode === "MG") {
        overviewSlot.replaceChildren(
          h(
            "section",
            { class: "sv-sheet-sec sv-sheet-avoid", "data-sheet-sec": "map-gel" },
            h(
              "div",
              { class: "sv-sheet-sec-head" },
              h("h2", { class: "sv-sheet-sec-title" }, "Product map & simulated gel"),
              h("span", { class: "sv-sheet-sec-meta" }, `Sites: ${snapshot.product.enzymeFilterNote} · ${snapshot.digest ? `Digest: ${snapshot.digest.name}` : "Uncut product"} · Ladder: ${snapshot.gel.ladder.name}`)
            ),
            h(
              "div",
              { class: "sv-sheet-overview-grid" },
              h("div", null, buildOverviewSvgDom(snapshot.product), buildGcLegend(), ...buildGelDetails(), buildFlanksNote()),
              buildGelBox()
            )
          )
        );
      } else if (visualMode === "M") {
        overviewSlot.replaceChildren(
          h(
            "section",
            { class: "sv-sheet-sec sv-sheet-avoid", "data-sheet-sec": "map" },
            h(
              "div",
              { class: "sv-sheet-sec-head" },
              h("h2", { class: "sv-sheet-sec-title" }, "Product map"),
              h("span", { class: "sv-sheet-sec-meta" }, `Sites: ${snapshot.product.enzymeFilterNote}`)
            ),
            buildOverviewSvgDom(snapshot.product, 640),
            buildGcLegend(),
            buildFlanksNote()
          )
        );
      } else if (visualMode === "G") {
        overviewSlot.replaceChildren(
          h(
            "section",
            { class: "sv-sheet-sec sv-sheet-avoid", "data-sheet-sec": "gel" },
            h(
              "div",
              { class: "sv-sheet-sec-head" },
              h("h2", { class: "sv-sheet-sec-title" }, "Simulated gel"),
              h("span", { class: "sv-sheet-sec-meta" }, `${snapshot.digest ? `Digest: ${snapshot.digest.name}` : "Uncut product"} · Ladder: ${snapshot.gel.ladder.name}`)
            ),
            h("div", { class: "sv-sheet-gel-only-grid" }, h("div", null, ...buildGelDetails()), buildGelBox())
          )
        );
      } else {
        overviewSlot.replaceChildren();
      }
    }

    const protocolMode = `${sections.program ? "P" : ""}${sections.mix ? "X" : ""}`;
    if (protocolMode !== lastProtocolMode) {
      lastProtocolMode = protocolMode;
      if (protocolMode === "PX") {
        protocolSlot.replaceChildren(h("div", { class: "sv-sheet-two-col" }, programSection, mixSection));
      } else if (protocolMode === "P") {
        protocolSlot.replaceChildren(programSection);
      } else if (protocolMode === "X") {
        protocolSlot.replaceChildren(mixSection);
      } else {
        protocolSlot.replaceChildren();
      }
    }
  };

  sync(initialMeta, initialSections);
  return { el, sync };
}

/**
 * Opens the PCR bench-sheet preview dialog over the PCR product dialog.
 * Does not modify the construct, save settings, or close the PCR dialog. A second call
 * while one is open focuses that one.
 */
export function openPcrPrintDialog(ctx: DocContext, snapshot: PcrPlanSnapshot) {
  if (openPreview) {
    openPreview.focus();
    return;
  }
  const meta: PcrPlanMeta = {
    title: snapshot.suggestedTitle,
    experimentDate: "",
    notes: ""
  };
  const sections: PcrPlanSections = loadSavedSections();
  let paper: PlanPaper = loadSavedPaper();
  const pdfSupported = canSavePdf();

  const previewSheet = buildSheetDom(snapshot, meta, sections);
  const printSheet = buildSheetDom(snapshot, meta, sections);
  const printHost = h("div", { class: "sv-print-sheet", "aria-hidden": "true" }, printSheet.el);
  document.body.appendChild(printHost);
  document.documentElement.classList.add("sv-printing");
  document.body.classList.add("sv-printing");

  /** True while printing or saving a PDF: the mirror they print stays as it was when they began. */
  let busy = false;
  /** Which job is running, so a second Print PCR plan… can say what to wait for. */
  let job: "pdf" | "print" | null = null;
  let dialogOpen = true;
  // The mirror goes once the dialog is closed and no job is printing it.
  const release = () => {
    printHost.remove();
    if (!document.querySelector(".sv-print-sheet")) {
      document.documentElement.classList.remove("sv-printing");
      document.body.classList.remove("sv-printing");
    }
    openPreview = null;
  };

  const dlg = ctx.openDialog({
    title: "Print PCR plan",
    note: "Title, date and notes are for this printout only.",
    width: 900,
    onClose: () => {
      dialogOpen = false;
      if (!busy) release();
    }
  });

  const syncAll = () => {
    previewSheet.sync(meta, sections);
    if (!busy) printSheet.sync(meta, sections);
  };

  const titleInput = h("input", {
    type: "text",
    class: "sv-input",
    value: meta.title,
    "aria-label": "Experiment name",
    "data-focus": "plan-title"
  }) as HTMLInputElement;
  titleInput.addEventListener("input", () => {
    meta.title = titleInput.value;
    syncAll();
  });
  openPreview = {
    focus: () => (dialogOpen ? titleInput.focus() : toast(job === "print" ? "Wait for printing to finish." : "Wait for the PDF to finish saving.", "info"))
  };

  const dateInput = h("input", {
    type: "date",
    class: "sv-input",
    value: "",
    "aria-label": "Experiment date (optional)",
    "data-focus": "plan-date"
  }) as HTMLInputElement;
  dateInput.addEventListener("input", () => {
    meta.experimentDate = dateInput.value;
    syncAll();
  });
  dateInput.addEventListener("change", () => {
    meta.experimentDate = dateInput.value;
    syncAll();
  });

  const paperSelect = pdfSupported
    ? (h(
        "select",
        {
          class: "sv-input",
          "aria-label": "PDF paper size",
          "data-focus": "plan-paper",
          onchange: (e: Event) => {
            paper = (e.target as HTMLSelectElement).value as PlanPaper;
          }
        },
        h("option", { value: "a4", selected: paper === "a4" }, "A4"),
        h("option", { value: "letter", selected: paper === "letter" }, "US Letter")
      ) as HTMLSelectElement)
    : null;

  const notesInput = h("textarea", {
    class: "sv-input sv-print-notes-input",
    rows: 2,
    placeholder: "Optional bench notes, sample IDs, or adjustments…",
    "aria-label": "Bench notes",
    "data-focus": "plan-notes"
  }) as HTMLTextAreaElement;
  notesInput.addEventListener("input", () => {
    meta.notes = notesInput.value;
    syncAll();
  });

  const sectionToggle = (key: keyof PcrPlanSections, label: string, focusKey: string) => {
    const box = h("input", {
      type: "checkbox",
      checked: sections[key],
      "data-focus": focusKey
    }) as HTMLInputElement;
    box.addEventListener("change", () => {
      sections[key] = box.checked;
      syncAll();
    });
    return h("label", { class: "sv-check-row sv-print-sec-check" }, box, label);
  };

  const includeRow = h(
    "div",
    { class: "sv-print-sections", role: "group", "aria-label": "Included bench-sheet sections" },
    h("span", { class: "sv-dlg-label sv-print-sections-label" }, "Include"),
    sectionToggle("primers", "Primers", "plan-sec-primers"),
    sectionToggle("productMap", "Product map", "plan-sec-map"),
    sectionToggle("gel", "Simulated gel", "plan-sec-gel"),
    sectionToggle("program", "Cycling program", "plan-sec-program"),
    sectionToggle("mix", "Reaction mix", "plan-sec-mix"),
    sectionToggle("notes", "Bench notes", "plan-sec-notes")
  );

  const controls = h(
    "div",
    { class: "sv-print-controls" },
    h(
      "div",
      { class: paperSelect ? "sv-print-controls-row sv-print-controls-row-pdf" : "sv-print-controls-row" },
      h("label", { class: "sv-dlg-field" }, h("span", { class: "sv-dlg-label" }, "Experiment name"), titleInput),
      h("label", { class: "sv-dlg-field" }, h("span", { class: "sv-dlg-label" }, "Experiment date (optional)"), dateInput),
      paperSelect ? h("label", { class: "sv-dlg-field" }, h("span", { class: "sv-dlg-label" }, "PDF paper"), paperSelect) : null
    ),
    includeRow,
    h("label", { class: "sv-dlg-field" }, h("span", { class: "sv-dlg-label" }, "Bench notes"), notesInput)
  );

  const stage = h("div", { class: "sv-print-stage", "aria-label": "Printable PCR bench sheet preview" }, previewSheet.el);

  dlg.body.replaceChildren(controls, stage);

  const planTitle = () => meta.title.trim() || snapshot.suggestedTitle;

  /** The buttons that print the page: disabled while one of them runs. */
  const jobButtons: HTMLButtonElement[] = [];

  /** Runs a print or PDF job alone, with the mirror held still until it ends. */
  const runJob = async (kind: "pdf" | "print", work: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    job = kind;
    // A focused button that is disabled sends focus to the page in Chromium, and it stays there once the button is enabled again.
    const focused = jobButtons.find(b => b === document.activeElement);
    jobButtons.forEach(b => (b.disabled = true));
    try {
      await work();
    } finally {
      busy = false;
      job = null;
      if (!dialogOpen) {
        release();
      } else {
        jobButtons.forEach(b => (b.disabled = false));
        printSheet.sync(meta, sections);
        // Only when focus is nowhere: one the user moved meanwhile stays where it is.
        if (focused && (!document.activeElement || document.activeElement === document.body)) focused.focus();
      }
    }
  };

  /** The plan's name as the page title while it prints (the system may use it for the job or the PDF's title), put back once. */
  const withPlanTitle = async (work: () => Promise<void>) => {
    const previous = document.title;
    const shown = `${planTitle()} — PCR Plan`;
    document.title = shown;
    try {
      await work();
    } finally {
      // Something else may have named the window meanwhile; that name stays.
      if (document.title === shown) document.title = previous;
    }
  };

  /** Asks where to save; null when the user cancels, and says so when the picker itself fails. */
  const pickPath = async (file: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> => {
    try {
      return await chooseSavePath(file, filters);
    } catch (e) {
      toast(`Couldn't choose where to save: ${errorText(e)}`, "error", 6000);
      return null;
    }
  };

  const copyMarkdown = async () => {
    savePrintPrefs(sections, paper);
    await copyText(pcrPlanMarkdown(snapshot, meta, sections), "the PCR plan as Markdown");
  };

  const saveHtml = async () => {
    const path = await pickPath(planFileName(planTitle()), [{ name: "HTML", extensions: ["html", "htm"] }]);
    if (!path) return;
    savePrintPrefs(sections, paper);
    try {
      await saveText(path, pcrPlanHtml(snapshot, meta, sections));
      toast("Saved the PCR plan.", "success");
    } catch (e) {
      toast(`Couldn't save the plan: ${errorText(e)}`, "error", 6000);
    }
  };

  const savePdf = () =>
    runJob("pdf", async () => {
      const path = await pickPath(planPdfFileName(planTitle()), [{ name: "PDF", extensions: ["pdf"] }]);
      if (!path) return;
      savePrintPrefs(sections, paper);
      try {
        await withPlanTitle(() => saveWindowPdf(path, paper));
        toast("Saved the PCR plan as a PDF.", "success");
      } catch (e) {
        toast(`Couldn't save the PDF: ${errorText(e)} Try Print… or Save HTML… instead.`, "error", 7000);
      }
    });

  const runPrint = () =>
    runJob("print", async () => {
      savePrintPrefs(sections, paper);
      try {
        await withPlanTitle(printWindow);
      } catch (e) {
        toast(`Couldn't open the print dialog: ${errorText(e)} Save HTML… makes a file to print from a browser.`, "error", 7000);
      }
    });

  const pdfButton = pdfSupported
    ? (h("button", { type: "button", class: "sv-btn", "data-focus": "plan-save-pdf", onclick: () => void savePdf() }, "Save as PDF…") as HTMLButtonElement)
    : null;
  const printButton = h(
    "button",
    { type: "button", class: "sv-btn sv-btn-primary", "data-focus": "plan-print", onclick: () => void runPrint() },
    iconSvg("print", 14),
    pdfSupported ? "Print…" : "Print / Save as PDF…"
  ) as HTMLButtonElement;
  jobButtons.push(printButton, ...(pdfButton ? [pdfButton] : []));

  dlg.footer.replaceChildren(
    h("button", { type: "button", class: "sv-btn sv-foot-start", "data-focus": "plan-cancel", onclick: () => dlg.close() }, "Cancel"),
    h("button", { type: "button", class: "sv-btn", "data-focus": "plan-copy-md", onclick: () => void copyMarkdown() }, iconSvg("copy", 14), "Copy Markdown"),
    h("button", { type: "button", class: "sv-btn", "data-focus": "plan-save-html", onclick: () => void saveHtml() }, "Save HTML…"),
    ...(pdfButton ? [pdfButton] : []),
    printButton
  );
}
