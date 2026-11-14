// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A document: one sequence file in a tab of the main window, shown as Map, Sequence,
// Primers, Reads and Info views around a shared selection, with an outline on the left
// and an inspector on the right. The main window (src/mainWindow.ts) owns the window
// itself and hands each document its keys, menu commands and dropped files.

import "./document.css";

import { h, icon, toast, type ToastHandle } from "../ui/dom.ts";
import { iconSvg, type IconName } from "../ui/icons.ts";
import { choose } from "../ui/modal.ts";
import {
  alertDialog,
  canDetectFeatures,
  canSaveInPlace,
  chooseSavePath,
  confirmDialog,
  filesNeedingAccess,
  isDesktop,
  openSettings,
  pickFileKeys,
  pickFiles,
  readFile,
  requestFileAccess,
  saveText,
  type PickedFile
} from "../platform.ts";
import { addRecentFile } from "../recent.ts";
import { track, trackOnce } from "../usage.ts";
import { basename, dirname, extension, formatForPath, isTraceFile, joinPath, stripExtension, suggestedSaveName, TEXT_READ_EXTENSIONS, type SaveFormat } from "../lib/files.ts";
import { CHECK_EXTENSION, checkFileText, matchByName, type ReadCheck } from "../lib/readCheck.ts";
import { rememberedReads, rememberReads } from "../readChecks.ts";
import { rememberedRotation, rememberRotation } from "../mapRotations.ts";
import { formatComments, parseComments, type LabFields } from "../lib/labinfo.ts";
import { basesIn, newId, rangeLength, reverseComplement, reverseComplementRange, setOrigin, type Range, type SeqData, type SeqPrimer } from "../lib/seqdata.ts";
import { PRIMER_BASES } from "../lib/contextMenu.ts";
import { gcPercent } from "../lib/labinfo.ts";
import { enzymePreferences } from "../lib/enzymes.ts";
import { ALTERNATIVE_STARTS, type OrfOptions } from "../lib/orfs.ts";
import type { Feature } from "../lib/types.ts";
import { codonOffset, describeDifference } from "../lib/genetics.ts";
import { selectionTmText } from "../lib/primers.ts";
import { designOf } from "../lib/variable.ts";
import { loadSettings, onSettingsChanged, saveSettings, type Settings } from "../settings.ts";
import { invertedRanges, selectedBases, selectedRanges } from "../lib/selection.ts";
import { parseSequenceFile, serialize } from "./fileio.ts";
import { fromParsed, toParsed, type LoadedDocument } from "./convert.ts";
import { DocStore } from "./store.ts";
import { openContextMenu } from "./contextMenu.ts";
import { optionsStore, type DocContext, type Tab, type ViewOptions } from "./context.ts";
import { InfoPanel } from "./info.ts";
import { READ_EXTENSIONS, ReadSet } from "../sanger/readSet.ts";
import { MapView } from "../views/mapView.ts";
import { SequenceView } from "../views/sequenceView.ts";
import { Outline } from "../views/outline.ts";
import { Inspector, copyText } from "../views/inspector.ts";
import { PrimersView } from "../views/primersView.ts";
import { openDesignDialog } from "../views/primerDialogs.ts";
import { openCloningDialog } from "../views/cloningDialog.ts";
import { openDetectDialog } from "../views/detectDialog.ts";
import { proteinRegionFeatures, regionsOf, variableProteinFeatures } from "../lib/regions.ts";
import { dismissOffer, offerDismissed } from "../detectOffer.ts";
import { looksUnannotated } from "../lib/detect.ts";
import { describeLost, lostWith } from "../lib/deletion.ts";
import { enzymeOf, prunePick } from "../lib/enzymePick.ts";
import { cutSites } from "./analysis.ts";
import { enzymeLibrary } from "../enzymeLibrary.ts";
import { personalEnzymes } from "../personalEnzymes.ts";
import { openDigestDialog } from "../views/digestDialog.ts";
import { Search } from "../views/search.ts";
import { ReadsView } from "../views/readsView.ts";
import { applyPanelWidths, panelSplitter } from "../panelWidths.ts";
import { fmt, fmtRange } from "../ui/format.ts";
import { documentShortcut, shortcutHint } from "../lib/shortcuts.ts";
import { keyLasts } from "../webFiles.ts";
import { nameToKeep, tidyName } from "../lib/sequenceName.ts";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const VIEW_KEY = "strandivo.view";
const TABS: { id: Tab; label: string; key: string }[] = [
  { id: "map", label: "Map", key: "1" },
  { id: "sequence", label: "Sequence", key: "2" },
  { id: "primers", label: "Primers", key: "3" },
  { id: "reads", label: "Reads", key: "4" },
  { id: "info", label: "Info", key: "5" }
];

const orfOptions = (s: Settings): OrfOptions => ({ minCodons: s.orfs.minCodons, starts: s.orfs.alternativeStarts ? ALTERNATIVE_STARTS : ["ATG"], amberAsQ: s.amberAsQ });

function loadViewOptions(settings: Settings): ViewOptions {
  let saved: Partial<ViewOptions> & { enzymeSet?: unknown } = {};
  try {
    const value = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    if (value && typeof value === "object") saved = value;
  } catch {
    /* ignore */
  }
  return {
    features: settings.show.features,
    sequenceRegions: true,
    sequenceGc: false,
    primerGc: true,
    mapGc: false,
    primers: settings.show.primers,
    ruler: settings.show.ruler,
    translations: settings.show.cdsFeatureTranslations,
    orfs: settings.show.orfs,
    aaColors: false,
    complement: true,
    mapRotation: 0,
    mapZoom: 1,
    labelSize: settings.labelSize,
    linearMap: false,
    ...saved,
    ...enzymePreferences(saved, settings.show.cutsites),
    // Older previews used "none" as the map's detail choice instead of a visibility toggle.
    mapRegions: saved.mapRegions ?? (saved.proteinDetail !== "none"),
    proteinDetail: saved.proteinDetail === "all" ? "all" : "domains",
    labEnzymes: enzymeLibrary.names,
    personalEnzymes: personalEnzymes.names,
    orfOptions: orfOptions(settings),
    caseMode: settings.sequenceCase
  };
}

/** Another open file's sequence and selection, as dialogs that combine files see it. */
export interface OpenSequence {
  title: string;
  data: SeqData;
  selection: Range | null;
}

/** What a document needs from the main window. */
export interface DocHost {
  /** Opens files in other tabs (null = a new sequence). */
  open(paths: (string | null)[]): void;
  /** Opens a sequence made in the app (a cloning product) in a new tab, unsaved. */
  openNew(data: SeqData): void;
  /** The other open files. */
  sequences(): OpenSequence[];
  /** The tab's title, file or edited mark changed. */
  changed(): void;
}

