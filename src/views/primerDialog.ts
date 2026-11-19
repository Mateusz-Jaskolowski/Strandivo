// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Unified Primer Dialog: creates a new primer (from a selection or typed/pasted sequence)
// or edits an existing one, with live double-stranded context preview, draggable ends,
// restriction-site/codon/tag insertion, binding site switcher (primary + partial 3′
// off-target sites), and live quality checks.

import { h, toast } from "../ui/dom.ts";
import { fmt, fmtRange } from "../ui/format.ts";
import { iconSvg, primerIcon } from "../ui/icons.ts";
import { track } from "../usage.ts";
import type { DocContext } from "../doc/context.ts";
import { featureStyles, primerColors, primerTitle } from "../doc/analysis.ts";
import { primerLibrary } from "../primerLibrary.ts";
import { PRIMER_COLOURS } from "../lib/contextMenu.ts";
import { noteText, withNote } from "../lib/featureNotes.ts";
import { libraryMatch } from "../lib/library.ts";
import { alignPrimer, primerPiece } from "../lib/primerAlign.ts";
import { resizePrimer } from "../lib/primerEdit.ts";
import { CODON_GROUPS, DEFAULT_CLAMP, enzymeSnippet, INSERT_ENZYMES, insertIntoPrimer, SHORT_TAGS } from "../lib/primerInsert.ts";
import { changesText, findBindingSites, placeEdited, primerReport, tmLabel, type BindingSite, type PartialBindingSite, type PrimerCheck, type PrimerSite } from "../lib/primers.ts";
import { basesIn, complement, inRange, newId, rangeLength, reverseComplement, type Range, type SeqFeature, type SeqPrimer } from "../lib/seqdata.ts";
import { boxTop, drawPrimer, laneHeight } from "./primerDraw.ts";
import { uniqueName, where } from "./primerDialogs.ts";

export type PrimerDialogMode =
  | { mode: "create"; strand?: 1 | -1; range?: Range | null }
  | { mode: "edit"; primerId: string };

interface DraftSnapshot {
  bases: string;
  savedSite: PrimerSite | null;
}

type SiteEntry =
  | { kind: "saved"; key: string; site: PrimerSite; label: string; length: number; tm: number | null }
  | { kind: "primary"; key: string; site: BindingSite; label: string; length: number; tm: number | null }
  | { kind: "partial"; key: string; site: PartialBindingSite; label: string; length: number; tm: number };

const siteKey = (s: PrimerSite) => `${s.strand}:${s.start}:${s.end}`;
const threePrimeKey = (s: PrimerSite) => `${s.strand}:${s.strand === 1 ? s.end : s.start}`;
const MAX_SELECTION_PREFILL = 120;
const MIN_RELIABLE_LEN = 15;
const GUTTER = 54;

