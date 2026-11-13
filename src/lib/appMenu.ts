// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The browser version's menu (src/views/appMenu.ts): the native menu's items, ids and
// labels (src-tauri/src/lib.rs), in its groups. The shell can't read TypeScript, so it keeps
// its own list; a unit test compares the two.

export interface AppMenuItem {
  /** The native menu item's id: what it runs. */
  id: string;
  label: string;
  /** Needs an open file: greyed out on Home. */
  file?: boolean;
}

export interface AppMenuGroup {
  label: string;
  items: (AppMenuItem | "separator")[];
}

export const APP_MENU: AppMenuGroup[] = [
  {
    label: "File",
    items: [
      { id: "new", label: "New Sequence" },
      { id: "open", label: "Open…" },
      "separator",
      { id: "save", label: "Save", file: true },
      { id: "save-as", label: "Save As…", file: true },
      { id: "export-genbank", label: "Export GenBank…", file: true },
      { id: "export-fasta", label: "Export FASTA…", file: true },
      "separator",
      { id: "close", label: "Close Tab", file: true },
      "separator",
      { id: "settings", label: "Settings…" }
    ]
  },
  {
    label: "Edit",
    items: [
      { id: "undo", label: "Undo", file: true },
      { id: "redo", label: "Redo", file: true },
      "separator",
      { id: "select-all", label: "Select All", file: true },
      { id: "invert-selection", label: "Invert Selection", file: true },
      "separator",
      { id: "find", label: "Find…" },
      "separator",
      { id: "reverse-complement", label: "Reverse Complement", file: true },
      { id: "set-origin", label: "Set Origin at Cursor", file: true }
    ]
  },
  {
    label: "View",
    items: [
      { id: "show-map", label: "Map", file: true },
      { id: "show-sequence", label: "Sequence", file: true },
      { id: "show-primers", label: "Primers", file: true },
      { id: "show-reads", label: "Sequencing Reads", file: true },
      { id: "show-info", label: "Plasmid Info", file: true },
      "separator",
      { id: "split-view", label: "Map and Sequence Side by Side", file: true },
      { id: "toggle-sidebar", label: "Show or Hide Sidebar", file: true },
      { id: "toggle-inspector", label: "Show or Hide Inspector", file: true }
    ]
  },
  {
    label: "Tools",
    items: [
      { id: "add-feature", label: "Add Feature from Selection", file: true },
      { id: "add-primer", label: "Add Primer from Selection", file: true },
      { id: "detect-features", label: "Detect Features…", file: true },
      "separator",
      { id: "digest", label: "Digest…", file: true },
      { id: "simulate-cloning", label: "Simulate Cloning…", file: true },
      { id: "add-reads", label: "Align Sequencing Reads…", file: true }
    ]
  },
  {
    label: "Window",
    items: [
      { id: "home", label: "Home: Constructs" },
      { id: "library", label: "Primer Library" },
      { id: "enzyme-library", label: "Enzyme Library" }
    ]
  },
  {
    label: "Help",
    items: [
      { id: "feedback", label: "Send Feedback…" },
      { id: "report-bug", label: "Report a Bug…" },
      "separator",
      { id: "welcome", label: "Welcome to Strandivo…" },
      "separator",
      { id: "website", label: "Strandivo Website" },
      { id: "github", label: "Strandivo on GitHub" }
    ]
  }
];

/** Native items the browser version leaves out: there is nothing to update or quit there. */
export const DESKTOP_ONLY_ITEMS = ["check-updates", "quit"];
