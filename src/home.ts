// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Home, the first tab of the main window: the construct library. It lists the sequence
// files in the user's folders (and their subfolders) with what each construct carries and
// a short note, next to Open, New sequence and recent files. Opening one adds a tab.
//
// In a browser, folders are kept only where it gives their handles (Chrome and Edge), and
// it may ask again before one is read on a later visit, which it allows only after a click:
// until then the folder offers "Allow access…" and its files show as they were last read.
// Elsewhere (Safari and Firefox), Home lists the files opened during the visit instead.

import { h, toast } from "./ui/dom.ts";
import { iconSvg } from "./ui/icons.ts";
import { fmt } from "./ui/format.ts";
import {
  allowFolder,
  BROWSER_PRIVACY_PAGE,
  canKeepFolders,
  catalogVersion,
  detectFeatures,
  folderAccess,
  isDesktop,
  listOpened,
  listSequenceFiles,
  pickFolder,
  readFile,
  showOpenDialog,
  type ListedFile
} from "./platform.ts";
import { isBrowserKey, shownPath } from "./webFiles.ts";
import { recentFiles } from "./recent.ts";
import { basename, dirname, extension, LIBRARY_EXTENSIONS, stripExtension } from "./lib/files.ts";
import { describeContents, matchesSearch, subfolder, type ConstructInfo } from "./lib/constructs.ts";
import { nextTableSort, parseTableSort, sortedBy, type TableSort } from "./lib/tableSort.ts";
import { sortHeader } from "./ui/sortHead.ts";
import { parseComments } from "./lib/labinfo.ts";
import {
  cacheConstructs,
  cachedConstruct,
  cachedConstructs,
  canKeepNote,
  constructNote,
  isCurrent,
  libraryFolders,
  setConstructNote,
  setLibraryFolders
} from "./constructLibrary.ts";

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

/** Said where a browser can't keep folders, above what Home lists instead. */
const NO_FOLDERS = "This browser can't keep folders between visits: Home lists only the files opened in this tab. Use Chrome, Edge or the desktop app to keep folders.";

const VERIFIED_CLASS: Record<string, string> = { Yes: "sv-home-ok", Partially: "sv-home-warn", No: "sv-home-bad", "Differences found": "sv-home-bad" };
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The columns Home sorts by, and the sort kept between visits. */
type HomeSortKey = "name" | "length" | "changed";
const HOME_SORT_KEY = "strandivo.homeSort";
const HOME_SORT_KEYS: HomeSortKey[] = ["name", "length", "changed"];
const BY_NAME: TableSort<HomeSortKey> = { key: "name", descending: false };
/** The newest change first. */
const HOME_SORT_RULES = { firstDescending: ["changed"] as HomeSortKey[] };

function loadHomeSort(): TableSort<HomeSortKey> {
  try {
    return parseTableSort(JSON.parse(localStorage.getItem(HOME_SORT_KEY) || "null"), HOME_SORT_KEYS, BY_NAME) ?? BY_NAME;
  } catch {
    return BY_NAME;
  }
}

/** Files in the order asked for, ties by name; a file that couldn't be read goes last by length or date. */
function sortConstructs(list: ConstructInfo[], sort: TableSort<HomeSortKey>): ConstructInfo[] {
  const name = (a: ConstructInfo, b: ConstructInfo) => byName(basename(a.path), basename(b.path));
  return sortedBy(
    list,
    sort,
    (key, a, b) => (key === "name" ? name(a, b) : key === "length" ? a.length - b.length : a.modified - b.modified),
    name,
    (key, i) => key !== "name" && !!i.error
  );
}