/** Opens the unified Primer Dialog in create or edit mode. */
export function openPrimerDialog(ctx: DocContext, opts: PrimerDialogMode) {
  const d0 = ctx.store.data;
  const editing = opts.mode === "edit" ? d0.primers.find(p => p.id === opts.primerId) ?? null : null;
  if (opts.mode === "edit" && !editing) return;

  // Initial state: separate `savedSite` (what will be saved) from `previewKey` (what the
  // sequence strip is currently inspecting).
  let name = "";
  let note = "";
  let color: string | undefined = undefined;
  let bases = "";
  let savedSite: PrimerSite | null = null;
  let selectionBacked = false;

  if (opts.mode === "edit") {
    const p = editing!;
    name = p.name;
    note = noteText(p.notes);
    color = p.color;
    bases = p.bases.toUpperCase();
    savedSite = { start: p.start, end: p.end, strand: p.strand };
  } else {
    const strand: 1 | -1 = opts.strand ?? 1;
    name = uniqueName(`Primer ${d0.primers.length + 1}`, d0.primers.map(p => p.name));
    const r = opts.range ?? null;
    const len = r ? rangeLength(r, d0.sequence.length) : 0;
    if (r && len > 0 && len <= MAX_SELECTION_PREFILL) {
      const top = basesIn(d0.sequence, r).toUpperCase();
      bases = strand === 1 ? top : reverseComplement(top);
      savedSite = { start: r.start, end: r.end, strand };
      selectionBacked = true;
    }
  }

  let previewKey: string | null = null; // null = follow savedSite (or first primary site)
  let insertOpen = false;
  let colorPopOpen = false;
  let saveToLib = false;
  let lastCaretStart = 0;
  let lastCaretEnd = 0;
  let chPx = 7.8;

  // Local undo/redo stack for sequence & end-drag edits inside the dialog.
  const history: DraftSnapshot[] = [{ bases, savedSite: savedSite ? { ...savedSite } : null }];
  let histIdx = 0;
  const pushHistory = () => {
    const prev = history[histIdx];
    const sameSite =
      (!prev.savedSite && !savedSite) ||
      (!!prev.savedSite && !!savedSite && prev.savedSite.start === savedSite.start && prev.savedSite.end === savedSite.end && prev.savedSite.strand === savedSite.strand);
    if (prev.bases === bases && sameSite) return;
    history.splice(histIdx + 1);
    history.push({ bases, savedSite: savedSite ? { ...savedSite } : null });
    if (history.length > 60) history.shift();
    histIdx = history.length - 1;
  };
  const stepHistory = (dir: -1 | 1) => {
    const next = histIdx + dir;
    if (next < 0 || next >= history.length) return;
    histIdx = next;
    bases = history[histIdx].bases;
    savedSite = history[histIdx].savedSite ? { ...history[histIdx].savedSite! } : null;
    seqInput.value = bases;
    render();
  };

  // Insert drawer local choices.
  let enzymeName = INSERT_ENZYMES.find(e => e.name === "EcoRI")?.name ?? INSERT_ENZYMES[0]?.name ?? "";
  let enzymeClamp = true;
  let enzymeRev = false;
  let codonAa = CODON_GROUPS[0]?.aa ?? "A";
  let codonSeq = CODON_GROUPS[0]?.codons[0] ?? "GCG";
  let codonRev = false;
  let tagId = SHORT_TAGS[0]?.id ?? "6xhis";
  let tagRev = false;

  const cleanBases = (raw: string) => raw.replace(/[^A-Za-z]/g, "").toUpperCase();

  let resizeObs: ResizeObserver | null = null;
  const onDocPointerDown = (e: PointerEvent) => {
    if (colorPopOpen && !(e.target as Element).closest(".sv-pdlg-color-wrap")) {
      colorPopOpen = false;
      renderColorMenu();
    }
  };
  document.addEventListener("pointerdown", onDocPointerDown);

  const dlg = ctx.openDialog({
    title: editing ? "Edit Primer" : "Add Primer",
    note: editing ? `Editing ${editing.name} on ${d0.name || "this sequence"}.` : `Design or inspect a primer on ${d0.name || "this sequence"}.`,
    width: 780,
    onClose: () => {
      resizeObs?.disconnect();
      document.removeEventListener("pointerdown", onDocPointerDown);
    },
    onEscape: () => {
      if (colorPopOpen) {
        colorPopOpen = false;
        renderColorMenu();
        return true;
      }
      return false;
    }
  });

  // ---------- persistent input elements (never replaced, so focus & caret stay rock-solid) ----------

  const colorBtn = h("button", {
    type: "button",
    class: "sv-pdlg-color-btn",
    "aria-label": "Primer colour",
    title: "Primer colour",
    onclick: () => {
      colorPopOpen = !colorPopOpen;
      renderColorMenu();
    }
  }) as HTMLButtonElement;
  const colorPop = h("div", { class: "sv-color-popover", role: "menu", hidden: true });
  const colorWrap = h("div", { class: "sv-pdlg-color-wrap" }, colorBtn, colorPop);

  const nameInput = h("input", {
    class: "sv-input sv-pdlg-name",
    value: name,
    placeholder: "Primer name",
    "aria-label": "Primer name",
    spellcheck: "false"
  }) as HTMLInputElement;
  nameInput.addEventListener("input", () => {
    name = nameInput.value;
    renderLibraryRow();
    renderPreview();
  });
  nameInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  const noteInput = h("input", {
    class: "sv-input sv-pdlg-note",
    value: note,
    placeholder: "Note or description (optional)",
    "aria-label": "Primer note"
  }) as HTMLInputElement;
  noteInput.addEventListener("input", () => {
    note = noteInput.value;
  });
  noteInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  const seqInput = h("input", {
    class: "sv-input sv-mono sv-pdlg-seq-input",
    value: bases,
    placeholder: "Paste or type sequence 5′ → 3′",
    "aria-label": "Primer sequence 5′ to 3′",
    spellcheck: "false",
    autocomplete: "off"
  }) as HTMLInputElement;

  const rememberCaret = () => {
    lastCaretStart = seqInput.selectionStart ?? 0;
    lastCaretEnd = seqInput.selectionEnd ?? lastCaretStart;
  };
  seqInput.addEventListener("keyup", rememberCaret);
  seqInput.addEventListener("mouseup", rememberCaret);
  seqInput.addEventListener("select", rememberCaret);

  const applyBasesChange = (nextRaw: string, nextCaret?: number) => {
    const next = cleanBases(nextRaw);
    bases = next;
    if (seqInput.value !== next) seqInput.value = next;
    if (nextCaret !== undefined) {
      const pos = Math.max(0, Math.min(next.length, nextCaret));
      seqInput.setSelectionRange(pos, pos);
      lastCaretStart = pos;
      lastCaretEnd = pos;
    } else rememberCaret();

    const d = ctx.store.data;
    if (!next) {
      savedSite = null;
    } else if (savedSite) {
      const placed = placeEdited(savedSite, next, d.sequence, d.circular);
      if (placed) {
        savedSite = { start: placed.start, end: placed.end, strand: placed.strand };
      } else if (!editing && !selectionBacked) {
        // In empty/pasted create mode, keep following any binding site that appears.
        const sites = findBindingSites(next, d.sequence, d.circular);
        const still = sites.find(s => s.strand === savedSite!.strand && threePrimeKey(s) === threePrimeKey(savedSite!));
        savedSite = still ? { start: still.start, end: still.end, strand: still.strand } : sites[0] ? { start: sites[0].start, end: sites[0].end, strand: sites[0].strand } : null;
      }
    } else {
      const sites = findBindingSites(next, d.sequence, d.circular);
      if (sites.length) savedSite = { start: sites[0].start, end: sites[0].end, strand: sites[0].strand };
    }
    pushHistory();
    render();
  };

  seqInput.addEventListener("input", () => {
    const pos = seqInput.selectionStart ?? seqInput.value.length;
    const beforeClean = cleanBases(seqInput.value.slice(0, pos)).length;
    applyBasesChange(seqInput.value, beforeClean);
  });

  seqInput.addEventListener("keydown", e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      stepHistory(e.shiftKey ? 1 : -1);
    } else if (mod && !e.altKey && e.key.toLowerCase() === "y") {
      e.preventDefault();
      e.stopPropagation();
      stepHistory(1);
    } else if (mod && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });

  const strandBar = h("div", { class: "sv-pdlg-strand-slot" });
  const insertToggle = h("button", {
    type: "button",
    class: "sv-btn sv-pdlg-insert-btn",
    "aria-expanded": "false",
    onclick: () => {
      insertOpen = !insertOpen;
      insertToggle.setAttribute("aria-expanded", String(insertOpen));
      insertToggle.classList.toggle("sv-on", insertOpen);
      insertDrawer.hidden = !insertOpen;
    }
  }, "Insert ▾") as HTMLButtonElement;

  const undoBtn = h("button", { type: "button", class: "sv-btn sv-pdlg-hist-btn", title: "Undo sequence edit", onclick: () => stepHistory(-1) }, "Undo") as HTMLButtonElement;
  const redoBtn = h("button", { type: "button", class: "sv-btn sv-pdlg-hist-btn", title: "Redo sequence edit", onclick: () => stepHistory(1) }, "Redo") as HTMLButtonElement;

  // ---------- Insert drawer ----------
  const insertDrawer = h("div", { class: "sv-pdlg-drawer", hidden: true });
  const buildInsertDrawer = () => {
    const insertText = (snippet: string, rev = false) => {
      const start = document.activeElement === seqInput ? (seqInput.selectionStart ?? lastCaretStart) : lastCaretStart;
      const end = document.activeElement === seqInput ? (seqInput.selectionEnd ?? lastCaretEnd) : lastCaretEnd;
      const res = insertIntoPrimer(bases, start, end, snippet, rev);
      seqInput.focus();
      applyBasesChange(res.bases, res.caret);
    };

    // 1. Enzyme site panel
    const enzSelect = h("select", { class: "sv-select", "aria-label": "Restriction enzyme" },
      INSERT_ENZYMES.map(e => h("option", { value: e.name, selected: e.name === enzymeName }, `${e.name} (${e.site})`))
    ) as HTMLSelectElement;
    const enzPreview = h("span", { class: "sv-mono sv-small sv-dim" });
    const clampBox = h("input", { type: "checkbox", checked: enzymeClamp }) as HTMLInputElement;
    const enzRevBox = h("input", { type: "checkbox", checked: enzymeRev }) as HTMLInputElement;
    const updateEnzPreview = () => {
      const cur = INSERT_ENZYMES.find(e => e.name === enzymeName);
      enzPreview.textContent = cur ? enzymeSnippet(cur.site, { clamp: enzymeClamp, clampBases: DEFAULT_CLAMP, revComp: enzymeRev }) : "";
    };
    enzSelect.addEventListener("change", () => {
      enzymeName = enzSelect.value;
      updateEnzPreview();
    });
    clampBox.addEventListener("change", () => {
      enzymeClamp = clampBox.checked;
      updateEnzPreview();
    });
    enzRevBox.addEventListener("change", () => {
      enzymeRev = enzRevBox.checked;
      updateEnzPreview();
    });
    updateEnzPreview();

    const enzCard = h(
      "div",
      { class: "sv-pdlg-drawer-card" },
      h("div", { class: "sv-pdlg-drawer-title" }, "Restriction site"),
      enzSelect,
      enzPreview,
      h("label", { class: "sv-check-row sv-small" }, clampBox, "Add 6 bp 5′ clamp"),
      h("div", { class: "sv-pdlg-drawer-foot" },
        h("label", { class: "sv-check-row sv-small" }, enzRevBox, "RevComp"),
        h("button", {
          type: "button",
          class: "sv-btn",
          onclick: () => {
            const cur = INSERT_ENZYMES.find(e => e.name === enzymeName);
            if (cur) insertText(enzymeSnippet(cur.site, { clamp: enzymeClamp, clampBases: DEFAULT_CLAMP, revComp: enzymeRev }), false);
          }
        }, "Insert")
      )
    );

    // 2. Codon panel
    const aaSelect = h("select", { class: "sv-select", "aria-label": "Amino acid" },
      CODON_GROUPS.map(g => h("option", { value: g.aa, selected: g.aa === codonAa }, g.aa === "*" ? "Stop (*)" : `${g.label} (${g.aa})`))
    ) as HTMLSelectElement;
    const codonSelect = h("select", { class: "sv-select sv-mono", "aria-label": "Codon" }) as HTMLSelectElement;
    const codonRevBox = h("input", { type: "checkbox", checked: codonRev }) as HTMLInputElement;
    const refillCodons = () => {
      const grp = CODON_GROUPS.find(g => g.aa === codonAa) ?? CODON_GROUPS[0];
      if (!grp.codons.includes(codonSeq)) codonSeq = grp.codons[0];
      codonSelect.replaceChildren(...grp.codons.map(c => h("option", { value: c, selected: c === codonSeq }, c)));
    };
    aaSelect.addEventListener("change", () => {
      codonAa = aaSelect.value;
      refillCodons();
    });
    codonSelect.addEventListener("change", () => {
      codonSeq = codonSelect.value;
    });
    codonRevBox.addEventListener("change", () => {
      codonRev = codonRevBox.checked;
    });
    refillCodons();

    const codonCard = h(
      "div",
      { class: "sv-pdlg-drawer-card" },
      h("div", { class: "sv-pdlg-drawer-title" }, "Codon"),
      h("div", { class: "sv-pdlg-drawer-pair" }, aaSelect, codonSelect),
      h("div", { class: "sv-small sv-dim" }, "Common E. coli codon listed first."),
      h("div", { class: "sv-pdlg-drawer-foot" },
        h("label", { class: "sv-check-row sv-small" }, codonRevBox, "RevComp"),
        h("button", { type: "button", class: "sv-btn", onclick: () => insertText(codonSeq, codonRev) }, "Insert")
      )
    );

    // 3. Short tag panel
    const tagSelect = h("select", { class: "sv-select", "aria-label": "Short tag or motif" },
      SHORT_TAGS.map(t => h("option", { value: t.id, selected: t.id === tagId }, `${t.name} (${t.bases.length} nt)`))
    ) as HTMLSelectElement;
    const tagPreview = h("div", { class: "sv-small sv-dim sv-pdlg-tag-note" });
    const tagRevBox = h("input", { type: "checkbox", checked: tagRev }) as HTMLInputElement;
    const updateTagPreview = () => {
      const cur = SHORT_TAGS.find(t => t.id === tagId) ?? SHORT_TAGS[0];
      tagPreview.textContent = cur ? `${cur.note} · ${cur.bases.slice(0, 18)}${cur.bases.length > 18 ? "…" : ""}` : "";
    };
    tagSelect.addEventListener("change", () => {
      tagId = tagSelect.value;
      updateTagPreview();
    });
    tagRevBox.addEventListener("change", () => {
      tagRev = tagRevBox.checked;
    });
    updateTagPreview();

    const tagCard = h(
      "div",
      { class: "sv-pdlg-drawer-card" },
      h("div", { class: "sv-pdlg-drawer-title" }, "Short tag / motif"),
      tagSelect,
      tagPreview,
      h("div", { class: "sv-pdlg-drawer-foot" },
        h("label", { class: "sv-check-row sv-small" }, tagRevBox, "RevComp"),
        h("button", {
          type: "button",
          class: "sv-btn",
          onclick: () => {
            const cur = SHORT_TAGS.find(t => t.id === tagId);
            if (cur) insertText(cur.bases, tagRev);
          }
        }, "Insert")
      )
    );

    insertDrawer.replaceChildren(enzCard, codonCard, tagCard);
  };
  buildInsertDrawer();

  // ---------- dynamic readout, preview, checks, and footer ----------
  const statsBar = h("div", { class: "sv-pdlg-stats" });
  const siteControls = h("div", { class: "sv-pdlg-sites" });
  const previewBanner = h("div", { class: "sv-pdlg-preview-banner", hidden: true });
  const previewBox = h("div", { class: "sv-pdlg-preview" });
  const previewFooter = h("div", { class: "sv-pdlg-preview-foot" });
  const checksBox = h("div", { class: "sv-pdlg-checks" });

  const libCheckbox = h("input", { type: "checkbox" }) as HTMLInputElement;
  libCheckbox.addEventListener("change", () => {
    saveToLib = libCheckbox.checked;
  });
  const libLabelText = h("span", null, "Also save to lab library");
  const libHint = h("span", { class: "sv-small sv-dim" });
  const libRow = h("label", { class: "sv-check-row sv-pdlg-lib-row" }, libCheckbox, libLabelText, libHint);

  const submitBtn = h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => submit() }, editing ? "Save changes" : "Add primer") as HTMLButtonElement;

  const renderColorMenu = () => {
    const tint = color || "var(--accent)";
    colorBtn.style.setProperty("--pdlg-color", tint);
    colorBtn.replaceChildren(primerIcon(savedSite?.strand ?? 1, color));
    colorPop.hidden = !colorPopOpen;
    if (!colorPopOpen) return;
    const opt = (label: string, hex: string | undefined) =>
      h(
        "button",
        {
          type: "button",
          class: `sv-swatch${!hex ? " sv-swatch-default" : ""}`,
          style: hex ? { background: hex } : {},
          title: label,
          "aria-label": label,
          "aria-pressed": String((color ?? "").toUpperCase() === (hex ?? "").toUpperCase()),
          onclick: () => {
            color = hex;
            colorPopOpen = false;
            renderColorMenu();
            renderPreview();
          }
        }
      );
    colorPop.replaceChildren(opt("Default colour", undefined), ...PRIMER_COLOURS.map(c => opt(c.name, c.hex)));
  };

  const computeState = () => {
    const d = ctx.store.data;
    const b = cleanBases(bases);
    const al = b && savedSite ? alignPrimer({ ...savedSite, bases: b }, d.sequence) : null;
    const report = b ? primerReport(b, al ?? b.length, d.sequence, d.circular, null, savedSite) : null;

    // Build unified switcher list: primary sites + stored savedSite if absent + partial off-targets.
    const entries: SiteEntry[] = [];
    if (report) {
      const seenPrimary = new Set<string>();
      for (const s of report.siteList) {
        const key = `p:${siteKey(s)}`;
        seenPrimary.add(threePrimeKey(s));
        const tmStr = s.tm === null ? "—" : `${s.tm.toFixed(1)} °C`;
        entries.push({ kind: "primary", key, site: s, label: `${where(s)} · ${s.length} bp · ${tmStr}`, length: s.length, tm: s.tm });
      }
      if (savedSite && !seenPrimary.has(threePrimeKey(savedSite))) {
        const tmStr = report.tm === null ? "—" : `${report.tm.toFixed(1)} °C`;
        entries.unshift({
          kind: "saved",
          key: `s:${siteKey(savedSite)}`,
          site: savedSite,
          label: `Current site · ${where(savedSite)} · ${al?.binding.length ?? b.length} bp · ${tmStr}`,
          length: al?.binding.length ?? b.length,
          tm: report.tm
        });
      }
      for (const ps of report.partialSites) {
        entries.push({
          kind: "partial",
          key: `x:${siteKey(ps)}`,
          site: ps,
          label: `Partial · ${where(ps)} · ${ps.length} bp · ${ps.tm.toFixed(1)} °C`,
          length: ps.length,
          tm: ps.tm
        });
      }
    }

    // Resolve active preview entry without mutating `savedSite`.
    let activeEntry: SiteEntry | null = null;
    if (previewKey) activeEntry = entries.find(e => e.key === previewKey) ?? null;
    if (!activeEntry) {
      previewKey = null;
      if (savedSite) {
        activeEntry =
          entries.find(e => e.kind !== "partial" && e.site.strand === savedSite!.strand && e.site.start === savedSite!.start && e.site.end === savedSite!.end) ??
          entries.find(e => e.kind !== "partial" && threePrimeKey(e.site) === threePrimeKey(savedSite!)) ??
          entries[0] ??
          null;
      } else {
        activeEntry = entries[0] ?? null;
      }
    }
    return { d, b, al, report, entries, activeEntry };
  };

  const renderLibraryRow = () => {
    const b = cleanBases(bases);
    const effName = name.trim() || `Primer ${ctx.store.data.primers.length + 1}`;
    if (!b) {
      libCheckbox.disabled = true;
      libCheckbox.checked = false;
      libLabelText.textContent = "Also save to lab library";
      libHint.textContent = "";
      return;
    }
    const match = libraryMatch(primerLibrary.all, effName, b);
    if (match.exact) {
      libCheckbox.disabled = true;
      libCheckbox.checked = true;
      libLabelText.textContent = "Already in lab library";
      libHint.textContent = "";
    } else {
      libCheckbox.disabled = false;
      libCheckbox.checked = saveToLib;
      libLabelText.textContent = "Also save to lab library";
      libHint.textContent = match.sameBases ? ` (sequence also in library as “${match.sameBases.name}”)` : "";
    }
  };

  const resizeDraft = (d5: number, d3: number) => {
    if (!savedSite) return;
    const d = ctx.store.data;
    const draft: SeqPrimer = { id: "__draft__", name: name.trim() || "Primer", ...savedSite, bases: cleanBases(bases), color, notes: {}, raw: {} };
    const next = resizePrimer(draft, d.sequence, d.circular, d5, d3);
    if (!next) return;
    bases = next.bases;
    savedSite = { start: next.start, end: next.end, strand: next.strand };
    seqInput.value = bases;
    previewKey = null;
    pushHistory();
    render();
  };

  const startHandleDrag = (e: PointerEvent, side: "left" | "right", trackEl: HTMLElement) => {
    if (e.button !== 0 || !savedSite) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const fromSite = { ...savedSite };
    const fromBases = cleanBases(bases);
    let lastDelta = 0;
    const move = (ev: PointerEvent) => {
      const steps = Math.round((ev.clientX - startX) / chPx);
      if (steps === lastDelta) return;
      const d = ctx.store.data;
      const fwd = fromSite.strand === 1;
      const grow = side === "left" ? -steps : steps;
      const is3 = (side === "right") === fwd;
      const draft: SeqPrimer = { id: "__draft__", name: name.trim() || "Primer", ...fromSite, bases: fromBases, color, notes: {}, raw: {} };
      const next = resizePrimer(draft, d.sequence, d.circular, is3 ? 0 : grow, is3 ? grow : 0);
      if (!next) return;
      lastDelta = steps;
      bases = next.bases;
      savedSite = { start: next.start, end: next.end, strand: next.strand };
      seqInput.value = bases;
      previewKey = null;
      render();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      trackEl.classList.remove("sv-dragging");
      if (lastDelta !== 0) pushHistory();
    };
    trackEl.classList.add("sv-dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const renderPreview = () => {
    const { d, b, al, entries, activeEntry } = computeState();
    const n = d.sequence.length;
    if (!b || !activeEntry || !n) {
      previewBanner.hidden = true;
      previewBox.replaceChildren(
        h(
          "div",
          { class: "sv-pdlg-preview-empty sv-dim" },
          !b
            ? "Paste or type a primer sequence above to preview where it binds on this sequence."
            : "This sequence doesn't bind the template yet (at least 15 matching bases at the 3′ end are needed to locate a site)."
        )
      );
      previewFooter.replaceChildren();
      return;
    }

    const site = activeEntry.site;
    const isSaved =
      activeEntry.kind !== "partial" &&
      !!savedSite &&
      site.strand === savedSite.strand &&
      site.start === savedSite.start &&
      site.end === savedSite.end;

    // Banner when inspecting a partial off-target site or another primary site.
    if (activeEntry.kind === "partial") {
      previewBanner.hidden = false;
      previewBanner.className = "sv-pdlg-preview-banner sv-pdlg-banner-warn";
      previewBanner.replaceChildren(
        iconSvg("warn", 14),
        h("span", null, `Inspecting partial 3′ off-target match (${activeEntry.length} bp, Tm ${activeEntry.tm.toFixed(1)} °C). Your saved binding site is unchanged.`),
        savedSite
          ? h("button", { type: "button", class: "sv-link", onclick: () => { previewKey = null; render(); } }, "Back to saved site")
          : ""
      );
    } else if (!isSaved && activeEntry.kind === "primary") {
      previewBanner.hidden = false;
      previewBanner.className = "sv-pdlg-preview-banner sv-pdlg-banner-info";
      previewBanner.replaceChildren(
        h("span", null, `Previewing alternative binding site ${where(site)}.`),
        h("button", {
          type: "button",
          class: "sv-btn",
          onclick: () => {
            savedSite = { start: site.start, end: site.end, strand: site.strand };
            previewKey = null;
            pushHistory();
            render();
          }
        }, "Use this site")
      );
    } else {
      previewBanner.hidden = true;
    }

    // Measure monospace width once preview box is laid out.
    const probe = h("span", { class: "sv-bases", style: { position: "absolute", visibility: "hidden" } }, "ACGTACGTAC");
    previewBox.appendChild(probe);
    const measured = probe.getBoundingClientRect().width / 10;
    probe.remove();
    if (measured > 4 && measured < 20) chPx = measured;

    const draftPrimer: SeqPrimer = {
      id: "__draft__",
      name: name.trim() || "Primer",
      start: site.start,
      end: site.end,
      strand: site.strand,
      bases: b,
      color: activeEntry.kind === "partial" ? "#D97706" : color,
      notes: {},
      raw: {}
    };
    const draftAl = isSaved && al ? al : alignPrimer(draftPrimer, d.sequence);
    const bindLen = rangeLength(site, n);
    const tailLen = draftAl.tail.length;
    const availW = Math.max(460, previewBox.clientWidth - GUTTER - 28);
    const bpr = Math.max(40, Math.min(n, Math.floor(availW / chPx)));
    const total = Math.min(n, Math.max(bpr, Math.min(bpr * 2, bindLen + tailLen + 28)));
    const rowsNeeded = total > bpr ? 2 : 1;
    const spanTotal = Math.min(n, bpr * rowsNeeded);

    const lo = site.strand === 1 ? site.start - tailLen : site.start;
    let winStart = lo + Math.floor((bindLen + tailLen) / 2) - Math.floor(spanTotal / 2);
    if (d.circular) winStart = ((winStart % n) + n) % n;
    else winStart = Math.max(0, Math.min(Math.max(0, n - spanTotal), winStart));

    const positions = Array.from({ length: spanTotal }, (_, i) => (d.circular ? (winStart + i) % n : winStart + i));
    const idxOf = (pos: number) => (d.circular ? (((pos - winStart) % n) + n) % n : pos - winStart);
    const styles = featureStyles(d);
    const caseOf = (s: string) => s.toUpperCase();
    const ch = (k: number) => `${Math.round(k * chPx * 100) / 100}px`;
    const abs = (style: string, cls: string, text?: string) => {
      const el = document.createElement("div");
      el.className = cls;
      el.setAttribute("style", `position:absolute;${style}`);
      if (text !== undefined) el.textContent = text;
      return el;
    };

    const rowEls: HTMLElement[] = [];
    for (let r = 0; r * bpr < spanTotal; r++) {
      const rowPos = positions.slice(r * bpr, Math.min(spanTotal, (r + 1) * bpr));
      const len = rowPos.length;
      const offset = r * bpr;
      const colOf = (pos: number) => {
        const i = idxOf(pos) - offset;
        return i >= 0 && i < len ? i : -1;
      };
      const piece = primerPiece(draftAl, draftPrimer, n, d.circular, colOf);
      const hasFwd = draftPrimer.strand === 1 && !!piece;
      const hasRev = draftPrimer.strand === -1 && !!piece;
      const fwdBand = hasFwd && piece!.raised;
      const revBand = hasRev && piece!.raised;
      const fwdH = hasFwd ? laneHeight(fwdBand) : 0;
      const revH = hasRev ? laneHeight(revBand) : 0;

      // Nearby features in this row (up to 2 lanes to keep dialog compact).
      const featRuns: { f: SeqFeature; a: number; b: number; lane: number }[] = [];
      const laneEnds: number[] = [];
      for (const f of d.features) {
        let a = -1;
        let bEnd = -1;
        for (let i = 0; i < len; i++) {
          if (inRange(f, rowPos[i])) {
            if (a < 0) a = i;
            bEnd = i;
          }
        }
        if (a < 0) continue;
        let lane = 0;
        while (laneEnds[lane] !== undefined && laneEnds[lane] >= a) lane++;
        if (lane >= 2) continue;
        laneEnds[lane] = bEnd + 1;
        featRuns.push({ f, a, b: bEnd, lane });
      }
      const featLanes = featRuns.length ? Math.max(...featRuns.map(x => x.lane)) + 1 : 0;

      let y = 6;
      const yRuler = y;
      y += 14;
      const yFwd = y;
      y += fwdH;
      const yTop = y;
      y += 18;
      const yBot = y;
      y += 18;
      const yRev = y + 2;
      y += revH + (revH ? 2 : 0);
      const yFeats = y + (featLanes ? 4 : 0);
      y += featLanes * 22 + 8;

      const gutter = h("div", { class: "sv-pdlg-gutter", style: { width: `${GUTTER}px`, height: `${y}px` } });
      gutter.appendChild(abs(`right:6px;top:${yTop}px;line-height:18px`, "sv-row-number", fmt(rowPos[0] + 1)));
      const track = h("div", { class: "sv-ctx-track", style: { width: ch(len), height: `${y}px` } });

      // Highlight site on both strands.
      const ls = idxOf(site.start) - offset;
      const le = ls + bindLen - 1;
      const shows = ls < len && le >= 0;
      if (shows) {
        const a0 = Math.max(0, ls);
        const b0 = Math.min(len - 1, le);
        track.appendChild(abs(`left:${ch(a0)};width:${ch(b0 - a0 + 1)};top:${yTop - 1}px;height:38px`, activeEntry.kind === "partial" ? "sv-ctx-site sv-pdlg-site-partial" : "sv-ctx-site"));
      }

      const topBases = rowPos.map(pos => d.sequence[pos]).join("");
      track.appendChild(abs(`left:0;top:${yTop}px`, "sv-bases", caseOf(topBases)));
      track.appendChild(abs(`left:0;top:${yBot}px`, "sv-bases sv-bases-bottom", caseOf(complement(topBases))));

      rowPos.forEach((pos, i) => {
        if ((pos + 1) % 10 === 0) {
          track.appendChild(abs(`left:${ch(i + 1)};top:${yRuler}px;transform:translateX(-100%)`, "sv-ruler", fmt(pos + 1)));
        }
      });

      const x = (c: number) => Math.round(c * chPx * 100) / 100;
      if (piece) {
        const py = draftPrimer.strand === 1 ? yFwd : yRev;
        const pBand = draftPrimer.strand === 1 ? fwdBand : revBand;
        const strandY = draftPrimer.strand === 1 ? yTop + 9 : yBot + 9;
        track.appendChild(
          drawPrimer({
            piece,
            id: draftPrimer.id,
            name: draftPrimer.name,
            title: primerTitle(d, draftPrimer),
            strand: draftPrimer.strand,
            ...primerColors(draftPrimer),
            selected: true,
            x,
            cw: chPx,
            cols: len,
            y: py,
            band: pBand,
            caseOf,
            strandY,
            className: "sv-ctx-primer"
          })
        );

        // Draggable handles at 5′ and 3′ binding ends when editing the saved site.
        if (isSaved && shows) {
          const yy = boxTop(py, pBand, draftPrimer.strand === 1);
          const mkHandle = (side: "left" | "right", atCol: number) => {
            const is3 = (side === "right") === (draftPrimer.strand === 1);
            const btn = h("button", {
              type: "button",
              class: "sv-ctx-handle",
              "aria-label": is3 ? "Drag or use arrows to move 3′ end" : "Drag or use arrows to move 5′ binding end",
              title: is3 ? "Drag to extend or trim 3′ end" : "Drag to extend or trim 5′ binding end",
              style: { left: `calc(${ch(atCol)} - 6px)`, top: `${yy - 4}px` }
            }) as HTMLButtonElement;
            btn.addEventListener("pointerdown", ev => startHandleDrag(ev, side, track));
            btn.addEventListener("keydown", ev => {
              if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
              ev.preventDefault();
              const grow = (side === "left") === (ev.key === "ArrowLeft") ? 1 : -1;
              resizeDraft(is3 ? 0 : grow, is3 ? grow : 0);
            });
            track.appendChild(btn);
          };
          if (ls >= 0 && ls < len) mkHandle("left", ls);
          if (le + 1 > 0 && le + 1 <= len) mkHandle("right", le + 1);
        }
      }

      for (const fr of featRuns) {
        const st = styles.get(fr.f.id);
        const yy = yFeats + fr.lane * 22;
        const bar = abs(`left:${ch(fr.a)};width:${ch(fr.b - fr.a + 1)};top:${yy}px;height:16px;background:${st?.fill ?? "#999"}`, "sv-feature-bar");
        bar.title = `${fr.f.name} · ${fr.f.type} · ${fmtRange(fr.f.start + 1, fr.f.end + 1)}`;
        if ((fr.b - fr.a + 1) * chPx > 32) {
          bar.style.paddingLeft = "4px";
          bar.appendChild(h("span", { class: "sv-feature-name", style: { color: st?.text ?? "" } }, fr.f.name));
        }
        track.appendChild(bar);
      }

      rowEls.push(h("div", { class: "sv-ctx-row" }, gutter, track));
    }

    previewBox.replaceChildren(...rowEls);

    // Compact nudge controls under preview when inspecting saved site.
    if (isSaved) {
      const draft: SeqPrimer = { id: "__draft__", name: name.trim() || "Primer", ...savedSite!, bases: b, color, notes: {}, raw: {} };
      const step = (label: string, d5: number, d3: number, text: string) =>
        h("button", { type: "button", class: "sv-ctx-step", title: label, "aria-label": label, disabled: !resizePrimer(draft, d.sequence, d.circular, d5, d3), onclick: () => resizeDraft(d5, d3) }, text);
      previewFooter.replaceChildren(
        h("span", { class: "sv-small sv-dim" }, "Drag primer ends or nudge bases to tune Tm:"),
        h("span", { class: "sv-ctx-controls" },
          h("span", { class: "sv-ctx-step-group" }, "5′ end", step("Trim 5′ binding end", -1, 0, "−"), step("Extend 5′ binding end", 1, 0, "+")),
          h("span", { class: "sv-ctx-step-group" }, "3′ end", step("Trim 3′ end", 0, -1, "−"), step("Extend 3′ end", 0, 1, "+"))
        )
      );
    } else {
      previewFooter.replaceChildren(
        h("span", { class: "sv-small sv-dim" }, entries.length > 1 ? "Use the site switcher above to return to your saved binding site and adjust ends." : "")
      );
    }
  };

  const render = () => {
    const { d, b, al, report, entries, activeEntry } = computeState();
    undoBtn.disabled = histIdx <= 0;
    redoBtn.disabled = histIdx >= history.length - 1;
    renderColorMenu();

    // Strand toggle: Top / Bottom segmented switch when un-tailed on a savedSite, else Reverse Complement button.
    const hasTail = !!al && al.tail.length > 0;
    if (savedSite && b && !hasTail) {
      const setStrand = (nextStrand: 1 | -1) => {
        if (!savedSite || savedSite.strand === nextStrand) return;
        savedSite = { ...savedSite, strand: nextStrand };
        bases = reverseComplement(b);
        seqInput.value = bases;
        previewKey = null;
        pushHistory();
        render();
      };
      strandBar.replaceChildren(
        h(
          "div",
          { class: "sv-seg", role: "group", "aria-label": "Binding strand" },
          h("button", { type: "button", class: `sv-seg-btn${savedSite.strand === 1 ? " sv-on" : ""}`, "aria-pressed": String(savedSite.strand === 1), onclick: () => setStrand(1) }, "Top →"),
          h("button", { type: "button", class: `sv-seg-btn${savedSite.strand === -1 ? " sv-on" : ""}`, "aria-pressed": String(savedSite.strand === -1), onclick: () => setStrand(-1) }, "← Bottom")
        )
      );
    } else {
      strandBar.replaceChildren(
        h(
          "button",
          {
            type: "button",
            class: "sv-btn",
            disabled: !b,
            title: "Replace sequence with its reverse complement",
            onclick: () => {
              if (!b) return;
              const flipped = reverseComplement(b);
              bases = flipped;
              seqInput.value = flipped;
              const sites = findBindingSites(flipped, d.sequence, d.circular);
              savedSite = sites[0] ? { start: sites[0].start, end: sites[0].end, strand: sites[0].strand } : null;
              previewKey = null;
              pushHistory();
              render();
            }
          },
          "RevComp"
        )
      );
    }

    // Stats readout bar.
    const tmFmt = (t: number | null) => (t === null ? "—" : `${t.toFixed(1)} °C`);
    if (!b || !report) {
      statsBar.replaceChildren(h("span", { class: "sv-dim sv-small" }, "0 nt · Enter a primer sequence to see Tm, GC, and live checks."));
    } else {
      const bindLen = al ? al.binding.length : b.length;
      const tailLen = report.tail.length;
      const changes = changesText(report);
      statsBar.replaceChildren(
        h("span", { class: "sv-pdlg-stat" }, h("strong", null, `${b.length} nt`), tailLen ? ` (${bindLen} bind · ${tailLen} tail)` : ""),
        h("span", { class: "sv-pdlg-dot" }, "·"),
        h("span", { class: "sv-pdlg-stat" }, h("strong", null, `${report.gc.toFixed(0)}%`), " GC"),
        h("span", { class: "sv-pdlg-dot" }, "·"),
        h("span", { class: "sv-pdlg-stat" }, report.arms ? "3′ arm Tm " : "Binding Tm ", h("strong", null, tmFmt(report.tm))),
        ...(tailLen || report.arms ? [h("span", { class: "sv-pdlg-dot" }, "·"), h("span", { class: "sv-pdlg-stat" }, "Full Tm ", h("strong", null, tmFmt(report.tmFull)))] : []),
        ...(changes ? [h("span", { class: "sv-pdlg-dot" }, "·"), h("span", { class: "sv-text-bad sv-small" }, changes)] : [])
      );
    }

    // Site switcher (primary + stored savedSite + partial off-targets).
    if (!entries.length) {
      siteControls.replaceChildren(h("span", { class: "sv-small sv-dim" }, b ? "No binding site" : ""));
    } else {
      const curIdx = Math.max(0, entries.findIndex(e => e.key === activeEntry?.key));
      const stepSite = (delta: -1 | 1) => {
        const next = entries[(curIdx + delta + entries.length) % entries.length];
        previewKey = next.key;
        render();
      };
      const select = h(
        "select",
        { class: "sv-select sv-pdlg-site-select", "aria-label": "Binding sites" },
        entries.map(e => h("option", { value: e.key, selected: e.key === activeEntry?.key }, e.label))
      ) as HTMLSelectElement;
      select.addEventListener("change", () => {
        previewKey = select.value;
        render();
      });
      siteControls.replaceChildren(
        entries.length > 1
          ? h("span", { class: "sv-pdlg-stepper" },
              h("button", { type: "button", class: "sv-ctx-step", "aria-label": "Previous binding site", onclick: () => stepSite(-1) }, "‹"),
              h("span", { class: "sv-small sv-mono sv-dim" }, `${curIdx + 1}/${entries.length}`),
              h("button", { type: "button", class: "sv-ctx-step", "aria-label": "Next binding site", onclick: () => stepSite(1) }, "›")
            )
          : "",
        select
      );
    }

    // Live checks panel (single source of truth from report.checks, warnings first, plus short-sequence warning).
    if (!b || !report) {
      checksBox.replaceChildren();
    } else {
      const allChecks: PrimerCheck[] = [...report.checks];
      if (b.length < MIN_RELIABLE_LEN) {
        allChecks.unshift({
          level: "warn",
          short: "Short primer",
          text: `Only ${b.length} nt — primers under ${MIN_RELIABLE_LEN} bases may anneal poorly or non-specifically. Extend it by typing or dragging the ends above.`
        });
      }
      const warns = allChecks.filter(c => c.level === "warn");
      const oks = allChecks.filter(c => c.level === "ok");
      const ordered = [...warns, ...oks];
      checksBox.replaceChildren(
        h(
          "div",
          { class: "sv-pdlg-checks-head" },
          h("span", { class: "sv-section-title" }, "Live checks"),
          h("span", { class: `sv-small ${warns.length ? "sv-text-warn" : "sv-text-ok"}` }, warns.length ? `${warns.length} warn · ${oks.length} ok` : `${oks.length} ok`),
          h("span", { class: "sv-small sv-dim sv-pdlg-tm-note" }, tmLabel())
        ),
        h(
          "ul",
          { class: "sv-checks sv-pdlg-checks-list" },
          ordered.map(c =>
            h(
              "li",
              { class: c.level === "ok" ? "sv-check-ok" : "sv-check-warn" },
              iconSvg(c.level === "ok" ? "check" : "warn", 14),
              h("span", null, c.text)
            )
          )
        )
      );
    }

    renderLibraryRow();
    renderPreview();
    submitBtn.disabled = !b || !savedSite;
  };

  const submit = () => {
    const d = ctx.store.data;
    const b = cleanBases(bases);
    if (!b || !savedSite) return;
    const trimmedName = name.trim();
    if (editing) {
      const cur = d.primers.find(p => p.id === editing.id);
      if (!cur) return dlg.close();
      const finalName = trimmedName || cur.name;
      const updated: SeqPrimer = {
        ...cur,
        name: finalName,
        bases: b,
        start: savedSite.start,
        end: savedSite.end,
        strand: savedSite.strand,
        color,
        notes: withNote(cur.notes, note, true)
      };
      ctx.store.apply(
        { ...d, primers: d.primers.map(p => (p.id === cur.id ? updated : p)) },
        "Edit primer",
        { range: { start: updated.start, end: updated.end }, focus: { kind: "primer", id: updated.id } }
      );
      if (saveToLib && !libraryMatch(primerLibrary.all, finalName, b).exact) {
        primerLibrary.add([{ name: finalName, bases: b, notes: note.trim(), color }]);
        toast(`Saved ${finalName} to the lab library.`, "success", 2500);
      }
      dlg.close();
    } else {
      const finalName = uniqueName(trimmedName || `Primer ${d.primers.length + 1}`, d.primers.map(p => p.name));
      const p: SeqPrimer = {
        id: newId("p"),
        name: finalName,
        start: savedSite.start,
        end: savedSite.end,
        strand: savedSite.strand,
        bases: b,
        color,
        notes: withNote({}, note, true),
        raw: {}
      };
      ctx.store.apply(
        { ...d, primers: [...d.primers, p] },
        "Add primer",
        { range: { start: p.start, end: p.end }, focus: { kind: "primer", id: p.id } }
      );
      track("primer_added", { how: selectionBacked ? "selection" : "sequence" });
      if (saveToLib && !libraryMatch(primerLibrary.all, finalName, b).exact) {
        primerLibrary.add([{ name: finalName, bases: b, notes: note.trim(), color }]);
        toast(`Saved ${finalName} to the lab library.`, "success", 2500);
      }
      dlg.close();
    }
  };

  // Assemble dialog body & footer.
  const topRow = h("div", { class: "sv-pdlg-top" }, colorWrap, nameInput, noteInput);
  const seqRow = h(
    "div",
    { class: "sv-pdlg-seq-row" },
    h("div", { class: "sv-pdlg-seq-wrap" }, h("span", { class: "sv-pdlg-end sv-mono sv-dim" }, "5′"), seqInput, h("span", { class: "sv-pdlg-end sv-mono sv-dim" }, "3′")),
    strandBar,
    insertToggle,
    h("div", { class: "sv-pdlg-hist" }, undoBtn, redoBtn)
  );
  const metaRow = h("div", { class: "sv-pdlg-meta" }, statsBar, siteControls);
  const previewCard = h("div", { class: "sv-pdlg-preview-card" }, previewBanner, previewBox, previewFooter);

  dlg.body.replaceChildren(topRow, seqRow, insertDrawer, metaRow, previewCard, checksBox);
  dlg.footer.replaceChildren(
    libRow,
    h("div", { class: "sv-pdlg-foot-btns" }, h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"), submitBtn)
  );

  resizeObs = new ResizeObserver(() => renderPreview());
  resizeObs.observe(previewBox);
  render();

  // Focus Name (selected) when pre-filled from a selection, or Sequence when empty/editing.
  requestAnimationFrame(() => {
    if (!editing && !bases) {
      seqInput.focus();
    } else if (!editing) {
      nameInput.focus();
      nameInput.select();
    } else {
      seqInput.focus();
      seqInput.setSelectionRange(seqInput.value.length, seqInput.value.length);
    }
  });
}
