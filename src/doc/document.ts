// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A document: one sequence file in a tab of the main window, shown as Map, Sequence,
// Primers, Reads and Info views around a shared selection, with an outline on the left
// and an inspector on the right. The main window (src/mainWindow.ts) owns the window
// itself and hands each document its keys, menu commands and dropped files.

import "./document.css";

import { h, icon, toast } from "../ui/dom.ts";
import { iconSvg, type IconName } from "../ui/icons.ts";
import { choose } from "../ui/modal.ts";
import {
  alertDialog,
  canDetectFeatures,
  chooseSavePath,
  confirmDialog,
  isDesktop,
  openSettings,
  pickFiles,
  readFile,
  saveText,
  type PickedFile
} from "../platform.ts";
import { addRecentFile } from "../recent.ts";
import { basename, dirname, extension, formatForPath, isTraceFile, joinPath, stripExtension, suggestedSaveName, TEXT_READ_EXTENSIONS, type SaveFormat } from "../lib/files.ts";
import { CHECK_EXTENSION, checkFileText, type ReadCheck } from "../lib/readCheck.ts";
import { rememberedReads, rememberReads } from "../readChecks.ts";
import { formatComments, parseComments, type LabFields } from "../lib/labinfo.ts";
import { basesIn, newId, rangeLength, reverseComplement, reverseComplementRange, setOrigin, type Range, type SeqData, type SeqPrimer } from "../lib/seqdata.ts";
import { PRIMER_BASES } from "../lib/contextMenu.ts";
import { gcPercent } from "../lib/labinfo.ts";
import type { EnzymeSet } from "../lib/enzymes.ts";
import { ALTERNATIVE_STARTS, type OrfOptions } from "../lib/orfs.ts";
import type { Feature } from "../lib/types.ts";
import { describeDifference } from "../lib/genetics.ts";
import { selectionTmText } from "../lib/primers.ts";
import { designOf } from "../lib/variable.ts";
import { loadSettings, onSettingsChanged, saveSettings, type Settings } from "../settings.ts";
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
import { regionsOf } from "../lib/regions.ts";
import { dismissOffer, offerDismissed } from "../detectOffer.ts";
import { looksUnannotated } from "../lib/detect.ts";
import { openDigestDialog } from "../views/digestDialog.ts";
import { Search } from "../views/search.ts";
import { ReadsView } from "../views/readsView.ts";
import { fmt } from "../ui/format.ts";

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
  let saved: Partial<ViewOptions> = {};
  try {
    saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
  } catch {
    /* ignore */
  }
  return {
    features: settings.show.features,
    primers: settings.show.primers,
    cutsites: settings.show.cutsites,
    ruler: settings.show.ruler,
    translations: settings.show.cdsFeatureTranslations,
    orfs: settings.show.orfs,
    aaColors: false,
    complement: true,
    enzymeSet: "unique6" as EnzymeSet,
    mapRotation: 0,
    mapZoom: 1,
    labelSize: settings.labelSize,
    linearMap: false,
    ...saved,
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
  const opts = optionsStore(loadViewOptions(settings), o => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ enzymeSet: o.enzymeSet, complement: o.complement, translations: o.translations, orfs: o.orfs, aaColors: o.aaColors, mapZoom: 1, linearMap: o.linearMap }));
    } catch {
      /* ignore */
    }
  });
  let tab: Tab = "map";
  let split = false;
  let sidebarOpen = true;
  let inspectorOpen = true;
  // Sequencing reads align against the current sequence; edits make the results stale.
  const legacyFeatures = (d: SeqData): Feature[] =>
    d.features.map(f => ({ id: f.id, name: f.name, type: f.type, start: f.start, end: f.end, forward: f.strand !== -1, strand: f.strand === -1 ? -1 : 1, locations: f.locations, variable: designOf(f.notes) ?? undefined }));
  let dataVersion = 0;
  store.subscribe(c => c.data && dataVersion++);
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
      opts.set(patch);
      if (patch.labelSize !== undefined) void saveSettings({ ...loadSettings(), labelSize: patch.labelSize });
    },
    onOptions: fn => opts.on(fn),
    showTab: t => setTab(t),
    get tab() {
      return tab;
    },
    coverage: (r: Range) => reads.coverage(r.start, r.end),
    addFeatureFromSelection: as => addFeature(as),
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
    otherSequences: () => host.sequences()
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
    saveCheck: () => void saveCheck()
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
      { type: "button", role: "tab", class: "sv-tab", "data-tab": t.id, title: `${t.label} (${isMac ? "⌘" : "Ctrl+"}${t.key})`, onclick: () => setTab(t.id) },
      t.label,
      badge
    );
  });
  const toolButton = (iconName: IconName, label: string, onclick: () => void, extra: Record<string, unknown> = {}) =>
    h("button", { type: "button", class: "sv-icon-btn", "aria-label": label, title: label, onclick, ...extra }, iconSvg(iconName, 18));
  const splitButton = toolButton("split", "Split view: map and sequence side by side", () => setSplit(!split), { "aria-pressed": "false" });
  const sidebarButton = toolButton("sidebar", "Show sidebar: features, primers and enzymes", () => setSidebar(!sidebarOpen), { "aria-pressed": "true" });
  const inspectorButton = toolButton("inspector", "Show inspector", () => setInspector(!inspectorOpen), { "aria-pressed": "true" });
  const undoButton = toolButton("undo", "Undo", () => store.undo());
  const redoButton = toolButton("redo", "Redo", () => store.redo());
  const header = h(
    "header",
    { class: "sv-toolbar" },
    h("div", { class: "sv-doc-title" }, nameEl, metaEl),
    h("nav", { class: "sv-tabs", role: "tablist", "aria-label": "Views" }, tabButtons),
    h(
      "div",
      { class: "sv-tools" },
      search.el,
      h("span", { class: "sv-tool-sep", "aria-hidden": "true" }),
      undoButton,
      redoButton,
      toolButton("featureAdd", "Add feature for the selection", () => addFeature()),
      toolButton("detect", "Detect features: find common parts to add", () => openDetectDialog(ctx)),
      toolButton("primerAdd", "Add primer for the selection", () => addPrimer()),
      toolButton("gel", "Digest…", () => openDigestDialog(ctx)),
      toolButton("clone", "Simulate cloning…", () => openCloningDialog(ctx)),
      toolButton("export", "Export GenBank or FASTA", () => void exportMenu()),
      h("span", { class: "sv-tool-sep", "aria-hidden": "true" }),
      splitButton,
      sidebarButton,
      inspectorButton
    )
  );

  // ---------- status bar ----------
  const statusLeft = h("div", { class: "sv-status-left" });
  const statusRight = h("div", { class: "sv-status-right" });
  const status = h("footer", { class: "sv-status" }, statusLeft, statusRight);

  // A quiet strip, never a dialog: the file is only sparsely annotated, which is a
  // suggestion worth making once and not an interruption worth making every time.
  const offer = h("div", { class: "sv-offer", hidden: true });
  const body = h("div", { class: "sv-body" }, outline.el, main, inspector.el);
  const app = h("div", { class: "sv-app" }, header, offer, body, status);

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
  reads.onChange(() => {
    if (!path || reads.running) return;
    const saved = reads.saved();
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
  });

  let infoDirty = false;
  const infoPanel = new InfoPanel(infoHost, labFields, {
    facts: () => {
      const d = store.data;
      return { name: d.name, description: d.description, sequence: d.sequence, circular: d.circular, features: legacyFeatures(d), primerCount: d.primers.length };
    },
    rename: name => store.apply({ ...store.data, name }, "Rename"),
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
    splitButton.setAttribute("aria-pressed", String(split));
    splitButton.classList.toggle("sv-on", split);
    sidebarButton.setAttribute("aria-pressed", String(sidebarOpen));
    sidebarButton.classList.toggle("sv-on", sidebarOpen);
    inspectorButton.setAttribute("aria-pressed", String(inspectorOpen));
    inspectorButton.classList.toggle("sv-on", inspectorOpen);
    mapView.setVisible(!panes.map.hidden);
    seqView.setVisible(!panes.sequence.hidden);
    primersView.setVisible(!panes.primers.hidden);
    readsView.setVisible(tab === "reads");
    if (tab === "info") infoPanel.render();
  }

  function setTab(t: Tab) {
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
  function setSidebar(on: boolean) {
    sidebarOpen = on;
    layout();
  }
  function setInspector(on: boolean) {
    inspectorOpen = on;
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
    if (range) {
      let label = "Selection";
      if (focus?.kind === "feature") {
        const f = d.features.find(x => x.id === focus.id);
        const region = f && focus.region !== undefined ? regionsOf(f)[focus.region] : undefined;
        label = `${region?.name ?? f?.name ?? "Feature"} selected`;
      }
      else if (focus?.kind === "primer") label = `${d.primers.find(p => p.id === focus.id)?.name ?? "Primer"} selected`;
      else if (focus?.kind === "cutsite") label = "Cut site selected";
      else if (focus?.kind === "orf") label = "ORF selected";
      const len = rangeLength(range, n);
      const bases = basesIn(d.sequence, range);
      const tm = selectionTmText(bases);
      left.push(
        h("span", { class: "sv-status-strong" }, label),
        h("span", { class: "sv-mono" }, `${fmt(range.start + 1)}..${fmt(range.end + 1)}`),
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
  function addFeature(as: { name: string; type: string; strand: 1 | -1 } = { name: "New feature", type: "misc_feature", strand: 1 }) {
    const { range } = store.selection;
    if (!range) {
      toast("Select the bases for the new feature first (drag across the map or the sequence).", "info", 4000);
      return;
    }
    const id = newId("f");
    const d = store.data;
    store.apply(
      { ...d, features: [...d.features, { id, ...as, start: range.start, end: range.end, notes: {}, raw: {} }] },
      "Add feature",
      { range, focus: { kind: "feature", id } }
    );
    focusInspectorName();
  }

  /** A primer from the selected bases: on the top strand, or the bottom one (`strand` -1). */
  function addPrimer(strand: 1 | -1 = 1) {
    const { range } = store.selection;
    const d = store.data;
    const len = range ? rangeLength(range, d.sequence.length) : 0;
    if (!range || len < PRIMER_BASES.min || len > PRIMER_BASES.max) {
      toast(`Select ${PRIMER_BASES.min}–${PRIMER_BASES.max} bases to make a primer from (it reads along the top strand; flip it in the inspector).`, "info", 4500);
      return;
    }
    const id = newId("p");
    const name = uniqueName(`Primer ${d.primers.length + 1}`, d.primers.map(p => p.name));
    const top = basesIn(d.sequence, range).toUpperCase();
    const primer: SeqPrimer = { id, name, start: range.start, end: range.end, strand, bases: strand === 1 ? top : reverseComplement(top), notes: {}, raw: {} };
    store.apply({ ...d, primers: [...d.primers, primer] }, "Add primer", { range, focus: { kind: "primer", id } });
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
  function fileJson(): Record<string, unknown> {
    const json = toParsed(loaded, store.data);
    json.comments = formatComments(infoPanel.getFields(), otherComments);
    return json;
  }

  async function save(saveAs: boolean): Promise<boolean> {
    if (saving) return false;
    saving = true;
    try {
      let target = path;
      let fmtOut: SaveFormat | null = target ? formatForPath(target) : null;
      if (saveAs || !target || !fmtOut) {
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
    await saveText(target, serialize(fileJson(), fmtOut));
    store.markSaved();
    infoDirty = false;
    if (target !== path) {
      path = target;
      format = formatName(target);
      addRecentFile(target);
    }
    refreshTitle();
    toast(`Saved ${basename(target)}`, "success", 1800);
  }

  async function exportAs(fmtOut: SaveFormat) {
    const suggestion = joinPath(path ? dirname(path) : "", suggestedSaveName(path, store.data.name, fmtOut));
    const chosen = await chooseSavePath(suggestion, [fmtOut === "fasta" ? { name: "FASTA", extensions: ["fasta", "fa"] } : { name: "GenBank", extensions: ["gb", "gbk"] }]);
    if (!chosen) return;
    try {
      await saveText(chosen, serialize(fileJson(), fmtOut));
      toast(`Exported ${basename(chosen)}`, "success");
    } catch (e) {
      await alertDialog(`Couldn't export: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function exportMenu() {
    const choice = await choose("Export", "Save a copy of this sequence in another format.", [
      { label: "Cancel", value: "cancel" as const },
      { label: "FASTA…", value: "fasta" as const },
      { label: "GenBank…", value: "genbank" as const, primary: true }
    ], "cancel" as const);
    if (choice !== "cancel") await exportAs(choice);
  }

  // ---------- reads ----------
  /** Adds the reads of a check, or those remembered for this file; names any not found. */
  async function restoreReads(c: ReadCheck, fromCheckFile: boolean) {
    const files: PickedFile[] = [];
    const clones: (string | null)[] = [];
    const missing: string[] = [];
    for (const r of c.reads) {
      try {
        files.push({ name: basename(r.path), path: r.path, bytes: await readFile(r.path) });
        clones.push(r.clone);
      } catch {
        missing.push(basename(r.path));
      }
    }
    if (fromCheckFile) {
      reads.useCheckSettings(c);
      setTab("reads");
    }
    if (missing.length) {
      const which = `${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""}`;
      const where = fromCheckFile ? "in the check" : "checked against this file before";
      toast(`${missing.length === 1 ? "A read" : `${missing.length} reads`} ${where} couldn't be found (moved or deleted?): ${which}`, "error", 9000);
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
      toast("Only reads opened from files can go in a check.", "info", 5000);
      return;
    }
    const suggestion = joinPath(dirname(saved[0].path), `${stripExtension(basename(path))} reads.${CHECK_EXTENSION}`);
    const where = target ?? (await chooseSavePath(suggestion, [{ name: "Strandivo read check", extensions: [CHECK_EXTENSION] }]));
    if (!where) return;
    try {
      await saveText(where, checkFileText(where, { reference: path, reads: saved, minQuality: reads.minQuality, trimCutoff: reads.trimCutoff }));
      toast(`Saved ${basename(where)}. Open it to see these reads again, here or on another computer.`, "info", 5000);
    } catch (e) {
      toast(`Couldn't save the check: ${e instanceof Error ? e.message : e}`, "error", 8000);
    }
  }

  async function addReads(files?: PickedFile[]) {
    setTab("reads");
    const picked = files ?? (await pickFiles("Sequencing reads", READ_EXTENSIONS));
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
      case "split-view":
        setSplit(!split);
        return true;
      case "toggle-sidebar":
        setSidebar(!sidebarOpen);
        return true;
      case "toggle-inspector":
        setInspector(!inspectorOpen);
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
        const { range } = store.selection;
        if (range && range.start > range.end) {
          toast("Select a stretch that doesn't cross the origin to reverse-complement it.", "info", 4000);
          return true;
        }
        if (!store.length) return true;
        store.apply(reverseComplementRange(store.data, range), range ? "Reverse-complement selection" : "Reverse-complement sequence", range ? { range } : { range: null, caret: 0 });
        return true;
      }
      case "set-origin": {
        const c = store.selection.range ? store.selection.range.start : store.selection.caret;
        if (!store.data.circular) toast("Only a circular sequence has an origin to move.", "info");
        else if (c <= 0 || c >= store.length) toast("Put the cursor where the sequence should start.", "info");
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
  const shortcutCommand = (e: KeyboardEvent): string | null => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey) return null;
    const k = e.key.toLowerCase();
    if (k === "z") return e.shiftKey ? "redo" : "undo";
    if (k === "y") return "redo";
    if (k === "a") return "select-all";
    if (k === "f") return "find";
    const t = TABS.find(x => x.key === e.key);
    return t ? `show-${t.id}` : null;
  };
  let lastShortcut: { id: string; at: number; handled: boolean } | null = null;
  const seqField = () => document.activeElement === seqView.el.querySelector(".sv-clipboard");
  const keydown = (e: KeyboardEvent) => {
    const id = shortcutCommand(e);
    if (id && !e.defaultPrevented) {
      if (id === "undo" || id === "redo" || id === "select-all") {
        // Text fields keep their own undo and select-all; the sequence handles its keys itself.
        if (!inField() && !seqField()) {
          e.preventDefault();
          command(id);
        }
      } else {
        e.preventDefault();
        command(id);
      }
    } else if (!id && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s" && !isDesktop) {
      e.preventDefault();
      void save(e.shiftKey);
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
      reads.clear();
      await restoreReads(c, true);
    },
    dispose: () => {
      offSettings();
      inspector.dispose();
      outline.dispose();
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
