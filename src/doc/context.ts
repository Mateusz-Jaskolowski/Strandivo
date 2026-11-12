// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What the views of one document window share: the store, display options, and a few
// window-level actions (switching tabs, read coverage from the Sanger view).

import type { MenuTarget } from "../lib/contextMenu.ts";
import type { EnzymeOptions } from "../lib/enzymes.ts";
import type { OrfOptions } from "../lib/orfs.ts";
import type { Range, SeqData } from "../lib/seqdata.ts";
import type { DocStore } from "./store.ts";
import type { ProteinDetail } from "../lib/regions.ts";

export type Tab = "map" | "sequence" | "primers" | "reads" | "info";

export interface ViewOptions extends EnzymeOptions {
  features: boolean;
  /** Map visibility is separate from the remembered top-level/all detail choice. */
  mapRegions: boolean;
  proteinDetail: ProteinDetail;
  /** Labelled protein-region tracks in Sequence and the selected primer's context. */
  sequenceRegions: boolean;
  /** GC content under the bases in Sequence (and along its overview strip), and in the primer's context. */
  sequenceGc: boolean;
  primerGc: boolean;
  primers: boolean;
  cutsites: boolean;
  /** Position marks and numbers on the map. */
  ruler: boolean;
  translations: boolean;
  /** Amino acids in translations coloured by their chemistry (Clustal X colours). */
  aaColors: boolean;
  complement: boolean;
  /** Open reading frames on the map and sequence, and which ones (from Settings). */
  orfs: boolean;
  orfOptions: OrfOptions;
  mapRotation: number;
  /** 1…8, how much larger than fitting the window the map is drawn. */
  mapZoom: number;
  /** 3…16; 8 = normal. */
  labelSize: number;
  linearMap: boolean;
  /** How bases are shown (the file's own case is kept). */
  caseMode: "noPreference" | "uppercase" | "lowercase";
}

export interface Coverage {
  covered: number;
  total: number;
  reads: string[];
  differences: number;
}

export interface DocContext {
  store: DocStore;
  options: ViewOptions;
  setOptions(patch: Partial<ViewOptions>): void;
  onOptions(fn: (o: ViewOptions) => void): () => void;
  showTab(tab: Tab): void;
  readonly tab: Tab;
  /** How much of a range the aligned sequencing reads cover, if any reads are loaded. */
  coverage(range: Range): Coverage | null;
  /** Adds a feature covering the current selection and lets the user name it (an ORF passes its own type and strand). */
  addFeatureFromSelection(as?: { name: string; type: string; strand: 1 | -1 }): void;
  addPrimerFromSelection(): void;
  /** Runs a window command (the same ids as the native menu items). */
  command(id: string): void;
  /** Shows the right-click menu for what was clicked (already selected); `onMap` when on the map. */
  contextMenu(target: MenuTarget, at: { x: number; y: number }, onMap?: boolean): void;
  /** Opens a sequence made here (a cloning product) in a new tab, unsaved. */
  openNew(data: SeqData): void;
  /** The other open files' sequences and selections. */
  otherSequences(): { title: string; data: SeqData; selection: Range | null }[];
  /**
   * Says what an edit just made did, such as deleting a feature, with an Undo button for as
   * long as it is the last edit and the file's tab is showing.
   */
  noteEdit(message: string): void;
}

export function optionsStore(initial: ViewOptions, persist: (o: ViewOptions) => void) {
  let options = initial;
  const listeners = new Set<(o: ViewOptions) => void>();
  return {
    get: () => options,
    set(patch: Partial<ViewOptions>) {
      options = { ...options, ...patch };
      persist(options);
      for (const fn of listeners) fn(options);
    },
    on(fn: (o: ViewOptions) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
