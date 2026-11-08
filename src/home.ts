// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Home, the first tab of the main window: the construct library. It lists the sequence
// files in the user's folders (and their subfolders) with what each construct carries and
// a short note, next to Open, New sequence and recent files. Opening one adds a tab.

import { h, toast } from "./ui/dom.ts";
import { iconSvg } from "./ui/icons.ts";
import { fmt } from "./ui/format.ts";
import { catalogVersion, detectFeatures, isDesktop, listSequenceFiles, pickFolder, readFile, showOpenDialog, type ListedFile } from "./platform.ts";
import { isBrowserKey } from "./webFiles.ts";
import { recentFiles } from "./recent.ts";
import { basename, dirname, stripExtension } from "./lib/files.ts";
import { describeContents, matchesSearch, subfolder, type ConstructInfo } from "./lib/constructs.ts";
import { parseComments } from "./lib/labinfo.ts";
import { cacheConstructs, cachedConstruct, constructNote, libraryFolders, setConstructNote, setLibraryFolders } from "./constructLibrary.ts";

export interface HomeHost {
  /** Opens files in tabs (null = a new sequence). */
  open(paths: (string | null)[]): void;
}

/**
 * Reads what Home shows about one file. A file that annotates nothing itself — a plain
 * FASTA, most often — has its contents worked out by detection instead, marked as such so
 * the row can say where the names came from. A file with its own features is left alone:
 * what its author wrote beats what we would guess.
 */
async function readConstruct(f: ListedFile, catalog: string): Promise<ConstructInfo> {
  const base = { path: f.path, size: f.size, modified: f.modified };
  try {
    const [{ parseSequenceFile }, { fromParsed }] = await Promise.all([import("./doc/fileio.ts"), import("./doc/convert.ts")]);
    const parsed = await parseSequenceFile(await readFile(f.path), f.path);
    const { data, extra } = fromParsed(parsed.sequences[0]);
    const info: ConstructInfo = {
      ...base,
      name: data.name,
      length: data.sequence.length,
      circular: data.circular,
      features: data.features.length,
      contents: describeContents(data.features),
      description: data.description,
      fields: Object.fromEntries(parseComments(extra.comments as string[] | undefined).fields)
    };
    if (!data.features.length && catalog && data.sequence.length) {
      try {
        const { suggestions } = await detectFeatures({ sequence: data.sequence, circular: data.circular, existing: [] });
        const named = suggestions.map(s => ({ name: s.name, type: s.kind }));
        if (named.length) {
          info.contents = describeContents(named);
          info.detected = true;
          info.catalogVersion = catalog;
        }
      } catch {
        /* detection is a bonus here: a file that can't be searched still lists */
      }
    }
    return info;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ...base, name: basename(f.path), length: 0, circular: false, features: 0, contents: "", description: "", fields: {}, error };
  }
}