/** One open document, as the main window sees it. */
export interface DocTab {
  readonly el: HTMLElement;
  readonly path: string | null;
  /** File name, or the sequence's name for a new one. */
  readonly title: string;
  isDirty(): boolean;
  /** Shows or hides the views; inactive tabs are taken out of the page. */
  setActive(on: boolean): void;
  /** Runs a window command (the native menu's ids). */
  command(id: string): boolean;
  /** A native menu command; skips one the page just handled from the keyboard. */
  menu(id: string): void;
  keydown(e: KeyboardEvent): void;
  /** Files dropped on the window: reads are added here, other files open in tabs. */
  drop(paths: string[]): Promise<void>;
  /** Offers to save unsaved changes; false keeps the tab open. */
  confirmClose(): Promise<boolean>;
  /** The sequence and selection (absent for a file that couldn't be read). */
  sequence?(): OpenSequence;
  /** What a feedback report may say about this tab: its view, and the file as GenBank. */
  feedbackContext?(): { view: string; file: { name: string; contents: () => string } | null };
  /** Replaces the reads with a check file's. */
  openCheck?(check: ReadCheck): Promise<void>;
  dispose(): void;
  /** What e2e/run.mjs drives (window.__strandivo while this tab is active). */
  readonly testHook: Record<string, unknown>;
}

/**
 * Opens a file, a new empty sequence (null), or `made`: a sequence made in the app,
 * unsaved. A file gets back the reads last checked against it, or `check`'s reads.
 */