export class Home {
  readonly el: HTMLElement;
  private host: HomeHost;
  private infos: ConstructInfo[] = [];
  private folderErrors = new Map<string, string>();
  /** Folders the browser wants to ask about before they are read again. */
  private locked = new Set<string>();
  /** Files opened during this visit, listed where the browser can't keep folders. */
  private opened: string[] = [];
  private progress: { done: number; total: number } | null = null;
  private scanId = 0;
  private lastScan = 0;
  private query = "";
  private sort = loadHomeSort();
  private renderLater = false;
  private search: HTMLInputElement;
  private list = h("div", { class: "sv-home-list" });
  private folderList = h("div", { class: "sv-home-folders" });
  private recentList = h("div", { class: "sv-home-recent" });
  private folderSection: HTMLElement;
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
      (this.folderSection = h(
        "section",
        null,
        h("div", { class: "sv-section-head" }, h("h2", { class: "sv-section-title" }, "Library folders"), h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": "Add folder", title: "Add folder", onclick: () => void this.chooseFolder() }, iconSvg("plus", 14))),
        this.folderList
      )),
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
      // In a browser, what happens to the files, always in view (part 5 of docs/web-version-plan.md).
      isDesktop
        ? ""
        : h(
            "p",
            { class: "sv-small sv-dim sv-home-web" },
            "Runs in your browser. Your files never leave this computer. ",
            h("a", { href: BROWSER_PRIVACY_PAGE, target: "_blank", rel: "noopener" }, "How?")
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

  /** A file opened in a tab: listed for the visit where the browser can't keep folders. */
  noteOpened(path: string) {
    if (!LIBRARY_EXTENSIONS.includes(extension(path)) || this.opened.includes(path)) return;
    this.opened.push(path);
    this.lastScan = 0;
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
    if (!canKeepFolders()) {
      toast(NO_FOLDERS, "info", 8000);
      return null;
    }
    let folder: string | null;
    try {
      folder = await pickFolder("Add a folder of constructs");
    } catch (e) {
      toast(`Couldn't add the folder: ${e instanceof Error ? e.message : e}`, "error", 6000);
      return null;
    }
    if (folder) await this.addFolder(folder);
    return folder;
  }

  /** Asks the browser to let Home read these folders again, from a click. */
  private async allow(folders: string[]) {
    for (const folder of folders) {
      if (!(await allowFolder(folder))) {
        toast(`Strandivo wasn't allowed to read ${basename(folder)}.`, "info", 6000);
        break;
      }
    }
    await this.scan();
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
    const keepsFolders = canKeepFolders();
    const folders = keepsFolders ? libraryFolders() : [];
    const listed = new Map<string, ListedFile>();
    const errors = new Map<string, string>();
    const locked = new Set<string>();
    if (!keepsFolders) for (const f of listOpened(this.opened)) listed.set(f.path, f);
    for (const folder of folders) {
      try {
        if ((await folderAccess(folder)) === "ask") locked.add(folder);
        else for (const f of await listSequenceFiles(folder)) listed.set(f.path, f);
      } catch (e) {
        errors.set(folder, e instanceof Error ? e.message : String(e));
      }
    }
    if (id !== this.scanId) return;
    const catalog = await catalogVersion();
    if (id !== this.scanId) return;
    this.folderErrors = errors;
    this.locked = locked;
    const before = new Map(this.infos.map(i => [i.path, i]));
    // A folder the browser asks about first shows what was read from it last time.
    const known: ConstructInfo[] = cachedConstructs().filter(i => !listed.has(i.path) && [...locked].some(f => subfolderOf(i.path, f) !== null));
    const toRead: ListedFile[] = [];
    for (const f of listed.values()) {
      const seen = before.get(f.path);
      const hit = seen && isCurrent(seen, f.size, f.modified, catalog) ? seen : cachedConstruct(f.path, f.size, f.modified, catalog);
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
    this.folderSection.hidden = !canKeepFolders();
    this.folderList.replaceChildren(
      ...folders.map(folder => {
        const count = this.infos.filter(i => subfolderOf(i.path, folder) !== null).length;
        const error = this.folderErrors.get(folder);
        const locked = this.locked.has(folder);
        return h(
          "div",
          { class: "sv-home-folder", title: error ? `${shownPath(folder)}\n${error}` : locked ? `${shownPath(folder)}\nAllow access to read this folder again.` : shownPath(folder) },
          iconSvg(error ? "warn" : "folder", 14),
          h("span", { class: "sv-home-folder-name" }, basename(folder) || folder),
          locked ? this.allowButton([folder]) : h("span", { class: "sv-count" }, error ? "not found" : String(count)),
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
          { type: "button", class: "sv-home-recent-item", title: shownPath(path), onclick: () => this.host.open([path]) },
          h("span", { class: "sv-home-recent-name" }, basename(path)),
          // Marks keep the slashes in place in the right-to-left box that shows the path's end.
          // A browser's key (src/webFiles.ts) has a folder to show only if it is in one of Home's.
          dirname(shownPath(path)) ? h("span", { class: "sv-home-recent-dir" }, `\u200e${dirname(shownPath(path))}\u200e`) : ""
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
    const keepsFolders = canKeepFolders();
    const folders = keepsFolders ? libraryFolders() : [];
    const shown = this.infos.filter(i => matchesSearch(i, this.note(i), this.query));
    this.countEl.textContent = this.query ? `${fmt(shown.length)} of ${fmt(this.infos.length)}` : fmt(this.infos.length);
    this.progressEl.textContent = this.progress ? `Reading ${fmt(this.progress.done)} of ${fmt(this.progress.total)} files…` : "";

    if (keepsFolders ? !folders.length : !this.opened.length) {
      this.list.replaceChildren(
        h(
          "div",
          { class: "sv-home-empty" },
          iconSvg("folder", 28),
          h("h2", null, "Construct library"),
          keepsFolders
            ? h("p", null, "Add the folders where you keep plasmid files (GenBank, SnapGene, FASTA) to browse them and their features.")
            : h("p", null, NO_FOLDERS),
          keepsFolders
            ? h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => void this.chooseFolder() }, "Add folder…")
            : h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => void this.openDialog() }, "Open…")
        )
      );
      return;
    }
    const note = keepsFolders ? "" : h("p", { class: "sv-small sv-dim sv-home-note-line" }, NO_FOLDERS);
    if (!shown.length && !this.locked.size) {
      const text = this.progress ? "Reading files…" : this.query ? `No construct matches “${this.query.trim()}”.` : "No sequence files in these folders yet.";
      this.list.replaceChildren(note, h("div", { class: "sv-empty" }, text));
      return;
    }

    // Grouped by library folder, then subfolder; each file under the first folder that holds it.
    // Where folders can't be kept, the files opened during the visit, by name.
    const rows: HTMLElement[] = [];
    const placed = new Set<string>();
    if (!keepsFolders) rows.push(...sortConstructs(shown, this.sort).map(i => this.row(i)));
    for (const folder of folders) {
      const mine = shown.filter(i => !placed.has(i.path) && subfolderOf(i.path, folder) !== null);
      const locked = this.locked.has(folder);
      if (!mine.length && !locked) continue;
      mine.forEach(i => placed.add(i.path));
      // A browser's key (src/webFiles.ts) has no place on disk to show.
      const where = isBrowserKey(folder) ? "" : dirname(folder);
      rows.push(
        h(
          "tr",
          { class: "sv-home-group" },
          h(
            "th",
            { colspan: "5", scope: "colgroup", title: shownPath(folder) },
            basename(folder) || folder,
            where ? h("span", { class: "sv-dim" }, ` ${where}`) : "",
            locked ? h("span", { class: "sv-home-locked" }, h("span", { class: "sv-dim" }, mine.length ? "Showing cached files — allow access to refresh." : "Allow access to read this folder again."), this.allowButton([folder])) : ""
          )
        )
      );
      const bySub = new Map<string, ConstructInfo[]>();
      for (const i of mine) {
        const sub = subfolderOf(i.path, folder) ?? "";
        bySub.set(sub, [...(bySub.get(sub) ?? []), i]);
      }
      for (const sub of [...bySub.keys()].sort(byName)) {
        if (sub) rows.push(h("tr", { class: "sv-home-subgroup" }, h("th", { colspan: "5", scope: "colgroup" }, iconSvg("folder", 12), sub)));
        for (const i of sortConstructs(bySub.get(sub)!, this.sort)) rows.push(this.row(i));
      }
    }
    this.list.replaceChildren(
      note,
      h(
        "table",
        { class: "sv-table sv-home-table" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            this.sortHeader("Name", "name"),
            this.sortHeader("Length", "length", "sv-num"),
            h("th", { scope: "col" }, "Contents"),
            h("th", { scope: "col" }, "Note"),
            this.sortHeader("Changed", "changed")
          )
        ),
        h("tbody", null, rows)
      )
    );
  }

  /** A heading that sorts the files in each folder by its column. */
  private sortHeader(label: string, key: HomeSortKey, cls?: string): HTMLTableCellElement {
    return sortHeader({
      label,
      key,
      cls,
      sort: this.sort,
      onSort: k => {
        this.sort = nextTableSort(this.sort, k, HOME_SORT_RULES) ?? BY_NAME;
        try {
          localStorage.setItem(HOME_SORT_KEY, JSON.stringify(this.sort));
        } catch {
          /* storage unavailable: the sort lasts until the window closes */
        }
        this.renderList();
      }
    });
  }

  /** The note typed on Home, else the Notes field saved in the file. */
  private note(i: ConstructInfo): string {
    return constructNote(i.path) ?? i.fields.Notes ?? "";
  }

  private allowButton(folders: string[]): HTMLElement {
    return h("button", { type: "button", class: "sv-link-btn sv-home-allow", onclick: () => void this.allow(folders) }, "Allow access…");
  }

  private row(i: ConstructInfo): HTMLElement {
    const file = basename(i.path);
    const verified = i.fields["Sequence verified"];
    const open = () => this.host.open([i.path]);
    // A file held only for the visit can't keep a note: the file's own Notes field shows.
    const note = !canKeepNote(i.path) ? h("span", { class: "sv-small sv-dim", title: "Notes typed on Home are kept for files in a folder." }, i.fields.Notes ?? "") : h("input", {
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
        h("button", { type: "button", class: "sv-home-open", title: `Open ${shownPath(i.path)}`, onclick: open }, file),
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