const VERIFIED_CLASS: Record<string, string> = { Yes: "sv-home-ok", Partially: "sv-home-warn", No: "sv-home-bad", "Differences found": "sv-home-bad" };
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export class Home {
  readonly el: HTMLElement;
  private host: HomeHost;
  private infos: ConstructInfo[] = [];
  private folderErrors = new Map<string, string>();
  private progress: { done: number; total: number } | null = null;
  private scanId = 0;
  private lastScan = 0;
  private query = "";
  private renderLater = false;
  private search: HTMLInputElement;
  private list = h("div", { class: "sv-home-list" });
  private folderList = h("div", { class: "sv-home-folders" });
  private recentList = h("div", { class: "sv-home-recent" });
  private countEl = h("span", { class: "sv-count" });
  private progressEl = h("span", { class: "sv-pane-note" });

  constructor(host: HomeHost) {
    this.host = host;
    this.search = h("input", { type: "search", class: "sv-input sv-input-filter", placeholder: "Search names, contents and notes", "aria-label": "Search constructs" }) as HTMLInputElement;
    this.search.addEventListener("input", () => {
      this.query = this.search.value;
      this.renderList();
    });
    // A re-render while a note is being typed would lose it: wait until the field is left.
    this.list.addEventListener("focusout", () => {
      if (this.renderLater) requestAnimationFrame(() => this.renderList());
    });
    const side = h(
      "aside",
      { class: "sv-home-side" },
      h(
        "div",
        { class: "sv-home-actions" },
        h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => void this.openDialog() }, "Open…"),
        h("button", { type: "button", class: "sv-btn", onclick: () => host.open([null]) }, "New sequence")
      ),
      h(
        "section",
        null,
        h("div", { class: "sv-section-head" }, h("h2", { class: "sv-section-title" }, "Library folders"), h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": "Add folder", title: "Add folder", onclick: () => void this.chooseFolder() }, iconSvg("plus", 14))),
        this.folderList
      ),
      h("section", null, h("div", { class: "sv-section-head" }, h("h2", { class: "sv-section-title" }, "Recent")), this.recentList),
      h("p", { class: "sv-small sv-dim sv-home-hint" }, "Drop files anywhere to open them. To check sequencing results, open a construct and drop .ab1 files on it.")
    );
    const main = h(
      "main",
      { class: "sv-home-main" },
      h(
        "header",
        { class: "sv-home-head" },
        h("h1", { class: "sv-home-title" }, "Constructs", " ", this.countEl),
        this.progressEl,
        h("div", { class: "sv-outline-filter sv-home-search" }, iconSvg("search", 14), this.search),
        h("button", { type: "button", class: "sv-icon-btn", "aria-label": "Read the folders again", title: "Read the folders again", onclick: () => void this.scan() }, iconSvg("rotate", 16))
      ),
      this.list
    );
    this.el = h("div", { class: "sv-home" }, side, main);
    this.renderSide();
    this.renderList();
  }

  /** Called when Home becomes the visible tab: picks up new and changed files. */
  show() {
    this.renderSide();
    if (Date.now() - this.lastScan > 3000) void this.scan();
  }

  focusSearch() {
    this.search.focus();
    this.search.select();
  }

  /** File names as listed, for the end-to-end tests. */
  listedNames(): string[] {
    return Array.from(this.list.querySelectorAll(".sv-home-open")).map(b => b.textContent || "");
  }

  addFolder(folder: string) {
    setLibraryFolders([...libraryFolders(), folder]);
    this.renderSide();
    return this.scan();
  }

  private removeFolder(folder: string) {
    setLibraryFolders(libraryFolders().filter(f => f !== folder));
    this.renderSide();
    void this.scan();
  }

  /** Asks for a folder and adds it; the folder, or null if none was chosen. */
  async chooseFolder(): Promise<string | null> {
    if (!isDesktop) {
      toast("Folders can only be read in the desktop app.", "info");
      return null;
    }
    const folder = await pickFolder("Add a folder of constructs");
    if (folder) await this.addFolder(folder);
    return folder;
  }

  private async openDialog() {
    try {
      await showOpenDialog();
    } catch (e) {
      toast(`Couldn't open: ${e instanceof Error ? e.message : e}`, "error", 6000);
    }
  }

  /** Lists the folders and reads files that are new or changed since last time. */
  async scan() {
    const id = ++this.scanId;
    this.lastScan = Date.now();
    const folders = libraryFolders();
    const listed = new Map<string, ListedFile>();
    const errors = new Map<string, string>();
    for (const folder of folders) {
      try {
        for (const f of await listSequenceFiles(folder)) listed.set(f.path, f);
      } catch (e) {
        errors.set(folder, e instanceof Error ? e.message : String(e));
      }
    }
    if (id !== this.scanId) return;
    const catalog = await catalogVersion();
    if (id !== this.scanId) return;
    this.folderErrors = errors;
    const known: ConstructInfo[] = [];
    const toRead: ListedFile[] = [];
    for (const f of listed.values()) {
      const hit = cachedConstruct(f.path, f.size, f.modified, catalog);
      if (hit) known.push(hit);
      else toRead.push(f);
    }
    this.infos = known;
    this.progress = toRead.length ? { done: 0, total: toRead.length } : null;
    this.renderSide();
    this.renderList();
    for (let i = 0; i < toRead.length; i++) {
      const info = await readConstruct(toRead[i], catalog);
      if (id !== this.scanId) return;
      this.infos = [...this.infos, info];
      this.progress = { done: i + 1, total: toRead.length };
      if (i % 8 === 7 || i === toRead.length - 1) this.renderList();
    }
    this.progress = null;
    cacheConstructs(this.infos);
    this.renderSide();
    this.renderList();
  }

  private renderSide() {
    const folders = libraryFolders();
    this.folderList.replaceChildren(
      ...folders.map(folder => {
        const count = this.infos.filter(i => subfolderOf(i.path, folder) !== null).length;
        const error = this.folderErrors.get(folder);
        return h(
          "div",
          { class: "sv-home-folder", title: error ? `${folder}\n${error}` : folder },
          iconSvg(error ? "warn" : "folder", 14),
          h("span", { class: "sv-home-folder-name" }, basename(folder) || folder),
          h("span", { class: "sv-count" }, error ? "not found" : String(count)),
          h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": `Remove ${basename(folder)} from the library`, title: "Remove from the library (the files stay)", onclick: () => this.removeFolder(folder) }, iconSvg("x", 12))
        );
      }),
      folders.length ? "" : h("p", { class: "sv-small sv-dim" }, "None yet."),
      h("button", { type: "button", class: "sv-link-btn", onclick: () => void this.chooseFolder() }, "Add folder…")
    );
    const recent = recentFiles();
    this.recentList.replaceChildren(
      ...recent.map(path =>
        h(
          "button",
          { type: "button", class: "sv-home-recent-item", title: isBrowserKey(path) ? basename(path) : path, onclick: () => this.host.open([path]) },
          h("span", { class: "sv-home-recent-name" }, basename(path)),
          // Marks keep the slashes in place in the right-to-left box that shows the path's end.
          // A browser's key (src/webFiles.ts) has no folder to show.
          isBrowserKey(path) ? "" : h("span", { class: "sv-home-recent-dir" }, `\u200e${dirname(path)}\u200e`)
        )
      ),
      recent.length ? "" : h("p", { class: "sv-small sv-dim" }, "Files you open appear here.")
    );
  }

  private renderList() {
    if (this.list.contains(document.activeElement) && document.activeElement?.classList.contains("sv-home-note")) {
      this.renderLater = true;
      return;
    }
    this.renderLater = false;
    const folders = libraryFolders();
    const shown = this.infos.filter(i => matchesSearch(i, this.note(i), this.query));
    this.countEl.textContent = this.query ? `${fmt(shown.length)} of ${fmt(this.infos.length)}` : fmt(this.infos.length);
    this.progressEl.textContent = this.progress ? `Reading ${fmt(this.progress.done)} of ${fmt(this.progress.total)} files…` : "";

    if (!folders.length) {
      this.list.replaceChildren(
        h(
          "div",
          { class: "sv-home-empty" },
          iconSvg("folder", 28),
          h("h2", null, "Your constructs in one place"),
          h("p", null, "Add the folders where you keep plasmid and construct files (GenBank, SnapGene, FASTA). Home lists every file in them and their subfolders, with what each construct carries and a note you can add."),
          h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => void this.chooseFolder() }, "Add folder…"),
          isDesktop ? "" : h("p", { class: "sv-small sv-dim" }, "Folders can only be read in the desktop app.")
        )
      );
      return;
    }
    if (!shown.length) {
      const text = this.progress ? "Reading files…" : this.query ? `No construct matches “${this.query.trim()}”.` : "No sequence files in these folders yet.";
      this.list.replaceChildren(h("div", { class: "sv-empty" }, text));
      return;
    }

    // Grouped by library folder, then subfolder; each file under the first folder that holds it.
    const rows: HTMLElement[] = [];
    const placed = new Set<string>();
    for (const folder of folders) {
      const mine = shown.filter(i => !placed.has(i.path) && subfolderOf(i.path, folder) !== null);
      if (!mine.length) continue;
      mine.forEach(i => placed.add(i.path));
      rows.push(h("tr", { class: "sv-home-group" }, h("th", { colspan: "5", scope: "colgroup", title: folder }, basename(folder) || folder, h("span", { class: "sv-dim" }, ` ${dirname(folder)}`))));
      const bySub = new Map<string, ConstructInfo[]>();
      for (const i of mine) {
        const sub = subfolderOf(i.path, folder) ?? "";
        bySub.set(sub, [...(bySub.get(sub) ?? []), i]);
      }
      for (const sub of [...bySub.keys()].sort(byName)) {
        if (sub) rows.push(h("tr", { class: "sv-home-subgroup" }, h("th", { colspan: "5", scope: "colgroup" }, iconSvg("folder", 12), sub)));
        for (const i of bySub.get(sub)!.sort((a, b) => byName(basename(a.path), basename(b.path)))) rows.push(this.row(i));
      }
    }
    this.list.replaceChildren(
      h(
        "table",
        { class: "sv-table sv-home-table" },
        h("thead", null, h("tr", null, ...["Name", "Length", "Contents", "Note", "Changed"].map(t => h("th", { scope: "col", class: t === "Length" ? "sv-num" : "" }, t)))),
        h("tbody", null, rows)
      )
    );
  }

  /** The note typed on Home, else the Notes field saved in the file. */
  private note(i: ConstructInfo): string {
    return constructNote(i.path) ?? i.fields.Notes ?? "";
  }

  private row(i: ConstructInfo): HTMLElement {
    const file = basename(i.path);
    const verified = i.fields["Sequence verified"];
    const open = () => this.host.open([i.path]);
    const note = h("input", {
      type: "text",
      class: "sv-input sv-home-note",
      value: this.note(i),
      placeholder: "Add a note",
      "aria-label": `Note for ${file}`,
      title: "A short note, kept in Strandivo. The Info tab's Notes field is saved in the file.",
      onchange: (e: Event) => setConstructNote(i.path, (e.target as HTMLInputElement).value),
      onkeydown: (e: KeyboardEvent) => e.key === "Enter" && (e.target as HTMLInputElement).blur()
    });
    return h(
      "tr",
      { class: `sv-home-row${i.error ? " sv-home-unreadable" : ""}`, ondblclick: (e: MouseEvent) => !(e.target as HTMLElement).closest("input") && open() },
      h(
        "td",
        { class: "sv-home-name" },
        h("button", { type: "button", class: "sv-home-open", title: `Open ${i.path}`, onclick: open }, file),
        i.error ? h("div", { class: "sv-small sv-text-warn", title: i.error }, "Couldn't be read") : "",
        !i.error && i.name && i.name !== stripExtension(file) ? h("div", { class: "sv-small sv-dim" }, i.name) : "",
        verified ? h("span", { class: `sv-home-verified ${VERIFIED_CLASS[verified] ?? ""}`, title: "Sequence verified (Info tab)" }, verified === "Yes" ? "Verified" : verified) : ""
      ),
      h("td", { class: "sv-num" }, i.error ? "—" : `${fmt(i.length)} bp`, i.error ? "" : h("div", { class: "sv-small sv-dim" }, i.circular ? "circular" : "linear")),
      h(
        "td",
        { class: "sv-home-contents", title: i.detected ? "Found by looking for known parts; this file annotates nothing itself" : undefined },
        i.contents || h("span", { class: "sv-dim" }, i.features ? "—" : "No features"),
        i.detected ? h("span", { class: "sv-home-detected" }, "detected") : null
      ),
      h("td", { class: "sv-home-note-cell" }, note),
      h("td", { class: "sv-small sv-dim sv-home-date" }, i.modified ? new Date(i.modified).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "")
    );
  }
}

/** The subfolder of `folder` that holds `path`, or null if `path` isn't inside `folder`. */
function subfolderOf(path: string, folder: string): string | null {
  const norm = (p: string) => p.replace(/[\\/]+/g, "/").replace(/\/$/, "");
  return norm(path).startsWith(norm(folder) + "/") ? subfolder(path, folder) : null;
}