export async function openDocument(initialPath: string | null, host: DocHost, made?: SeqData, check?: ReadCheck): Promise<DocTab> {
  let path: string | null = initialPath;
  let settings: Settings = loadSettings();
  let saving = false;

  // ---------- load ----------
  let loaded: LoadedDocument = { data: { name: "Untitled", description: "", circular: true, sequence: "", features: [], primers: [], sources: [] }, extra: {}, wholeSources: [] };
  let labFields: LabFields = [];
  let otherComments: string[] = [];
  let format = made ? "Not saved" : "New sequence";
  if (made) loaded = { data: made, extra: {}, wholeSources: [] };
  else if (path) {
    try {
      const bytes = await readFile(path);
      const parsed = await parseSequenceFile(bytes, path);
      loaded = fromParsed(parsed.sequences[0]);
      const comments = parseComments(loaded.extra.comments as string[] | undefined);
      labFields = comments.fields;
      otherComments = comments.otherComments;
      format = formatName(path);
      if (parsed.sequences.length > 1) toast(`${basename(path)} contains ${parsed.sequences.length} sequences — showing the first.`, "info", 6000);
      addRecentFile(path);
    } catch (e) {
      return errorTab(path, e);
    }
  }
  const store = new DocStore(loaded.data);

  // ---------- shared context ----------
  // The map's rotation is the file's own (label size is a setting, and every map opens unzoomed).
  const opts = optionsStore({ ...loadViewOptions(settings), mapRotation: path ? rememberedRotation(path) : 0 }, o => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ enzymeSource: o.enzymeSource, enzymeFilter: o.enzymeFilter, complement: o.complement, translations: o.translations, orfs: o.orfs, aaColors: o.aaColors, mapZoom: 1, linearMap: o.linearMap, mapRegions: o.mapRegions, proteinDetail: o.proteinDetail, sequenceRegions: o.sequenceRegions, sequenceGc: o.sequenceGc, primerGc: o.primerGc, mapGc: o.mapGc }));
    } catch {
      /* ignore */
    }
  });
  let tab: Tab = "map";
  let split = false;
  let sidebarOpen = true;
  let inspectorOpen = true;
  // The Reads tab's list and inspector are panels of their own: hiding the outline to widen
  // the map shouldn't take the reads away.
  let readsListOpen = true;
  let readsInspectorOpen = true;
  // Sequencing reads align against the current sequence; edits make the results stale.
  // Kept for each version of the document: a library's design can hold a million versions,
  // and what matches them is indexed by the list (`src/lib/versionMatch.ts`).
  const legacyCache = new WeakMap<SeqData, Feature[]>();
  const legacyFeatures = (d: SeqData): Feature[] => {
    let out = legacyCache.get(d);
    if (!out) {
      out = d.features.flatMap(f => [{ id: f.id, name: f.name, type: f.type, start: f.start, end: f.end, forward: f.strand !== -1, strand: f.strand === -1 ? -1 : 1, locations: f.locations, codonStart: codonOffset(f) + 1, variable: designOf(f.notes) ?? undefined }, ...variableProteinFeatures(f, d.sequence.length)]);
      legacyCache.set(d, out);
    }
    return out;
  };
  let dataVersion = 0;
  store.subscribe(c => c.data && dataVersion++);

  // A message about the last edit, with Undo while that edit is still the last one.
  let editNote: { toast: ToastHandle; after: SeqData } | null = null;
  const closeEditNote = () => {
    editNote?.toast.close();
    editNote = null;
  };
  const noteEdit = (message: string) => {
    closeEditNote();
    const note: ToastHandle = toast(message, "info", {
      key: "edit",
      action: {
        label: "Undo",
        title: `Undo${shortcutHint("undo", { mac: isMac, browser: !isDesktop })}`,
        run: () => {
          // Another edit since (the message may still be fading out): Undo would take that back.
          if (editNote?.toast !== note || store.data !== editNote.after) return;
          store.undo();
          // The button took the keyboard from the sequence.
          if (tab === "sequence") seqView.focus();
        }
      }
    });
    editNote = { toast: note, after: store.data };
  };
  store.subscribe(c => {
    if (!c.data) return;
    if (editNote && store.data !== editNote.after) {
      // Typing on joins the same undo step, which its Undo still takes back whole.
      if (c.merged) editNote.after = store.data;
      else closeEditNote();
    }
    // Deleting or replacing bases takes whatever lies wholly inside them along, out of sight.
    const lost = c.before && lostWith(c.before, store.data);
    if (lost) noteEdit(describeLost(lost));
  });
  const reads = new ReadSet(() => {
    const d = store.data;
    return { name: d.name, sequence: d.sequence, circular: d.circular, features: legacyFeatures(d), version: String(dataVersion) };
  });
  const ctx: DocContext = {
    store,
    get options() {
      return opts.get();
    },
    setOptions: patch => {
      if (patch.enzymeSource !== undefined || patch.enzymeFilter !== undefined) pruneEnzymePick({ ...opts.get(), ...patch });
      opts.set(patch);
      if (patch.labelSize !== undefined) void saveSettings({ ...loadSettings(), labelSize: patch.labelSize });
      if (patch.mapRotation !== undefined && path) rememberRotation(path, patch.mapRotation);
    },
    onOptions: fn => opts.on(fn),
    showTab: t => setTab(t),
    get tab() {
      return tab;
    },
    coverage: (r: Range) => reads.coverage(r.start, r.end),
    // Given a feature to make, it is an ORF's CDS (the inspector and the ORF menu).
    addFeatureFromSelection: as => (as ? addFeature(as, "orf") : addFeature()),
    addPrimerFromSelection: () => addPrimer(),
    command: id => void command(id),
    contextMenu: (target, at, onMap = false) =>
      openContextMenu(
        {
          ctx,
          copy: (text, what) => void copyText(text, what),
          designPrimers: (r, name, strand) => designPrimers(r, name, strand),
          addPrimer: strand => addPrimer(strand),
          rename: () => focusInspectorName(),
          // The linear map draws no name: the Info tab's field is the other place to type it.
          renameSequence: () => {
            if (mapView.startRename()) return;
            setTab("info");
            infoPanel.focusName();
          },
          pickColour: () => {
            if (!inspectorOpen) setInspector(true);
            // After the inspector shows the feature.
            requestAnimationFrame(() => requestAnimationFrame(() => inspector.el.querySelector<HTMLInputElement>("input.sv-color")?.click()));
          },
          digest: enzymes => openDigestDialog(ctx, enzymes)
        },
        target,
        at,
        onMap
      ),
    openNew: data => host.openNew(data),
    otherSequences: () => host.sequences(),
    noteEdit,
    renameSequence
  };

  // ---------- views ----------
  const mapView = new MapView(ctx);
  const seqView = new SequenceView(ctx);
  const primersView = new PrimersView(ctx);
  const outline = new Outline(ctx);
  const inspector = new Inspector(ctx, {
    copy: (text, what) => void copyText(text, what),
    designPrimers: (r, name, strand) => designPrimers(r, name, strand)
  });
  const search = new Search(ctx);

  const readsView = new ReadsView(ctx, reads, {
    addReads: () => void addReads(),
    openSettings: () => void openSettings(),
    recordInInfo: () => {
      setTab("info");
      infoPanel.fillFromSequencing();
    },
    copy: (text, what) => void copyText(text, what),
    legacyFeatures: () => legacyFeatures(store.data),
    saveCheck: () => void saveCheck(),
    // Safari and Firefox hold a file only for the visit (src/webFiles.ts).
    forgetsReads: () => !isDesktop && ((!!path && !keyLasts(path)) || reads.saved().some(r => !keyLasts(r.path)))
  });
  const infoHost = h("div", { class: "sv-pane-inner sv-info-host" });
  const panes: Record<Tab | "split", HTMLElement> = {
    map: h("section", { class: "sv-pane sv-pane-map", "aria-label": "Map" }, mapView.el),
    sequence: h("section", { class: "sv-pane sv-pane-seq", "aria-label": "Sequence" }, seqView.el),
    primers: h("section", { class: "sv-pane sv-pane-primers", "aria-label": "Primers" }, primersView.el),
    reads: h("section", { class: "sv-pane sv-pane-reads", "aria-label": "Sequencing reads" }, readsView.el),
    info: h("section", { class: "sv-pane sv-pane-info", "aria-label": "Plasmid info" }, infoHost),
    split: h("div")
  };
  const main = h("main", { class: "sv-main" }, panes.map, panes.sequence, panes.primers, panes.reads, panes.info);

  // ---------- toolbar ----------
  const nameEl = h("div", { class: "sv-doc-name" });
  const metaEl = h("div", { class: "sv-doc-meta" });
  const badges: Partial<Record<Tab, HTMLElement>> = {};
  const tabButtons = TABS.map(t => {
    const badge = t.id === "primers" || t.id === "reads" ? h("span", { class: "sv-badge", hidden: true }) : null;
    if (badge) badges[t.id] = badge;
    return h(
      "button",
      { type: "button", role: "tab", class: "sv-tab", "data-tab": t.id, title: `${t.label}${shortcutHint(`show-${t.id}`, { mac: isMac, browser: !isDesktop })}`, onclick: () => setTab(t.id) },
      t.label,
      badge
    );
  });
  const toolButton = (iconName: IconName, label: string, onclick: () => void, extra: Record<string, unknown> = {}) =>
    h("button", { type: "button", class: "sv-icon-btn", "aria-label": label, title: label, onclick, ...extra }, iconSvg(iconName, 18));
  const splitButton = toolButton("split", "Split view: map and sequence side by side", () => setSplit(!split), { "aria-pressed": "false" });
  const sidebarButton = toolButton("sidebar", "Show sidebar", () => toggleSidebar(), { "aria-pressed": "true" });
  const inspectorButton = toolButton("inspector", "Show inspector", () => toggleInspector(), { "aria-pressed": "true" });
  const undoButton = toolButton("undo", "Undo", () => store.undo());
  const redoButton = toolButton("redo", "Redo", () => store.redo());
  const sep = () => h("span", { class: "sv-tool-sep", "aria-hidden": "true" });
  // Each panel's button sits on its side of the window; split view sits with the views it
  // shows; the tools are grouped by what they do: editing, adding, reactions, export.
  const header = h(
    "header",
    { class: "sv-toolbar" },
    sidebarButton,
    h("div", { class: "sv-doc-title" }, nameEl, metaEl),
    h("div", { class: "sv-views" }, h("nav", { class: "sv-tabs", role: "tablist", "aria-label": "Views" }, tabButtons), splitButton),
    h(
      "div",
      { class: "sv-tools" },
      search.el,
      sep(),
      undoButton,
      redoButton,
      sep(),
      toolButton("featureAdd", "Add feature for the selection", () => addFeature()),
      toolButton("primerAdd", "Add primer for the selection", () => addPrimer()),
      toolButton("detect", "Detect common features…", () => openDetectDialog(ctx)),
      sep(),
      toolButton("gel", "Digest…", () => openDigestDialog(ctx)),
      toolButton("clone", "Simulate cloning…", () => openCloningDialog(ctx)),
      sep(),
      toolButton("export", "Export GenBank or FASTA", () => void exportMenu())
    ),
    inspectorButton
  );

  // ---------- status bar ----------
  const statusLeft = h("div", { class: "sv-status-left" });
  const statusRight = h("div", { class: "sv-status-right" });
  const status = h("footer", { class: "sv-status" }, statusLeft, statusRight);

  // A quiet strip, never a dialog: the file is only sparsely annotated, which is a
  // suggestion worth making once and not an interruption worth making every time.
  const offer = h("div", { class: "sv-offer", hidden: true });
  // Reads that wait on the browser: its permission, or for the user to choose them.
  const readsOffer = h("div", { class: "sv-offer sv-reads-offer", hidden: true });
  applyPanelWidths();
  const outlineSplit = panelSplitter("sidebar", () => outline.el);
  const inspectorSplit = panelSplitter("inspector", () => inspector.el);
  const body = h("div", { class: "sv-body" }, outline.el, outlineSplit, main, inspectorSplit, inspector.el);
  const app = h("div", { class: "sv-app" }, header, offer, readsOffer, body, status);

  function showOffer() {
    const d = store.data;
    if (settings.offerDetection === false || offerDismissed(path) || !canDetectFeatures()) return;
    if (!looksUnannotated(d.features.length, d.sequence.length)) return;
    offer.replaceChildren(
      iconSvg("detect", 16),
      h("span", { class: "sv-offer-text" }, d.features.length ? "This file has few features for its size. Look for known parts?" : "This file has no features. Look for known parts?"),
      h("button", { type: "button", class: "sv-btn sv-btn-small sv-btn-primary", onclick: () => { hideOffer(); openDetectDialog(ctx); } }, "Detect features…"),
      h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => { dismissOffer(path); hideOffer(); } }, "Not now")
    );
    offer.hidden = false;
  }
  const hideOffer = () => {
    offer.hidden = true;
    offer.replaceChildren();
  };
  // Once the user adds features, whether from detection or by hand, it has had its say.
  store.subscribe(c => c.data && !offer.hidden && !looksUnannotated(store.data.features.length, store.data.sequence.length) && hideOffer());

  // ---------- reads and info ----------
  // The app remembers a file's reads (decision 1 in docs/clone-checking.md).
  let remembered = "";
  /** Remembered reads the browser asks about before they are read: still remembered meanwhile. */
  let waiting: ReadCheck["reads"] = [];
  reads.onChange(() => {
    if (!path || reads.running) return;
    const added = reads.saved();
    const saved = [...waiting.filter(w => !added.some(r => r.path === w.path)), ...added];
    const text = JSON.stringify(saved);
    if (text === remembered) return;
    remembered = text;
    rememberReads(path, saved.length ? { reference: path, reads: saved } : null);
  });
  reads.onChange(() => {
    const b = badges.reads!;
    b.hidden = reads.count === 0;
    b.textContent = String(reads.count);
    b.classList.toggle("sv-badge-warn", reads.attention() > 0);
    inspector.refresh();
    // The Reads tab has panels only once it has reads.
    if (tab === "reads") panelButtons();
  });

  let infoDirty = false;
  const infoPanel = new InfoPanel(infoHost, labFields, {
    facts: () => {
      const d = store.data;
      return { name: d.name, description: d.description, sequence: d.sequence, circular: d.circular, features: legacyFeatures(d), primerCount: d.primers.length };
    },
    rename: renameSequence,
    setDescription: description => store.apply({ ...store.data, description }, "Edit description"),
    changed: () => {
      infoDirty = true;
      refreshTitle();
    },
    sequencing: () => reads.summary(),
    setCircular: circular => store.apply({ ...store.data, circular }, circular ? "Make circular" : "Make linear"),
    openReads: () => (reads.count ? setTab("reads") : void addReads()),
    readsOverview: () => {
      if (!reads.count) return null;
      const n = store.data.sequence.length;
      const cov = n ? reads.coverage(0, n - 1) : null;
      const differences = reads
        .sites()
        .filter(x => x.confident)
        .map(x => {
          const effect = x.consequences.map(c => (c.severity === "noncoding" ? c.label : `${c.label} in ${c.feature.name || "feature"}`)).join("; ");
          return `${describeDifference(x.seen[0].diff, n)}${effect ? `: ${effect}` : ""}`;
        });
      return { reads: reads.count, aligned: reads.aligned().length, covered: cov?.covered ?? 0, total: n, differences };
    }
  });
  reads.onChange(() => tab === "info" && infoPanel.render());

  // ---------- tabs, split, inspector ----------
  function layout() {
    const showSplit = split && (tab === "map" || tab === "sequence");
    for (const t of TABS) {
      const shown = t.id === tab || (showSplit && (t.id === "map" || t.id === "sequence"));
      panes[t.id].hidden = !shown;
    }
    main.classList.toggle("sv-main-split", showSplit);
    for (const b of tabButtons) {
      const id = b.dataset.tab as Tab;
      const active = id === tab || (showSplit && (id === "map" || id === "sequence"));
      b.setAttribute("aria-selected", String(active));
      b.classList.toggle("sv-tab-active", active);
    }
    const sidePanels = tab === "map" || tab === "sequence" || tab === "primers";
    outline.el.hidden = !sidePanels || tab === "primers" || !sidebarOpen;
    inspector.el.hidden = !sidePanels || !inspectorOpen;
    outlineSplit.hidden = outline.el.hidden;
    inspectorSplit.hidden = inspector.el.hidden;
    readsView.setPanels(readsListOpen, readsInspectorOpen);
    panelButtons();
    mapView.setVisible(!panes.map.hidden);
    seqView.setVisible(!panes.sequence.hidden);
    primersView.setVisible(!panes.primers.hidden);
    readsView.setVisible(tab === "reads");
    if (tab === "info") infoPanel.render();
  }

  // A button for something this view doesn't have is turned off, not shown as on.
  function panelButtons() {
    const panelButton = (b: HTMLButtonElement, on: boolean, offered: boolean, label?: string) => {
      b.disabled = !offered;
      b.setAttribute("aria-pressed", String(on && offered));
      b.classList.toggle("sv-on", on && offered);
      if (label) {
        b.title = label;
        b.setAttribute("aria-label", label);
      }
    };
    const readsShown = tab === "reads" && reads.count > 0;
    panelButton(splitButton, split, tab === "map" || tab === "sequence");
    panelButton(
      sidebarButton,
      readsShown ? readsListOpen : sidebarOpen,
      tab === "map" || tab === "sequence" || readsShown,
      readsShown ? "Show sidebar: reads" : "Show sidebar: features, primers and enzymes"
    );
    panelButton(inspectorButton, readsShown ? readsInspectorOpen : inspectorOpen, tab === "map" || tab === "sequence" || tab === "primers" || readsShown);
  }

  function setTab(t: Tab) {
    if (t !== tab) trackOnce("view_used", { view: t });
    tab = t;
    layout();
    if (t === "sequence") seqView.focus();
    inspector.refresh();
  }
  function setSplit(on: boolean) {
    split = on;
    if (on && tab !== "map" && tab !== "sequence") tab = "map";
    layout();
  }
  function setInspector(on: boolean) {
    inspectorOpen = on;
    layout();
  }
  // The panels of the view in front: the Reads tab's own, or the outline and inspector.
  function toggleSidebar() {
    if (tab === "reads") readsListOpen = !readsListOpen;
    else sidebarOpen = !sidebarOpen;
    layout();
  }
  function toggleInspector() {
    if (tab === "reads") readsInspectorOpen = !readsInspectorOpen;
    else inspectorOpen = !inspectorOpen;
    layout();
  }

  // ---------- title and status ----------
  let title = "";
  let lastShown = "";
  // A sequence made in the app counts as changed until it is saved.
  const isDirty = () => store.dirty || infoDirty || (!!made && !path);
  function refreshTitle() {
    const d = store.data;
    const dirty = isDirty();
    title = path ? basename(path) : d.name || "Untitled";
    nameEl.textContent = d.name || title;
    metaEl.textContent = `${fmt(d.sequence.length)} bp · ${d.circular ? "circular" : "linear"} · ${format}${dirty ? " · edited" : ""}`;
    const shown = `${title}|${path}|${dirty}`;
    if (shown !== lastShown) {
      lastShown = shown;
      host.changed();
    }
    const pb = badges.primers!;
    pb.hidden = d.primers.length === 0;
    pb.textContent = String(d.primers.length);
    undoButton.disabled = !store.canUndo;
    redoButton.disabled = !store.canRedo;
    undoButton.title = store.canUndo ? `Undo ${store.undoLabel?.toLowerCase() || ""}`.trim() : "Undo";
    redoButton.title = store.canRedo ? `Redo ${store.redoLabel?.toLowerCase() || ""}`.trim() : "Redo";
  }
  function refreshStatus() {
    const d = store.data;
    const n = d.sequence.length;
    const { range, focus, caret } = store.selection;
    const left: (Node | string)[] = [];
    if (store.selection.ranges) {
      const ranges = selectedRanges(store.selection);
      const bases = selectedBases(d.sequence, store.selection);
      left.push(h("span", { class: "sv-status-strong" }, `${ranges.length} stretches selected`), h("span", null, `${fmt(bases.length)} bp`), h("span", null, `GC ${gcPercent(bases).toFixed(1)}%`));
    } else if (range) {
      let label = "Selection";
      if (focus?.kind === "feature") {
        const f = d.features.find(x => x.id === focus.id);
        const region = f && focus.region !== undefined ? regionsOf(f)[focus.region] : undefined;
        label = `${region?.name ?? f?.name ?? "Feature"} selected`;
      }
      else if (focus?.kind === "primer") label = `${d.primers.find(p => p.id === focus.id)?.name ?? "Primer"} selected`;
      else if (focus?.kind === "cutsite") label = store.selection.enzymes ? `${store.selection.enzymes.length} enzymes picked` : `${enzymeOf(focus.id)} site selected`;
      else if (focus?.kind === "orf") label = "ORF selected";
      const len = rangeLength(range, n);
      const bases = basesIn(d.sequence, range);
      const tm = selectionTmText(bases);
      left.push(
        h("span", { class: "sv-status-strong" }, label),
        h("span", { class: "sv-mono" }, fmtRange(range.start + 1, range.end + 1)),
        h("span", null, `${fmt(len)} bp`),
        h("span", null, `GC ${gcPercent(bases).toFixed(1)}%`)
      );
      if (tm !== null) left.push(h("span", { class: "sv-status-tm" }, `Tm ${tm}`));
    } else {
      left.push(h("span", null, `Cursor ${fmt(caret)}`), h("span", { class: "sv-dim" }, n ? "Type to insert bases on the Sequence tab" : "Empty sequence"));
    }
    statusLeft.replaceChildren(...left);
    statusRight.replaceChildren(
      h("span", null, `${fmt(n)} bp · ${d.circular ? "circular" : "linear"}`),
      h("span", null, `GC ${gcPercent(d.sequence).toFixed(1)}%`),
      h("span", null, `${fmt(d.features.length)} feature${d.features.length === 1 ? "" : "s"}`)
    );
  }
  store.subscribe(() => {
    refreshTitle();
    refreshStatus();
  });
  refreshTitle();
  refreshStatus();

  // ---------- adding things ----------
  function addFeature(as: { name: string; type: string; strand: 1 | -1 } = { name: "New feature", type: "misc_feature", strand: 1 }, how: "selection" | "orf" = "selection") {
    const { range } = store.selection;
    if (!range) {
      toast("Select a region on the map or sequence first.", "info", 4000);
      return;
    }
    const id = newId("f");
    const d = store.data;
    store.apply(
      { ...d, features: [...d.features, { id, ...as, start: range.start, end: range.end, notes: {}, raw: {} }] },
      "Add feature",
      { range, focus: { kind: "feature", id } }
    );
    track("feature_added", { how });
    focusInspectorName();
  }

  /** The sequence's own name, from the map or the Info tab; its file keeps its name. */
  function renameSequence(typed: string) {
    const name = tidyName(typed);
    if (name && name !== store.data.name) store.apply({ ...store.data, name }, "Rename");
  }

  /** A primer from the selected bases: on the top strand, or the bottom one (`strand` -1). */
  function addPrimer(strand: 1 | -1 = 1) {
    const { range } = store.selection;
    const d = store.data;
    const len = range ? rangeLength(range, d.sequence.length) : 0;
    if (!range || len < PRIMER_BASES.min || len > PRIMER_BASES.max) {
      toast(`Select ${PRIMER_BASES.min}–${PRIMER_BASES.max} bases to create a primer.`, "info", 4500);
      return;
    }
    const id = newId("p");
    const name = uniqueName(`Primer ${d.primers.length + 1}`, d.primers.map(p => p.name));
    const top = basesIn(d.sequence, range).toUpperCase();
    const primer: SeqPrimer = { id, name, start: range.start, end: range.end, strand, bases: strand === 1 ? top : reverseComplement(top), notes: {}, raw: {} };
    store.apply({ ...d, primers: [...d.primers, primer] }, "Add primer", { range, focus: { kind: "primer", id } });
    track("primer_added", { how: "selection" });
    focusInspectorName();
  }

  /** Designs a pair for the region, to review before adding. */
  function designPrimers(r: Range, label: string, strand: 1 | -1 | 0 = 1) {
    openDesignDialog(ctx, { range: r, label, strand });
  }

  function focusInspectorName() {
    if (!inspectorOpen) setInspector(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const input = inspector.el.querySelector<HTMLInputElement>(".sv-insp-name");
        input?.focus();
        input?.select();
      })
    );
  }

  // ---------- saving ----------
  function fileJson(includeRegions = false): Record<string, unknown> {
    const d = store.data;
    const json = toParsed(loaded, includeRegions ? { ...d, features: [...d.features, ...d.features.flatMap(f => proteinRegionFeatures(f, d.sequence.length))] } : d);
    json.comments = formatComments(infoPanel.getFields(), otherComments, nameToKeep(d.name));
    return json;
  }

  async function save(saveAs: boolean): Promise<boolean> {
    if (saving) return false;
    saving = true;
    try {
      let target = path;
      let fmtOut: SaveFormat | null = target ? formatForPath(target) : null;
      // A browser can only write over a file it has a handle to; otherwise Save is Save As.
      if (saveAs || !target || !fmtOut || !canSaveInPlace(target)) {
        const wasUnwritable = !saveAs && !!target && !fmtOut;
        const suggestion = joinPath(target ? dirname(target) : "", suggestedSaveName(target, store.data.name, "genbank"));
        if (wasUnwritable && isDesktop) toast(`${extension(target!).toUpperCase()} files can't be written yet — saving a GenBank copy instead.`, "info", 5000);
        const chosen = await chooseSavePath(suggestion, [
          { name: "GenBank", extensions: ["gb", "gbk"] },
          { name: "FASTA", extensions: ["fasta", "fa"] }
        ]);
        if (!chosen) return false;
        target = extension(chosen) ? chosen : chosen + ".gb";
        fmtOut = formatForPath(target) ?? "genbank";
      }
      if (fmtOut === "fasta" && (store.data.features.length || store.data.primers.length)) {
        const ok = await confirmDialog("FASTA files store only the sequence, so features and primers won't be saved. Save as FASTA anyway?", { okLabel: "Save as FASTA", cancelLabel: "Cancel" });
        if (!ok) return false;
      }
      await saveTo(target, fmtOut);
      return true;
    } catch (e) {
      await alertDialog(`Couldn't save: ${e instanceof Error ? e.message : e}`);
      return false;
    } finally {
      saving = false;
    }
  }

  /** Writes the document to a file, which becomes the window's file. */
  async function saveTo(target: string, fmtOut: SaveFormat) {
    // What is written is what counts as saved: an edit made while the file is being written
    // still needs saving afterwards. Typing that hasn't applied yet is part of it.
    inspector.flush();
    const written = store.data;
    const text = serialize(fileJson(), fmtOut);
    const infoWas = infoDirty;
    infoDirty = false;
    try {
      await saveText(target, text);
    } catch (e) {
      infoDirty ||= infoWas;
      throw e;
    }
    track("file_saved", { format: fmtOut, how: "save" });
    store.markSaved(written);
    if (target !== path) {
      path = target;
      rememberRotation(target, opts.get().mapRotation);
      format = formatName(target);
      addRecentFile(target);
    }
    refreshTitle();
    toast(`Saved ${basename(target)}`, "success", 1800);
  }

  async function exportAs(fmtOut: SaveFormat, includeRegions = false) {
    const suggestion = joinPath(path ? dirname(path) : "", includeRegions ? `${store.data.name}-regions.gb` : suggestedSaveName(path, store.data.name, fmtOut));
    const chosen = await chooseSavePath(suggestion, [fmtOut === "fasta" ? { name: "FASTA", extensions: ["fasta", "fa"] } : { name: "GenBank", extensions: ["gb", "gbk"] }]);
    if (!chosen) return;
    inspector.flush();
    try {
      await saveText(chosen, serialize(fileJson(includeRegions), fmtOut));
      track("file_saved", { format: fmtOut, how: "export" });
      toast(`Exported ${basename(chosen)}`, "success");
    } catch (e) {
      await alertDialog(`Couldn't export: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function exportMenu() {
    const choice = await choose("Export", "Save a copy of this sequence in another format.", [
      { label: "Cancel", value: "cancel" as const },
      { label: "FASTA…", value: "fasta" as const },
      { label: "GenBank with protein regions…", value: "regions" as const },
      { label: "GenBank…", value: "genbank" as const, primary: true }
    ], "cancel" as const);
    if (choice !== "cancel") await exportAs(choice === "regions" ? "genbank" : choice, choice === "regions");
  }

  // ---------- reads ----------
  const readCount = (n: number) => (n === 1 ? "the read" : `the ${fmt(n)} reads`);

  function offerReads(text: string, label: string, act: () => Promise<void>) {
    readsOffer.replaceChildren(
      iconSvg("wave", 16),
      h("span", { class: "sv-offer-text", title: text }, text),
      h("button", { type: "button", class: "sv-btn sv-btn-small sv-btn-primary", onclick: () => void act() }, label),
      h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: hideReadsOffer }, "Not now")
    );
    readsOffer.hidden = false;
  }
  function hideReadsOffer() {
    readsOffer.hidden = true;
    readsOffer.replaceChildren();
  }

  /**
   * Adds the reads of a check, or those remembered for this file. In a browser, reads it
   * wants to ask about first wait for a click (it allows asking only then), and a check's
   * reads that can't be reached from here are chosen by the user, matched by name
   * (docs/web-version-plan.md, part 4). Nothing is added until all can be, so the check's
   * order and clones are kept.
   */
  async function restoreReads(c: ReadCheck, fromCheckFile: boolean) {
    if (fromCheckFile) {
      reads.useCheckSettings(c);
      setTab("reads");
    }
    const locked = await filesNeedingAccess(c.reads.map(r => r.path));
    if (locked.length) {
      if (!fromCheckFile) waiting = c.reads;
      offerReads(
        `Allow browser access to load ${readCount(c.reads.length)} ${fromCheckFile ? "from this check" : "previously aligned to this file"}.`,
        "Allow access",
        async () => {
          const refused = await requestFileAccess(c.reads.map(r => r.path));
          hideReadsOffer();
          waiting = [];
          if (refused.length) toast(`Your browser didn't allow Strandivo to read ${refused.length === 1 ? "one of the reads" : `${fmt(refused.length)} of the reads`}.`, "info", 6000);
          await addCheckReads({ ...c, reads: c.reads.filter(r => !refused.includes(r.path)) }, fromCheckFile, fromCheckFile);
        }
      );
      return;
    }
    await addCheckReads(c, fromCheckFile, fromCheckFile);
  }

  async function addCheckReads(c: ReadCheck, fromCheckFile: boolean, askMissing: boolean) {
    const files: PickedFile[] = [];
    const clones: (string | null)[] = [];
    const missing: string[] = [];
    for (const r of c.reads) {
      try {
        files.push({ name: basename(r.path), path: r.path, bytes: await readFile(r.path) });
        clones.push(r.clone);
      } catch {
        missing.push(r.path);
      }
    }
    if (missing.length && askMissing && !isDesktop) {
      offerReads("Select the read files for this check — Strandivo will match them by filename.", `Add ${readCount(missing.length)} this check lists…`, async () => {
        const picked = await pickFileKeys("Sequencing reads", READ_EXTENSIONS).catch(e => {
          toast(`Couldn't open: ${e instanceof Error ? e.message : e}`, "error", 6000);
          return [] as string[];
        });
        if (!picked.length) return;
        hideReadsOffer();
        await addCheckReads(matchByName(c, picked), true, false);
      });
      return;
    }
    if (missing.length) {
      const names = missing.map(p => basename(p));
      const which = `${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`;
      const where = fromCheckFile ? "in the check" : "checked against this file before";
      toast(`${missing.length === 1 ? "A read" : `${missing.length} reads`} ${where} couldn't be found (${isDesktop ? "moved or deleted?" : "not chosen, moved or deleted?"}): ${which}`, "error", 9000);
    }
    if (files.length) await reads.addFiles(files, clones);
  }

  /** Saves the reads, their clones and the quality settings as a check file. */
  async function saveCheck(target?: string) {
    if (!path) {
      toast("Save this sequence first, so the check can point to it.", "info", 5000);
      return;
    }
    const saved = reads.saved();
    if (!saved.length) {
      toast("Only reads loaded from files can be saved in a check.", "info", 5000);
      return;
    }
    const suggestion = joinPath(dirname(saved[0].path), `${stripExtension(basename(path))} reads.${CHECK_EXTENSION}`);
    const where = target ?? (await chooseSavePath(suggestion, [{ name: "Strandivo read check", extensions: [CHECK_EXTENSION] }]));
    if (!where) return;
    try {
      await saveText(where, checkFileText(where, { reference: path, reads: saved, minQuality: reads.minQuality, trimCutoff: reads.trimCutoff }));
      track("check_saved");
      toast(`Saved ${basename(where)}. Open it to see these reads again, here or on another computer.`, "info", 5000);
    } catch (e) {
      toast(`Couldn't save the check: ${e instanceof Error ? e.message : e}`, "error", 8000);
    }
  }

  async function addReads(files?: PickedFile[]) {
    setTab("reads");
    // In a browser too, picked reads get a path (a key), to be remembered and saved in checks.
    const picked = files ?? (await pickFiles("Sequencing reads", READ_EXTENSIONS, true));
    if (picked.length) await reads.addFiles(picked);
  }

  // ---------- settings from the Settings window ----------
  const offSettings = onSettingsChanged(next => {
    const prev = settings;
    settings = next;
    if (next.labelSize !== prev.labelSize && next.labelSize !== ctx.options.labelSize) opts.set({ labelSize: next.labelSize });
    if (next.sequenceCase !== ctx.options.caseMode) opts.set({ caseMode: next.sequenceCase });
    // Reading TAG as Q changes ORFs and every translation, so views redraw.
    if (JSON.stringify(next.orfs) !== JSON.stringify(prev.orfs) || next.amberAsQ !== prev.amberAsQ) opts.set({ orfOptions: orfOptions(next) });
    if (JSON.stringify(next.tm) !== JSON.stringify(prev.tm)) {
      // Every view that shows a Tm redraws with the new method.
      opts.set({});
      refreshStatus();
    }
    reads.applySettings(next);
    readsView.refresh();
    if (tab === "info") infoPanel.render();
  });
  // Membership updates reach every document; changes to stock notes keep stable names.
  function pruneEnzymePick(nextOptions: ViewOptions) {
    const next = prunePick(store.selection, cutSites(store.data, nextOptions));
    if (next) store.select(
      next.site ? { range: { start: next.site.start, end: next.site.end }, focus: { kind: "cutsite", id: next.site.id }, enzymes: next.enzymes } : { range: null, caret: store.selection.caret },
      "enzyme-list"
    );
  }
  let libraryError = `${enzymeLibrary.loaded}:${enzymeLibrary.error}`;
  let personalError = `${personalEnzymes.loaded}:${personalEnzymes.error}`;
  const offEnzymeLibrary = enzymeLibrary.onChange(() => {
    const names = enzymeLibrary.names;
    if (names !== ctx.options.labEnzymes) {
      pruneEnzymePick({ ...ctx.options, labEnzymes: names });
      opts.set({ labEnzymes: names });
    } else if (libraryError !== `${enzymeLibrary.loaded}:${enzymeLibrary.error}` && ctx.options.enzymeSource === "lab") opts.set({});
    libraryError = `${enzymeLibrary.loaded}:${enzymeLibrary.error}`;
  });
  const offPersonalEnzymes = personalEnzymes.onChange(() => {
    const names = personalEnzymes.names;
    if (names !== ctx.options.personalEnzymes) {
      pruneEnzymePick({ ...ctx.options, personalEnzymes: names });
      opts.set({ personalEnzymes: names });
    } else if (personalError !== `${personalEnzymes.loaded}:${personalEnzymes.error}` && ctx.options.enzymeSource === "personal") opts.set({});
    personalError = `${personalEnzymes.loaded}:${personalEnzymes.error}`;
  });

  // ---------- keyboard ----------
  const inField = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.tagName === "INPUT" || a.tagName === "SELECT" || (a.tagName === "TEXTAREA" && !a.classList.contains("sv-clipboard")) || a.isContentEditable);
  };
  function command(id: string): boolean {
    switch (id) {
      case "save":
        void save(false);
        return true;
      case "save-as":
        void save(true);
        return true;
      case "export-genbank":
        void exportAs("genbank");
        return true;
      case "export-fasta":
        void exportAs("fasta");
        return true;
      case "add-reads":
        void addReads();
        return true;
      case "find":
        search.focus();
        return true;
      case "undo":
        if (inField()) document.execCommand("undo");
        else store.undo();
        return true;
      case "redo":
        if (inField()) document.execCommand("redo");
        else store.redo();
        return true;
      case "select-all":
        if (inField()) (document.activeElement as HTMLInputElement).select?.();
        else if (store.length) {
          store.select({ range: { start: 0, end: store.length - 1 }, caret: store.length, anchor: 0 }, "menu");
          if (tab === "sequence") seqView.focus();
        }
        return true;
      case "invert-selection":
        // The bases left out, dropping a clicked annotation and picked codons or enzymes.
        if (!inField()) {
          store.select({ ranges: invertedRanges(store.selection, store.length, store.data.circular) }, "menu");
          if (tab === "sequence") seqView.focus();
        }
        return true;
      case "split-view":
        setSplit(!split);
        return true;
      case "toggle-sidebar":
        toggleSidebar();
        return true;
      case "toggle-inspector":
        toggleInspector();
        return true;
      case "add-feature":
        addFeature();
        return true;
      case "detect-features":
        openDetectDialog(ctx);
        return true;
      case "add-primer":
        addPrimer();
        return true;
      case "digest":
        openDigestDialog(ctx);
        return true;
      case "simulate-cloning":
        openCloningDialog(ctx);
        return true;
      case "reverse-complement": {
        if (store.selection.ranges) {
          toast("Select one continuous stretch to reverse-complement bases.", "info", 4000);
          return true;
        }
        const { range } = store.selection;
        if (range && range.start > range.end) {
          toast("Selections that cross the origin can't be reverse-complemented.", "info", 4000);
          return true;
        }
        if (!store.length) return true;
        store.apply(reverseComplementRange(store.data, range), range ? "Reverse-complement selection" : "Reverse-complement sequence", range ? { range } : { range: null, caret: 0 });
        return true;
      }
      case "set-origin": {
        if (store.selection.ranges) {
          toast("Place the cursor where the sequence should start.", "info");
          return true;
        }
        const c = store.selection.range ? store.selection.range.start : store.selection.caret;
        if (!store.data.circular) toast("Only circular sequences have an origin.", "info");
        else if (c <= 0 || c >= store.length) toast("Place the cursor where the sequence should start.", "info");
        else store.apply(setOrigin(store.data, c), "Set origin", { range: null, caret: 0 });
        return true;
      }
      case "show-map":
        setTab("map");
        return true;
      case "show-sequence":
        setTab("sequence");
        return true;
      case "show-primers":
        setTab("primers");
        return true;
      case "show-reads":
        setTab("reads");
        return true;
      case "show-info":
        setTab("info");
        return true;
    }
    return false;
  }
  // Shortcuts that are also native menu items. Depending on the platform the page or the
  // menu sees the key first (or both do), so the menu skips a command the page just handled.
  const shortcutCommand = (e: KeyboardEvent) => documentShortcut(e, { mac: isMac, browser: !isDesktop });
  let lastShortcut: { id: string; at: number; handled: boolean } | null = null;
  const seqField = () => document.activeElement === seqView.el.querySelector(".sv-clipboard");
  const keydown = (e: KeyboardEvent) => {
    const id = shortcutCommand(e);
    if (id && !e.defaultPrevented) {
      // Text fields keep these keys, and the sequence handles its own undo and select-all.
      const sequenceOwn = id === "undo" || id === "redo" || id === "select-all";
      const fieldOwn = sequenceOwn || id === "invert-selection";
      if (!(fieldOwn && inField()) && !(sequenceOwn && seqField())) {
        e.preventDefault();
        command(id);
      }
    } else if (!id && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s" && !isDesktop) {
      e.preventDefault();
      void save(e.shiftKey);
    } else if (e.key === "Escape" && !e.defaultPrevented && (store.selection.enzymes || store.selection.codons) && !inField() && !seqField() && !document.querySelector(".sv-dialog-overlay, .ps-modal-overlay")) {
      // Esc drops picked enzymes or codons (the sequence handles its own Esc).
      e.preventDefault();
      store.select({ range: null, caret: store.selection.caret }, "keys");
    }
    if (id) lastShortcut = { id, at: performance.now(), handled: e.defaultPrevented };
  };
  const fromMenu = (id: string) => {
    const k = lastShortcut;
    if (k && k.id === id && performance.now() - k.at < 500) {
      lastShortcut = null;
      // The page handled the key, or (outside macOS) the focused text field did.
      if (k.handled || !isMac) return;
    }
    command(id);
  };

  // Driven by the end-to-end tests (e2e/run.mjs) without native dialogs.
  const testHook = {
    /** Save check… without the file dialog. */
    saveCheck: (target: string) => saveCheck(target),
    addReadPaths: async (paths: string[]) => {
      const files: PickedFile[] = [];
      for (const p of paths) files.push({ name: basename(p), path: p, bytes: await readFile(p) });
      await addReads(files);
    },
    setView: (v: string) => setTab((v === "reads" || v === "info" || v === "map" || v === "sequence" || v === "primers" ? v : "map") as Tab),
    isDirty,
    /** Save As without the file dialog. */
    saveAs: (target: string) => saveTo(target, formatForPath(target) ?? "genbank"),
    store,
    command,
    paste: (text: string) => seqView.pasteText(text),
    state: () => ({ sequenceData: { ...store.data, primers: store.data.primers } })
  };

  async function drop(paths: string[]) {
    const readPaths = paths.filter(p => isTraceFile(p) || TEXT_READ_EXTENSIONS.includes(extension(p)));
    const others = paths.filter(p => !readPaths.includes(p));
    if (others.length) host.open(others);
    if (readPaths.length) {
      const files: PickedFile[] = [];
      for (const p of readPaths) {
        try {
          files.push({ name: basename(p), path: p, bytes: await readFile(p) });
        } catch (e) {
          toast(String(e), "error");
        }
      }
      if (files.length) await addReads(files);
    }
  }

  async function confirmClose(): Promise<boolean> {
    inspector.flush();
    if (!isDirty()) return true;
    const choice = await choose(
      `Save changes to “${path ? basename(path) : store.data.name}”?`,
      "Your changes will be lost if you don't save them.",
      [
        { label: "Don't Save", value: "discard" as const, danger: true },
        { label: "Cancel", value: "cancel" as const },
        { label: "Save…", value: "save" as const, primary: true }
      ],
      "cancel" as const
    );
    if (choice === "discard") return true;
    if (choice === "cancel") return false;
    return save(false);
  }

  // Inactive tabs are out of the page, which forgets scroll positions: keep them.
  let scrolls: [Element, number, number][] = [];
  function setActive(on: boolean) {
    if (on) {
      layout();
      for (const [el, top, left] of scrolls) {
        el.scrollTop = top;
        el.scrollLeft = left;
      }
      scrolls = [];
    } else {
      // Its Undo would act on a file that isn't showing.
      closeEditNote();
      scrolls = Array.from(app.querySelectorAll("*"))
        .filter(el => el.scrollTop || el.scrollLeft)
        .map(el => [el, el.scrollTop, el.scrollLeft]);
      mapView.setVisible(false);
      seqView.setVisible(false);
      primersView.setVisible(false);
      readsView.setVisible(false);
    }
  }

  // Start on the map, or on the sequence for linear and very long sequences.
  tab = store.data.circular || !store.data.sequence.length ? "map" : "sequence";

  const startReads = check ?? (path && !made ? rememberedReads(path) : null);
  if (startReads) void restoreReads(startReads, !!check);
  showOffer();

  return {
    el: app,
    get path() {
      return path;
    },
    get title() {
      return title;
    },
    isDirty,
    setActive,
    command,
    menu: fromMenu,
    keydown,
    drop,
    confirmClose,
    sequence: () => ({ title, data: store.data, selection: store.selection.range }),
    feedbackContext: () => ({
      view: TABS.find(t => t.id === tab)?.label ?? "Map",
      file: { name: `${stripExtension(title) || "Untitled"}.gb`, contents: () => serialize(fileJson(), "genbank") }
    }),
    openCheck: async (c: ReadCheck) => {
      hideReadsOffer();
      waiting = [];
      reads.clear();
      await restoreReads(c, true);
    },
    dispose: () => {
      closeEditNote();
      offSettings();
      offEnzymeLibrary();
      offPersonalEnzymes();
      inspector.dispose();
      outline.dispose();
      readsView.dispose();
    },
    testHook
  };
}

