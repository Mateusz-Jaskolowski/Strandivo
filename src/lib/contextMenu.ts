// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What the right-click menus offer, as data. The views work out what was clicked (and
// select it first), the document runs the chosen action. No DOM here, so the lists are
// unit-tested.

import { alignPrimer } from "./primerAlign.ts";
import { rangeLength, type Range, type SeqData } from "./seqdata.ts";
import { proteinRegionTargets, regionsOf } from "./regions.ts";
import { enzymeOf, enzymesText } from "./enzymePick.ts";

/**
 * What "Digest" on a cut site digests with: the picked enzymes when the site is one of
 * theirs, else the site's own enzyme.
 */
export function digestEnzymes(siteId: string, picked: string[] = []): string[] {
  const enzyme = enzymeOf(siteId);
  return picked.includes(enzyme) ? picked : [enzyme];
}

/** What a menu is for: an annotation, the selected bases, or the cursor between bases. */
export type MenuTarget =
  | { kind: "feature" | "primer" | "cutsite" | "orf"; id: string; region?: number }
  | { kind: "selection"; range: Range }
  | { kind: "selections"; ranges: Range[] }
  | { kind: "cursor"; at: number };

export type MenuAction =
  // Selected bases.
  | "copy"
  | "copy-revcomp"
  | "add-forward-primer"
  | "add-reverse-primer"
  | "design-primers"
  | "mutagenesis"
  | "add-feature"
  | "add-protein-region"
  | "edit-protein-region"
  | "remove-protein-region"
  | "reverse-complement"
  | "delete-bases"
  | "invert-selection"
  // Features, primers and cut sites.
  | "copy-dna"
  | "copy-protein"
  | "copy-primer"
  | "copy-for-ordering"
  | "copy-site"
  | "digest"
  | "add-personal-enzyme"
  | "remove-personal-enzyme"
  | "add-orf-feature"
  | "show-other"
  | "show-in-primers"
  | "show-on-map"
  | "show-in-sequence"
  | "pcr-product"
  | "save-to-library"
  | "flip-primer"
  | "rename"
  | "set-colour"
  | "pick-colour"
  | "default-colour"
  | "delete-feature"
  | "delete-primer"
  // The cursor.
  | "select-all"
  | "set-origin"
  | "reverse-complement-all";

export interface MenuItem {
  action: MenuAction;
  label: string;
  enabled?: boolean;
  /** The colour a "set-colour" item gives, shown as a swatch. */
  color?: string;
}
export interface MenuSubmenu {
  label: string;
  items: MenuEntry[];
}
export type MenuEntry = MenuItem | MenuSubmenu | "separator";

/** Colours offered for features, from the ones the app gives them. */
export const FEATURE_COLOURS: { name: string; hex: string }[] = [
  { name: "Red", hex: "#D9534F" },
  { name: "Coral", hex: "#E58063" },
  { name: "Orange", hex: "#E8A83E" },
  { name: "Yellow", hex: "#F2C14E" },
  { name: "Green", hex: "#8CC46B" },
  { name: "Teal", hex: "#6CC2B0" },
  { name: "Blue", hex: "#6FAEE0" },
  { name: "Purple", hex: "#B39DDB" },
  { name: "Pink", hex: "#D98BC5" },
  { name: "Grey", hex: "#A3A9B4" }
];

/** Colours offered for primers: red is left out, as it marks a primer's changes. */
export const PRIMER_COLOURS = FEATURE_COLOURS.filter(c => c.name !== "Red");

/** Primers are made from 10–80 selected bases, as with the toolbar's Add primer. */
export const PRIMER_BASES = { min: 10, max: 80 };

