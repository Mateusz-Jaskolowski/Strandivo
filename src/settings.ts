// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// App settings, shared by all windows (stored in this app's local storage) and edited in
// the Settings window. Windows are told about changes so they apply immediately.

import { isDesktop } from "./platform.ts";
import { DEFAULT_TM, type TmSettings } from "./lib/primers.ts";
import { DEFAULT_SIDEBAR_ORDER, foldedSections, sidebarOrder, type SidebarSection } from "./lib/sidebar.ts";

export type SequenceCase = "noPreference" | "uppercase" | "lowercase";

export interface FieldDef {
  name: string;
  kind: "text" | "long" | "choice" | "date";
  options?: string[];
  placeholder?: string;
}

export interface Settings {
  /** Differences below this Phred quality are shown as uncertain. */
  minQuality: number;
  /** Mott trimming error cutoff; 0 = no trimming. */
  trimCutoff: number;
  /** Map label size (8 = 100%). */
  labelSize: number;
  sequenceCase: SequenceCase;
  /** What a newly opened file shows. */
  show: {
    features: boolean;
    primers: boolean;
    cutsites: boolean;
    /** Position marks and numbers on the map. */
    ruler: boolean;
    cdsFeatureTranslations: boolean;
    orfs: boolean;
  };
  /** Which open reading frames are shown. */
  orfs: { minCodons: number; alternativeStarts: boolean };
  /** Lab fields offered on every plasmid's Info tab, in order. */
  labFields: string[];
  /** How every Tm in the app is worked out. */
  tm: TmSettings;
  /** Read TAG as Q, for amber suppressor strains (phage display in TG1, XL1-Blue). */
  amberAsQ: boolean;
  /** Offer to look for known parts when a sparsely annotated file opens. */
  offerDetection: boolean;
  /** The sidebar left of a file: its sections in order, and those folded to their heading. */
  sidebar: { order: SidebarSection[]; folded: SidebarSection[] };
  /** Ask updates.strandivo.com for a new version once a day (src/updates.ts). */
  checkForUpdates: boolean;
  /** Send anonymous usage statistics (src/usage.ts). Off until the user turns it on. */
  shareUsage: boolean;
  /** The version of the welcome window last seen; 0 = never (src/lib/welcome.ts). */
  welcomeSeen: number;
}

export const DEFAULT_LAB_FIELDS = [
  "Sequence verified",
  "Verified on",
  "Verified with",
  "Stored at",
  "Antibiotic resistance",
  "Host / strain",
  "Backbone",
  "Insert",
  "Codon optimized for",
  "Source",
  "Notes"
];

/** How the built-in fields are edited; any other field is a one-line text box. */
export const KNOWN_FIELDS: Record<string, Omit<FieldDef, "name">> = {
  "Sequence verified": { kind: "choice", options: ["", "Yes", "Partially", "No", "Differences found"] },
  "Verified on": { kind: "date" },
  "Verified with": { kind: "text", placeholder: "e.g. reads or sequencing order" },
  "Stored at": { kind: "text", placeholder: "e.g. −80 °C freezer, box 3, A4" },
  "Antibiotic resistance": { kind: "text", placeholder: "e.g. Ampicillin" },
  "Host / strain": { kind: "text", placeholder: "e.g. DH5α, BL21(DE3)" },
  Backbone: { kind: "text", placeholder: "e.g. pUC19, pET-28a(+)" },
  Insert: { kind: "text", placeholder: "e.g. GFP" },
  "Codon optimized for": {
    kind: "text",
    options: ["E. coli", "S. cerevisiae", "P. pastoris", "H. sapiens", "M. musculus", "CHO cells", "D. melanogaster", "A. thaliana", "N. benthamiana"]
  },
  Source: { kind: "text", placeholder: "e.g. Addgene #12345, made by …" },
  Notes: { kind: "long" }
};

export function fieldDef(name: string): FieldDef {
  return { name, ...(KNOWN_FIELDS[name] || { kind: "text" }) };
}

export const DEFAULT_SETTINGS: Settings = {
  minQuality: 20,
  trimCutoff: 0.05,
  labelSize: 8,
  sequenceCase: "uppercase",
  show: { features: true, primers: true, cutsites: true, ruler: true, cdsFeatureTranslations: true, orfs: false },
  orfs: { minCodons: 75, alternativeStarts: false },
  labFields: DEFAULT_LAB_FIELDS,
  tm: DEFAULT_TM,
  amberAsQ: false,
  offerDetection: true,
  sidebar: { order: DEFAULT_SIDEBAR_ORDER, folded: [] },
  checkForUpdates: true,
  shareUsage: false,
  welcomeSeen: 0
};

const KEY = "strandivo.settings";
const EVENT = "settings-changed";

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      show: { ...DEFAULT_SETTINGS.show, ...(raw.show || {}) },
      tm: { ...DEFAULT_TM, ...(raw.tm || {}) },
      orfs: { ...DEFAULT_SETTINGS.orfs, ...(raw.orfs || {}) },
      labFields: Array.isArray(raw.labFields) && raw.labFields.length ? raw.labFields : DEFAULT_LAB_FIELDS,
      sidebar: { order: sidebarOrder(raw.sidebar?.order), folded: foldedSections(raw.sidebar?.folded) }
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
  if (isDesktop) {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(EVENT, s);
  } else {
    // In a browser, Settings can be shown in the same page, which the storage event skips.
    tell();
  }
}

const listeners = new Set<(s: Settings) => void>();
let listening = false;

function tell() {
  const s = loadSettings();
  for (const l of [...listeners]) l(s);
}

/** Calls `fn` whenever settings change in any window; returns a function that stops it. */
export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  if (!listening) {
    listening = true;
    // In listening order, so start-up listeners (src/main.ts) run before the views redraw.
    window.addEventListener("storage", e => {
      if (e.key === KEY) tell();
    });
    if (isDesktop) void import("@tauri-apps/api/event").then(({ listen }) => listen(EVENT, tell));
  }
  return () => listeners.delete(fn);
}