/** A tab for a file that couldn't be read. */
function errorTab(path: string, e: unknown): DocTab {
  const el = h(
    "div",
    { class: "sv-app ps-load-error" },
    icon("warn"),
    h("h2", null, `Couldn't open ${basename(path)}`),
    h("pre", null, e instanceof Error ? e.message : String(e)),
    h("p", { class: "ps-muted" }, "Supported: SnapGene .dna, GenBank (.gb/.gbk), FASTA, SBOL, GFF, Geneious, TeselaGen JSON and .ab1 traces."),
    h("p", { class: "ps-muted" }, "If this is a valid file, please report it so the parser can be fixed.")
  );
  return {
    el,
    path,
    title: basename(path),
    isDirty: () => false,
    setActive: () => undefined,
    command: () => false,
    menu: () => undefined,
    keydown: () => undefined,
    drop: async () => undefined,
    confirmClose: async () => true,
    dispose: () => undefined,
    testHook: {}
  };
}

function formatName(path: string): string {
  const ext = extension(path);
  if (ext === "dna") return "SnapGene";
  if (["gb", "gbk", "gbff", "genbank", "ape"].includes(ext)) return "GenBank";
  if (["fa", "fasta", "fas", "fna", "ffn"].includes(ext)) return "FASTA";
  return ext.toUpperCase() || "file";
}

function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; ; i++) if (!taken.includes(`${name} ${i}`)) return `${name} ${i}`;
}