export interface MenuContext {
  data: SeqData;
  /** The menu was opened on the map: "Show in sequence" rather than "Show on map". */
  onMap: boolean;
  /** The tab the menu was opened in; primers offer the other places they show. */
  tab?: "map" | "sequence" | "primers" | "reads" | "info";
  /** Whether a primer with these bases is in the lab library. */
  inLibrary(bases: string): boolean;
  /** Enzymes picked with ⌘/Ctrl-click; a site of one of them digests with them all. */
  enzymes?: string[];
  personalEnzymes?: readonly string[];
}

const item = (action: MenuAction, label: string, enabled = true): MenuItem => (enabled ? { action, label } : { action, label, enabled });
/** The entries, only when `cond` holds. */
const when = <T>(cond: boolean, ...entries: T[]): T[] => (cond ? entries : []);

export function menuFor(target: MenuTarget, c: MenuContext): MenuEntry[] {
  const d = c.data;
  const n = d.sequence.length;
  const show = item("show-other", c.onMap ? "Show in sequence" : "Show on map");
  switch (target.kind) {
    case "selections":
      return [item("copy", "Copy"), item("copy-revcomp", "Copy reverse complement"), "separator", item("invert-selection", "Invert selection"), "separator", item("delete-bases", "Delete bases")];
    case "selection": {
      const len = rangeLength(target.range, n);
      return tidy([
        item("copy", "Copy"),
        item("copy-revcomp", "Copy reverse complement"),
        "separator",
        item("invert-selection", "Invert selection"),
        "separator",
        ...when(len >= PRIMER_BASES.min && len <= PRIMER_BASES.max, item("add-forward-primer", "Add forward primer"), item("add-reverse-primer", "Add reverse primer")),
        ...when(len > PRIMER_BASES.max, item("design-primers", "Design primers to amplify…")),
        item("mutagenesis", "Mutagenesis primers…"),
        item("add-feature", "Add feature"),
        ...when(proteinRegionTargets(d, target.range).length > 0, item("add-protein-region", "Add as region…")),
        "separator",
        // Reverse-complementing a stretch across the origin isn't supported.
        ...when(target.range.start <= target.range.end, item("reverse-complement", "Reverse-complement selection")),
        "separator",
        item("delete-bases", "Delete bases")
      ]);
    }
    case "feature": {
      const f = d.features.find(x => x.id === target.id);
      if (!f) return [];
      if (target.region !== undefined) {
        if (!regionsOf(f)[target.region]) return [];
        return [item("copy-dna", "Copy DNA"), item("copy-protein", "Copy protein"), "separator", item("edit-protein-region", "Edit region…"), show, "separator", item("remove-protein-region", "Remove region")];
      }
      return tidy([
        item("copy-dna", "Copy DNA"),
        ...when(f.type.toUpperCase() === "CDS", item("copy-protein", "Copy protein")),
        "separator",
        item("design-primers", "Design primers to amplify…"),
        ...when(f.type.toUpperCase() === "CDS", item("mutagenesis", "Mutagenesis primers…")),
        ...when(f.type.toUpperCase() === "CDS", item("add-protein-region", "Add protein region…")),
        "separator",
        show,
        item("rename", "Rename…"),
        {
          label: "Colour",
          items: [
            ...FEATURE_COLOURS.map(c => ({ action: "set-colour" as const, label: c.name, color: c.hex })),
            "separator",
            item("pick-colour", "Other colour…"),
            item("default-colour", "Default colour", !!f.color)
          ]
        },
        "separator",
        item("delete-feature", "Delete feature")
      ]);
    }
    case "primer": {
      const p = d.primers.find(x => x.id === target.id);
      if (!p) return [];
      const tail = alignPrimer(p, d.sequence).tail.length > 0;
      const saved = c.inLibrary(p.bases.toUpperCase());
      const tab = c.tab ?? (c.onMap ? "map" : "sequence");
      return tidy([
        item("copy-primer", "Copy sequence"),
        item("copy-for-ordering", "Copy for ordering"),
        "separator",
        ...when(tab !== "map", item("show-on-map", "Show on map")),
        ...when(tab !== "sequence", item("show-in-sequence", "Show in sequence")),
        ...when(tab !== "primers", item("show-in-primers", "Show in Primers tab")),
        item("pcr-product", "PCR product…"),
        saved ? item("save-to-library", "In the lab library", false) : item("save-to-library", "Save to library"),
        "separator",
        // A tail is made for one strand: only a primer without one can change strand.
        ...when(!tail, item("flip-primer", p.strand === 1 ? "Make it a reverse primer" : "Make it a forward primer")),
        item("rename", "Rename…"),
        {
          label: "Colour",
          items: [...PRIMER_COLOURS.map(c => ({ action: "set-colour" as const, label: c.name, color: c.hex })), "separator", item("default-colour", "Default colour", !!p.color)]
        },
        "separator",
        item("delete-primer", "Delete primer")
      ]);
    }
    case "cutsite": {
      const saved = c.personalEnzymes?.includes(enzymeOf(target.id));
      return [item("copy-site", "Copy recognition site"), item("digest", `Digest with ${enzymesText(digestEnzymes(target.id, c.enzymes))}…`), show,
        saved ? item("remove-personal-enzyme", "Remove from My enzymes") : item("add-personal-enzyme", "Add to My enzymes")];
    }
    case "orf":
      return tidy([item("copy-dna", "Copy DNA"), item("copy-protein", "Copy protein"), "separator", item("add-orf-feature", "Add as feature"), show]);
    case "cursor":
      return tidy([
        item("select-all", "Select all"),
        "separator",
        ...when(d.circular && target.at > 0 && target.at < n, item("set-origin", "Set origin here")),
        item("reverse-complement-all", "Reverse-complement sequence")
      ]);
  }
}

/** What a menu in the Reads tab is for; the view works this out and runs the action. */
export type ReadsTarget =
  | { kind: "read"; inClone: boolean; /** Clones it can move to. */ clones: { key: string; label: string }[] }
  | { kind: "clone"; aligned: boolean }
  | { kind: "many"; reads: number };

export type ReadsAction = "copy-read" | "move-read" | "take-out" | "remove" | "copy-consensus" | "open-clone" | "split-clone" | "group";

export interface ReadsMenuItem {
  action: ReadsAction;
  label: string;
  enabled?: boolean;
  /** The clone a "move-read" item moves to. */
  clone?: string;
}
export type ReadsMenuEntry = ReadsMenuItem | { label: string; items: ReadsMenuEntry[] } | "separator";

export function readsMenu(target: ReadsTarget): ReadsMenuEntry[] {
  switch (target.kind) {
    case "read":
      return tidy<ReadsMenuEntry>([
        { action: "copy-read", label: "Copy sequence" },
        "separator",
        ...when<ReadsMenuEntry>(target.clones.length > 0, { label: "Move to clone", items: target.clones.map(c => ({ action: "move-read", label: c.label, clone: c.key })) }),
        ...when<ReadsMenuEntry>(target.inClone, { action: "take-out", label: "Take out of clone" }),
        "separator",
        { action: "remove", label: "Remove read" }
      ]);
    case "clone":
      return tidy<ReadsMenuEntry>([
        { action: "copy-consensus", label: "Copy consensus", enabled: target.aligned },
        { action: "open-clone", label: "Open clone as file", enabled: target.aligned },
        "separator",
        { action: "split-clone", label: "Split into single reads" },
        "separator",
        { action: "remove", label: "Remove clone" }
      ]);
    case "many":
      return [{ action: "group", label: "Group into one clone" }, "separator", { action: "remove", label: `Remove ${target.reads} reads` }];
  }
}

/** Drops separators at either end and doubled ones. */
function tidy<T>(entries: (T | "separator")[]): (T | "separator")[] {
  const out: (T | "separator")[] = [];
  for (const e of entries) if (e !== "separator" || (out.length && out[out.length - 1] !== "separator")) out.push(e);
  while (out[out.length - 1] === "separator") out.pop();
  return out;
}
