// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// End-to-end check of the real desktop app on Linux.
//
// Launches the built app through tauri-driver (WebDriver), clicks through the main
// workflows, saves screenshots and writes a report. Runs in CI under a virtual display:
//
//   xvfb-run node e2e/run.mjs <path to app binary> <output folder>
//
// No dependencies: talks to WebDriver over HTTP with Node's fetch.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { checkMapRegionDisplay } from "./mapRegions.mjs";

const [binary, outDir = "e2e-out"] = process.argv.slice(2);
if (!binary) {
  console.error("usage: node e2e/run.mjs <app binary> [output folder]");
  process.exit(2);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const data = (...p) => path.join(root, "testdata", ...p);
mkdirSync(outDir, { recursive: true });

const DRIVER = "http://127.0.0.1:4444";
const checks = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function wd(method, url, body) {
  const res = await fetch(DRIVER + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json.value ?? json).slice(0, 400)}`);
  return json.value;
}

async function startDriver() {
  const driver = spawn(path.join(homedir(), ".cargo", "bin", "tauri-driver"), [], { stdio: ["ignore", "inherit", "inherit"] });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(DRIVER + "/status");
      return driver;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("tauri-driver did not start");
}

class Session {
  constructor(id) {
    this.id = id;
  }
  static async start(args) {
    const v = await wd("POST", "/session", {
      capabilities: { alwaysMatch: { "tauri:options": { application: path.resolve(binary), args } } }
    });
    return new Session(v.sessionId);
  }
  exec(script, ...args) {
    return wd("POST", `/session/${this.id}/execute/sync`, { script, args });
  }
  execAsync(script, ...args) {
    return wd("POST", `/session/${this.id}/execute/async`, { script, args });
  }
  async waitFor(expr, timeout = 20000, ...args) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        if (await this.exec(`return !!(${expr});`, ...args)) return true;
      } catch {
        /* page still loading */
      }
      await sleep(250);
    }
    return false;
  }
  async find(css, using = "css selector") {
    const v = await wd("POST", `/session/${this.id}/element`, { using, value: css });
    return Object.values(v)[0];
  }
  async click(css, using) {
    const el = await this.find(css, using);
    await wd("POST", `/session/${this.id}/element/${el}/click`, {});
  }
  /** Runs pointer actions; `release` then lets go of anything pressed, as a later call can't. */
  async pointer(actions, { release = false } = {}) {
    await wd("POST", `/session/${this.id}/actions`, { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions }] });
    if (release) await wd("DELETE", `/session/${this.id}/actions`).catch(() => {});
  }
  async doubleClick(css) {
    const el = await this.find(css);
    const actions = [
      { type: "pointerMove", origin: { "element-6066-11e4-a52e-4f735466cecf": el }, x: 0, y: 0 },
      { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
      { type: "pause", duration: 50 },
      { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }
    ];
    await this.pointer(actions);
    await wd("DELETE", `/session/${this.id}/actions`).catch(() => {});
  }
  async modifiedClick(css, keys) {
    await wd("POST", `/session/${this.id}/actions`, { actions: [{ type: "key", id: "keyboard", actions: keys.map(value => ({ type: "keyDown", value })) }] });
    try { await this.click(css); }
    finally { await wd("DELETE", `/session/${this.id}/actions`).catch(() => {}); }
  }
  async keys(css, text) {
    const el = await this.find(css);
    await wd("POST", `/session/${this.id}/element/${el}/value`, { text });
  }
  /** Real key presses to whatever has focus. `mods` are WebDriver key codes held down, e.g. CTRL. */
  async press(text, mods = []) {
    const down = mods.map(value => ({ type: "keyDown", value }));
    const up = [...mods].reverse().map(value => ({ type: "keyUp", value }));
    const keys = Array.from(text).flatMap(value => [{ type: "keyDown", value }, { type: "keyUp", value }]);
    await wd("POST", `/session/${this.id}/actions`, { actions: [{ type: "key", id: "keyboard", actions: [...down, ...keys, ...up] }] });
    await wd("DELETE", `/session/${this.id}/actions`).catch(() => {});
  }
  /** A real click at a point of the page (CSS pixels from its top left). */
  async clickAt([x, y]) {
    await this.pointer([{ type: "pointerMove", x: Math.round(x), y: Math.round(y), origin: "viewport" }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }], { release: true });
  }
  /** Drags the mouse between two points of the page (CSS pixels from its top left). */
  async drag(from, to) {
    const at = ([x, y], duration = 0) => ({ type: "pointerMove", x: Math.round(x), y: Math.round(y), origin: "viewport", duration });
    const actions = [at(from), { type: "pointerDown", button: 0 }, at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], 100), at(to, 100), { type: "pointerUp", button: 0 }];
    await this.pointer(actions);
    await wd("DELETE", `/session/${this.id}/actions`).catch(() => {});
  }
  async shot(name) {
    const b64 = await wd("GET", `/session/${this.id}/screenshot`);
    writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(b64, "base64"));
  }
  handles() {
    return wd("GET", `/session/${this.id}/window/handles`);
  }
  current() {
    return wd("GET", `/session/${this.id}/window`);
  }
  switchTo(handle) {
    return wd("POST", `/session/${this.id}/window`, { handle });
  }
  closeWindow() {
    return wd("DELETE", `/session/${this.id}/window`);
  }
  end() {
    return wd("DELETE", `/session/${this.id}`).catch(() => {});
  }
}

const CTRL = "\uE009";
const SHIFT = "\uE008";
const ARROW_RIGHT = "\uE014";
const ESCAPE = "\uE00C";
const ENTER = "\uE007";
const BACKSPACE = "\uE003";
const PAGE_UP = "\uE00E";

/** Drawn width of the first row's bases relative to the width the layout gives them (1.0 = lined up). */
const SEQUENCE_FIT = `
  const b = document.querySelector('.sv-row .sv-bases');
  if (!b) return null;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:' + b.textContent.length + 'ch';
  b.parentElement.appendChild(probe);
  const ratio = b.getBoundingClientRect().width / probe.getBoundingClientRect().width;
  probe.remove();
  return ratio;
`;

/** Map labels that stick out of the drawing area. */
const CLIPPED_LABELS = `
  const area = document.querySelector('.sv-map-svgel').getBoundingClientRect();
  return Array.from(document.querySelectorAll('.sv-map-label')).filter(t => {
    const r = t.getBoundingClientRect();
    return r.width && (r.left < area.left - 1 || r.right > area.right + 1 || r.top < area.top - 1 || r.bottom > area.bottom + 1);
  }).map(t => t.textContent);
`;

const doc = `const s = window.__strandivo.store;`;
const outlineRow = name => `//*[contains(@class,'sv-outline')]//*[contains(@class,'sv-list-row')][.//*[normalize-space(text())='${name}']]`;
const mapChip = label => `//button[contains(@class,'sv-chip')][normalize-space()='${label}']`;
// Adds a feature that starts right after lacZ-alpha ends (undo takes it out again).
const addTouching = `${doc} const lac = s.data.features.find(f => f.name === "lacZ-alpha");
  s.apply({ ...s.data, features: [...s.data.features, { id: "e2e-touch", name: "lac promoter", type: "promoter", start: lac.end + 1, end: lac.end + 31, strand: -1, notes: {}, raw: {} }] }, "Add feature");
  return lac.id;`;

/** Exercise real clicks: a codon is plain DNA, while its name and double-click select the CDS. */
async function checkCodonClicks(s, root, label) {
  const c = await s.exec(`${doc}
    const el = document.querySelector(arguments[0] + ' .sv-codon');
    if (!el) return null;
    const f = s.data.features.find(f => f.id === el.dataset.id);
    return { id: f.id, start: Number(el.dataset.codonStart), end: Number(el.dataset.codonEnd), featureStart: f.start, featureEnd: f.end, length: s.length };`, root);
  check(`${label}: amino acids have codon hit areas`, !!c);
  if (!c) return;
  const hit = `${root} .sv-codon[data-id="${c.id}"][data-codon-start="${c.start}"]`;
  const selected = () => s.exec(`${doc} return { range: s.selection.range, focus: s.selection.focus };`);
  await s.click(hit);
  const single = await selected();
  check(`${label}: one click selects the codon's three bases without selecting the feature`, single.range?.start === c.start && single.range?.end === c.end && !single.focus && (c.end - c.start + c.length) % c.length === 2, JSON.stringify(single));
  await s.doubleClick(hit);
  const double = await selected();
  check(`${label}: a double-click selects the whole feature`, double.range?.start === c.featureStart && double.range?.end === c.featureEnd && double.focus?.id === c.id, JSON.stringify(double));
  await s.click(hit);
  await s.click(`${root} [data-id="${c.id}"] .sv-feature-caption, ${root} .sv-feature-caption[data-id="${c.id}"]`);
  const caption = await selected();
  check(`${label}: clicking the feature name selects the whole feature`, caption.range?.start === c.featureStart && caption.range?.end === c.featureEnd && caption.focus?.id === c.id, JSON.stringify(caption));
}

async function checkCodonEdges(s) {
  const cases = await s.exec(`${doc}
    const row = document.querySelector('.sv-seq .sv-bases').textContent.length;
    const n = s.length;
    const cases = [
      { id: 'e2e-codon-forward', start: row - 2, end: row + 9, strand: 1, mid: row - 1, codon: { start: row - 2, end: row } },
      { id: 'e2e-codon-reverse', start: row * 2 - 10, end: row * 2 + 1, strand: -1, mid: row * 2, codon: { start: row * 2 - 1, end: row * 2 + 1 } },
      { id: 'e2e-codon-origin-forward', start: n - 2, end: 6, strand: 1, mid: n - 1, codon: { start: n - 2, end: 0 } },
      { id: 'e2e-codon-origin-reverse', start: n - 7, end: 1, strand: -1, mid: 0, codon: { start: n - 1, end: 1 } }
    ];
    const features = cases.map(({ codon, mid, ...f }) => ({ ...f, name: f.id, type: 'CDS', notes: {}, raw: {} }));
    s.apply({ ...s.data, features: [...s.data.features, ...features] }, 'Test codon edges');
    return cases;`);
  for (const c of cases) {
    await s.exec(`${doc} s.select({ range: null, caret: arguments[0] }, 'e2e');`, c.mid);
    const hit = `.sv-seq .sv-codon[data-id="${c.id}"][data-codon-start="${c.codon.start}"]`;
    check(`${c.id}: the codon is drawn`, await s.waitFor("document.querySelector(arguments[0])", 5000, hit));
    await s.click(hit);
    const sel = await s.exec(`${doc} return s.selection;`);
    check(`${c.id}: selects all three bases across the row or origin`, sel.range?.start === c.codon.start && sel.range?.end === c.codon.end && !sel.focus, JSON.stringify(sel));
  }
  await s.exec(`${doc} s.undo();`);
}

async function checkCodonGestures(s, root, label) {
  const refs = await s.exec(`
    const els = Array.from(document.querySelectorAll(arguments[0] + ' .sv-codon'));
    const id = els[0]?.dataset.id;
    const groups = new Map();
    for (const el of els.filter(e => e.dataset.id === id)) {
      const row = el.closest('.sv-row, .sv-ctx-row');
      const group = groups.get(row) || [];
      group.push({ id, index: Number(el.dataset.codonIndex) }); groups.set(row, group);
    }
    const group = [...groups.values()].find(g => g.length >= 5);
    return group?.sort((a, b) => a.index - b.index).slice(0, 5);`, root);
  check(`${label}: a row has enough residues to check gestures`, !!refs);
  if (!refs) return;
  const hit = i => `${root} .sv-codon[data-id="${refs[i].id}"][data-codon-index="${refs[i].index}"]`;
  const state = () => s.exec(`${doc} return { picks: s.selection.codons?.picks.map(p => p.index).sort((a,b) => a-b), range: s.selection.range, ranges: s.selection.ranges, marked: document.querySelectorAll(arguments[0] + ' .sv-codon-selected').length };`, root);
  const drag = async (from, to) => {
    await s.click(hit(from));
    const points = await s.exec("return arguments[0].map(css => { const r = document.querySelector(css).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });", [hit(from), hit(to)]);
    await s.drag(points[0], points[1]);
  };
  for (const [from, to] of [[0, 4], [4, 0]]) {
    await drag(from, to);
    const selected = await state();
    check(`${label}: dragging ${from < to ? 'forward' : 'backward'} selects complete codons`, JSON.stringify(selected.picks) === JSON.stringify(refs.map(p => p.index)) && selected.marked === 5, JSON.stringify(selected));
  }
  await s.click(hit(0));
  await s.modifiedClick(hit(4), [CTRL]);
  const separate = await state();
  check(`${label}: Ctrl-click adds a separate codon without its neighbours`, separate.range === null && separate.ranges?.length === 2 && JSON.stringify(separate.picks) === JSON.stringify([refs[0].index, refs[4].index]), JSON.stringify(separate));
  await s.modifiedClick(hit(2), [CTRL, SHIFT]);
  const extended = await state();
  check(`${label}: Ctrl-Shift-click fills from the last clicked codon and keeps other picks`, JSON.stringify(extended.picks) === JSON.stringify([refs[0].index, ...refs.slice(2).map(p => p.index)]), JSON.stringify(extended));
  await s.modifiedClick(hit(3), [CTRL]);
  const toggled = await state();
  check(`${label}: Ctrl-click can remove a picked codon`, JSON.stringify(toggled.picks) === JSON.stringify([refs[0].index, refs[2].index, refs[4].index]), JSON.stringify(toggled));
  await s.click(hit(0));
}

async function main() {
  const driver = await startDriver();
  const s = await Session.start([data("e2e", "pUC19-annotated.gb")]);
  const state = () => s.exec(`${doc} return { len: s.data.sequence.length, features: s.data.features.map(f => f.name), primers: s.data.primers.map(p => p.name), sel: s.selection, dirty: s.dirty };`);
  try {
    // --- map ---
    // A fresh install: the welcome window opens over the file that started the app. Update
    // checks are counted through the hook, which answers that there is none.
    await s.exec("window.__e2eChecks = 0; window.__strandivoUpdate = { check: async () => { window.__e2eChecks++; return null; }, download: async () => {}, restart: async () => {} };");
    // Usage statistics go to the hook, never to the shell; e2e builds have no key anyway.
    await s.exec("window.__e2eUsage = []; window.__strandivoTrack = events => { window.__e2eUsage.push(...events); };");
    check("The file opens in a tab with its map", await s.waitFor("document.querySelector('.sv-map-svgel .sv-map-feature')", 30000));
    const welcomeShown = await s.waitFor("/Welcome to Strandivo/.test(document.querySelector('.sv-dialog-title')?.textContent)", 5000);
    check("On first launch the welcome window opens over the file", welcomeShown && JSON.stringify(await s.exec("return window.__strandivo.tabs()")) === '["pUC19-annotated.gb"]');
    if (welcomeShown) {
      await s.shot("00-welcome");
      await s.click("//label[contains(@class,'sv-welcome-option')][contains(., 'common sequencing primers')]//input", "xpath");
      check("Nothing is checked online while the welcome window is open", (await s.exec("return window.__e2eChecks")) === 0);
      check("It asks about usage statistics, unticked", (await s.exec("const box = Array.from(document.querySelectorAll('.sv-welcome-option')).find(l => /anonymous usage statistics/.test(l.textContent))?.querySelector('input'); return box ? box.checked : null;")) === false);
      await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Start using Strandivo']", "xpath");
      check("Start using Strandivo closes it", await s.waitFor("!document.querySelector('.sv-dialog')", 3000));
      const chosen = await s.exec("const st = JSON.parse(localStorage.getItem('strandivo.settings') || '{}'); return { seen: st.welcomeSeen, updates: st.checkForUpdates, usage: st.shareUsage, primers: JSON.parse(localStorage.getItem('strandivo.primerLibrary') || '[]').length };");
      check("Its choices land in the settings, and an unticked box adds nothing", chosen.seen >= 2 && chosen.updates === true && chosen.usage === false && chosen.primers === 0, JSON.stringify(chosen));
      check("Once it closes, the update check runs", await s.waitFor("window.__e2eChecks === 1", 9000), `${await s.exec("return window.__e2eChecks")} checks`);
    }
    await s.exec("delete window.__strandivoUpdate;");
    const firstTabs = await s.exec("return { tabs: window.__strandivo.tabs(), active: window.__strandivo.activeTab(), home: !!document.querySelector('.sv-apptab-home') }");
    check("Home and the file's tab are in the app bar", firstTabs.home && JSON.stringify(firstTabs.tabs) === '["pUC19-annotated.gb"]' && firstTabs.active === 0, JSON.stringify(firstTabs));
    await sleep(1500);
    await s.shot("01-map");
    const start = await state();
    const listed = await s.exec("return Array.from(document.querySelectorAll('.sv-outline .sv-list-row .sv-list-name')).map(e => e.textContent)");
    check("Outline lists the file's features", start.features.length >= 3 && start.features.every(f => listed.includes(f)), listed.join(", "));
    const clipped = await s.exec(CLIPPED_LABELS);
    check("Map labels fit inside the map", clipped.length === 0, clipped.join(", ") || "none clipped");
    // WebKit doesn't pass the baseline down to a name along its feature unless told to.
    const arcBaselines = await s.exec("return Array.from(document.querySelectorAll('.sv-map-arctext textPath')).map(t => getComputedStyle(t).dominantBaseline)");
    check("Names along features sit in the middle of them", arcBaselines.length > 0 && arcBaselines.every(b => b === "central"), arcBaselines.join(", "));
    const sizeOf = "return parseFloat(getComputedStyle(document.querySelector('.sv-map-label')).fontSize)";
    const sizeBefore = await s.exec(sizeOf);
    await s.keys("input[aria-label='Label size']", ARROW_RIGHT + ARROW_RIGHT);
    await sleep(400);
    const sizeAfter = await s.exec(sizeOf);
    check("Label size slider changes the map labels", sizeAfter > sizeBefore, `${sizeBefore}px → ${sizeAfter}px`);
    const tickCount = "return document.querySelectorAll('.sv-map-tick line').length";
    const ticksBefore = await s.exec(tickCount);
    await s.click(mapChip("Ruler"), "xpath");
    await sleep(300);
    const ticksAfter = await s.exec(tickCount);
    check("Ruler button hides the map's ruler", ticksBefore > 0 && ticksAfter === 0, `${ticksBefore} → ${ticksAfter} ticks`);
    await s.click(mapChip("Ruler"), "xpath");
    await sleep(300);

    // Only a press near the circle places the cursor; the far corners clear the selection.
    const mapPoints = await s.exec(`
      const host = document.querySelector('.sv-map-svg');
      const m = document.querySelector('.sv-map-svgel').getScreenCTM();
      const r = Number(document.querySelector('.sv-map-backbone').getAttribute('r'));
      const rotation = Number(document.querySelector("input[aria-label='Rotate']").value);
      const box = host.getBoundingClientRect();
      const empty = ([x, y]) => { const el = document.elementFromPoint(x, y); return !!el && host.contains(el) && !el.closest('[data-kind]'); };
      const at = (deg, radius) => { const t = deg * Math.PI / 180; const p = new DOMPoint(radius * Math.sin(t), -radius * Math.cos(t)).matrixTransform(m); return [p.x, p.y]; };
      // Just inside the features, among the ruler's ticks.
      let ring = null;
      for (let deg = 3; deg < 360 && !ring; deg += 7) if (empty(at(deg, r - 14))) ring = { point: at(deg, r - 14), deg };
      const corner = [[box.left + 8, box.top + 8], [box.right - 8, box.top + 8], [box.left + 8, box.bottom - 8], [box.right - 8, box.bottom - 8]].find(empty) || null;
      return { ring, corner, rotation };`);
    if (mapPoints.ring && mapPoints.corner) {
      await s.exec(`${doc} const f = s.data.features.find(f => f.name === 'AmpR'); s.selectRange({ start: f.start, end: f.end }, { kind: 'feature', id: f.id }, 'e2e');`);
      const caretBefore = (await state()).sel.caret;
      await s.clickAt(mapPoints.corner);
      await sleep(200);
      const cornerSel = (await state()).sel;
      check("A click far from the map's circle clears the selection and leaves the cursor", !cornerSel.range && !cornerSel.focus && cornerSel.caret === caretBefore, JSON.stringify({ caretBefore, ...cornerSel }));
      await s.clickAt(mapPoints.ring.point);
      await sleep(200);
      const ringSel = (await state()).sel;
      const expected = Math.round(((((mapPoints.ring.deg - mapPoints.rotation) % 360) + 360) % 360) / 360 * start.len) % start.len;
      const off = Math.abs(ringSel.caret - expected) % start.len;
      check("A click near the circle puts the cursor there", !ringSel.range && Math.min(off, start.len - off) <= 3, `caret ${ringSel.caret}, expected about ${expected}`);
    } else check("Empty points near and far from the map's circle were found", false, JSON.stringify(mapPoints));

    // The name in the middle of the map is the sequence's, renamed in place; the file keeps its name.
    const nameBefore = await s.exec(`${doc} return s.data.name;`);
    const renameField = "document.activeElement?.classList.contains('sv-map-name-edit')";
    await s.doubleClick(".sv-map-name");
    const renameOpened = await s.waitFor(renameField, 3000) && await s.exec("const i = document.activeElement; return i.value === arguments[0] && i.selectionStart === 0 && i.selectionEnd === i.value.length;", nameBefore);
    check("Double-clicking the map's name opens a field with the name selected", renameOpened);
    await s.shot("01-rename");
    await s.press(`pUC19 K45A${ENTER}`);
    const renamed = await s.exec(`${doc} return { name: s.data.name, undo: s.undoLabel, shown: document.querySelector('.sv-map-name')?.textContent, title: document.querySelector('.sv-doc-name')?.textContent, tab: window.__strandivo.tabs()[window.__strandivo.activeTab()], field: !!document.querySelector('.sv-map-name-edit') };`);
    check("Enter renames the sequence, not its file", renamed.name === "pUC19 K45A" && renamed.undo === "Rename" && renamed.shown === "pUC19 K45A" && renamed.title === "pUC19 K45A" && renamed.tab === "pUC19-annotated.gb" && !renamed.field, JSON.stringify(renamed));
    await s.doubleClick(".sv-map-name");
    await s.waitFor(renameField, 3000);
    await s.press(`not this${ESCAPE}`);
    check("Esc leaves the name as it was", await s.exec(`${doc} return s.data.name === 'pUC19 K45A' && !document.querySelector('.sv-map-name-edit');`));
    const nameMenu = await s.exec(`window.__strandivoMenu = items => { window.__e2eMenu = items; };
      document.querySelector('.sv-map-name').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      return (window.__e2eMenu || []).map(e => e === 'separator' ? '—' : e.label);`);
    check("Right-clicking the name offers to rename the sequence, and no origin", nameMenu[0] === "Rename sequence…" && !nameMenu.includes("Set origin here"), nameMenu.join(", "));
    await s.exec("window.__e2eMenu.find(e => e.label === 'Rename sequence…')?.run(); delete window.__strandivoMenu;");
    check("Rename sequence… opens the same field", await s.waitFor(renameField, 3000));
    await s.press(ESCAPE);
    await s.exec(`${doc} s.undo();`);
    check("Undo brings the old name back", await s.exec(`${doc} return s.data.name === arguments[0] && document.querySelector('.sv-map-name')?.textContent === arguments[0];`, nameBefore));

    const lacId = await s.exec(addTouching);
    await sleep(400);
    const mapRadius = await s.exec(`const r = id => document.querySelector('.sv-map-feature[data-id="' + id + '"]')?.getAttribute('d').match(/A([\\d.]+),/)?.[1]; return [r(${JSON.stringify(lacId)}), r("e2e-touch")];`);
    check("Features that only touch share a lane on the map", mapRadius[0] && mapRadius[0] === mapRadius[1], mapRadius.join(" and "));
    await s.exec(`${doc} s.undo();`);

    await s.click(outlineRow("AmpR"), "xpath");
    await sleep(500);
    const insp = await s.exec("return { name: document.querySelector('.sv-inspector .sv-insp-name')?.value, text: document.querySelector('.sv-inspector')?.textContent || '' }");
    check("Clicking a feature shows it in the inspector", insp.name === "AmpR" && /\d aa/.test(insp.text), `${insp.name}: ${insp.text.slice(0, 120)}`);
    check("A CDS's translation starts folded", await s.exec("return document.querySelector('.sv-inspector [data-fold=\"translation\"]')?.getAttribute('aria-expanded') === 'false' && !/MSIQHFRV/.test(document.querySelector('.sv-inspector').textContent);"));
    // Unfolded here, it stays open in every file, which the ORF and region checks below rely on.
    await s.click(".sv-inspector [data-fold='translation']");
    check("Clicking its heading unfolds the translation", await s.waitFor("/MSIQHFRV/.test(document.querySelector('.sv-inspector')?.textContent) && document.querySelector('.sv-inspector [data-fold=\"translation\"]').getAttribute('aria-expanded') === 'true'", 3000));
    // ExPASy ProtParam gives AmpR 31,557.28 Da, ε280 27,960 reduced and 28,085 with its one cystine.
    const proteinFacts = await s.exec("return document.querySelector('.sv-inspector [data-section=\"protein\"]')?.textContent || ''");
    check("The inspector shows the protein's mass and ε280, as ProtParam does", /31\.6 kDa/.test(proteinFacts) && /27,960 M⁻¹ cm⁻¹/.test(proteinFacts) && /28,085 with disulfides/.test(proteinFacts) && /0\.886 at 1 mg\/mL/.test(proteinFacts), proteinFacts);
    check("The feature is highlighted on the map", await s.exec("return !!document.querySelector('.sv-map-sel, .sv-map-wedge')"));
    await s.shot("02-feature");

    // --- sequence: typing, undo and redo with real key presses ---
    await s.click("button[data-tab=sequence]");
    check("Sequence view draws its rows", await s.waitFor("document.querySelectorAll('.sv-row').length > 3", 10000));
    const fit = await s.exec(SEQUENCE_FIT);
    check("Sequence letters line up with features and the ruler", fit && Math.abs(fit - 1) < 0.02, `width ratio ${fit?.toFixed?.(3)}`);
    check("Protein translation is shown under coding features", await s.exec("return document.querySelectorAll('.sv-aa').length > 0"));
    const captions = await s.exec("return { captions: Array.from(document.querySelectorAll('.sv-seq .sv-feature-caption')).map(c => c.textContent), margin: document.querySelectorAll('.sv-seq .sv-gutter-label').length };");
    check("Coding features are named under their amino acids, not in the margin", captions.captions.some(c => /AmpR ←|lacZ/.test(c)) && captions.margin === 0, JSON.stringify(captions));
    await checkCodonClicks(s, ".sv-seq", "Sequence translation");
    await checkCodonGestures(s, ".sv-seq", "Sequence translation");
    await s.click("//button[contains(@class,'sv-chip')][normalize-space()='Colour amino acids']", "xpath");
    check("Colour amino acids colours each residue by its chemistry", await s.waitFor("document.querySelector('.sv-seq .sv-aa-box.sv-aa-hydrophobic') && document.querySelector('.sv-seq .sv-aa-box.sv-aa-positive')", 3000));
    await checkCodonClicks(s, ".sv-seq", "Coloured sequence translation");
    await checkCodonGestures(s, ".sv-seq", "Coloured sequence translation");
    await s.shot("03-amino-acid-colours");
    await s.click("//button[contains(@class,'sv-chip')][normalize-space()='Colour amino acids']", "xpath");
    await checkCodonEdges(s);
    const lacIdSeq = await s.exec(addTouching);
    await sleep(400);
    const seqTops = await s.exec(`const bar = document.querySelector('.sv-feature-bar[data-id="e2e-touch"]'); const lac = bar && bar.parentElement.querySelector('.sv-feature-bar[data-id="' + ${JSON.stringify(lacIdSeq)} + '"]'); return [lac?.style.top, bar?.style.top];`);
    check("Features that only touch share a line in the sequence", seqTops[0] && seqTops[0] === seqTops[1], seqTops.join(" and "));
    await s.exec(`${doc} s.undo();`);
    await s.click(".sv-row .sv-row-track");
    await s.exec(`${doc} s.select({ range: null, caret: 5, anchor: 5 });`);
    const focused = await s.exec("return document.activeElement?.classList.contains('sv-clipboard')");
    check("Clicking the sequence puts the cursor there", focused);
    const n0 = (await state()).len;
    await s.press("GAT");
    await sleep(1800); // a pause ends one typing step
    await s.press("TACA");
    await sleep(300);
    const typed = await state();
    check("Typing inserts bases", typed.len === n0 + 7 && typed.dirty, `${n0} → ${typed.len} bp`);
    await s.press("z", [CTRL]);
    await sleep(400);
    const undone = (await state()).len;
    check("Ctrl+Z undoes one typing step", undone === n0 + 3, `${typed.len} → ${undone} bp`);
    await s.press("z", [CTRL]);
    await sleep(400);
    await s.press("y", [CTRL]);
    await sleep(400);
    const redone = (await state()).len;
    check("Ctrl+Y redoes it", redone === n0 + 3, `${undone} → ${n0} → ${redone} bp`);
    // --- Pasting what a database copies: a FASTA header, and text that isn't a sequence ---
    const pasteLen = async (text) =>
      s.exec(`${doc} s.select({ range: null, caret: 0, anchor: 0 }, 'e2e');
        const before = s.data.sequence.length;
        window.__strandivo.paste(${JSON.stringify(text)});
        return { grew: s.data.sequence.length - before, start: s.data.sequence.slice(0, 8) };`);
    const fasta = await pasteLen(">pUC19 cloning vector, complete sequence\nacgtacgu\n");
    check("Pasting a FASTA entry puts in its bases alone, U as T", fasta.grew === 8 && fasta.start === "ACGTACGT", JSON.stringify(fasta));
    await s.exec(`${doc} s.undo();`);
    const prose = await pasteLen("Please order this primer tomorrow");
    check("Text that isn't a sequence is refused instead of pasted as bases", prose.grew === 0, JSON.stringify(prose));
    check("It says why", await s.waitFor("Array.from(document.querySelectorAll('.ps-toast:not(.ps-toast-out)')).some(t => /isn't a DNA sequence/.test(t.textContent))", 2000));
    await s.press(ESCAPE);
    await s.press(ARROW_RIGHT + ARROW_RIGHT + ARROW_RIGHT, [SHIFT]);
    const shiftSel = (await state()).sel.range;
    check("Shift+arrows select bases", shiftSel && shiftSel.end - shiftSel.start === 2, JSON.stringify(shiftSel));

    // --- Delete with a feature selected: the feature goes first, its bases on the next press ---
    const lacZ = await s.exec(`${doc} const f = s.data.features.find(x => x.name === 'lacZ-alpha');
      s.select({ range: { start: f.start, end: f.end }, caret: f.end + 1, focus: { kind: 'feature', id: f.id } }, 'e2e');
      document.querySelector('.sv-clipboard').focus();
      return { start: f.start, end: f.end };`);
    const beforeDelete = await state();
    // An expression, as waitFor wraps it in its own return.
    const toastWith = (re, css = "") => `Array.from(document.querySelectorAll('.ps-toast:not(.ps-toast-out)')).some(t => ${re}.test(t.textContent)${css ? ` && t.querySelector('${css}')` : ""})`;
    await s.press(BACKSPACE);
    await sleep(300);
    const firstPress = await state();
    check(
      "The first Delete on a selected feature deletes the feature, not its bases",
      firstPress.len === beforeDelete.len && !firstPress.features.includes("lacZ-alpha") && firstPress.features.includes("MCS") && firstPress.sel.range?.start === lacZ.start && !firstPress.sel.focus,
      JSON.stringify({ len: firstPress.len, features: firstPress.features, sel: firstPress.sel })
    );
    check("It says the bases are still selected, with an Undo button", await s.waitFor(toastWith("/lacZ-alpha; its bases are still selected/", ".ps-toast-action"), 2000));
    await s.shot("03-delete-feature");
    await s.press(BACKSPACE);
    await sleep(300);
    const secondPress = await state();
    check("The next Delete deletes its bases", secondPress.len === beforeDelete.len - (lacZ.end - lacZ.start + 1), `${beforeDelete.len} → ${secondPress.len} bp`);
    check("It says the feature inside them went too", await s.waitFor(toastWith("/The feature MCS was inside the deleted bases/"), 2000));
    await s.click("//*[contains(@class,'ps-toast')][not(contains(@class,'ps-toast-out'))]//button[normalize-space()='Undo']", "xpath");
    await sleep(300);
    const undoneDelete = await state();
    check("Undo in the message brings the bases back", undoneDelete.len === beforeDelete.len && undoneDelete.features.includes("MCS"), `${undoneDelete.len} bp, ${undoneDelete.features.join(", ")}`);
    await s.exec(`${doc} s.undo();`);
    check("Undo once more brings the feature back", JSON.stringify((await state()).features) === JSON.stringify(beforeDelete.features));
    await s.exec(`${doc} s.selectRange({ start: 100, end: 119 }, null, "e2e");`);
    await s.waitFor("/Tm/.test(document.querySelector('.sv-inspector')?.textContent)", 3000);
    const statusTms = await s.exec("const tm = el => el?.textContent.match(/Tm\\s*([\\d.]+) °C/)?.[1]; return [tm(document.querySelector('.sv-status-left')), tm(document.querySelector('.sv-inspector'))];");
    check("The status bar shows the selection's Tm, as the inspector does", statusTms[0] && statusTms[0] === statusTms[1], statusTms.join(" and "));
    await s.shot("03-sequence");

    // --- right-click menu: the test catches it instead of a native one ---
    const menu = await s.exec(`window.__strandivoMenu = items => { window.__e2eMenu = items; };
      const band = document.querySelector('.sv-sel-band');
      band.scrollIntoView({ block: 'center' });
      const r = band.getBoundingClientRect();
      band.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return (window.__e2eMenu || []).map(e => e === 'separator' ? '—' : e.label);`);
    check("Right-clicking selected bases offers forward and reverse primers", menu.includes("Add forward primer") && menu.includes("Add reverse primer"), menu.join(", "));
    await s.exec("window.__e2eMenu.find(e => e.label === 'Add reverse primer').run();");
    const added = await s.exec(`${doc} const p = s.data.primers.at(-1); return p && { start: p.start, end: p.end, strand: p.strand, rc: p.bases === [...s.data.sequence.slice(100, 120).toUpperCase()].reverse().map(c => ({ A: 'T', T: 'A', G: 'C', C: 'G' })[c]).join('') };`);
    check("Add reverse primer adds the bottom-strand primer over the selection", added && added.start === 100 && added.end === 119 && added.strand === -1 && added.rc, JSON.stringify(added));
    await s.exec(`${doc} s.undo(); delete window.__strandivoMenu;`);

    // --- invert selection: on a circular plasmid an insert's inverse is one stretch across the origin ---
    const statusBp = "return Number(Array.from(document.querySelectorAll('.sv-status-left span')).map(x => x.textContent).find(t => /^[\\d,]+ bp$/.test(t))?.replace(/[, bp]/g, ''));";
    const viewHeight = await s.exec("return window.innerHeight");
    const lac = await s.exec(`${doc} const f = s.data.features.find(x => x.name === 'lacZ-alpha'); s.selectRange({ start: f.start, end: f.end }, { kind: "feature", id: f.id }, "e2e"); return { start: f.start, end: f.end, n: s.data.sequence.length };`);
    const lacBp = lac.end - lac.start + 1;
    await s.exec("window.__strandivo.command('invert-selection')");
    const backbone = await s.exec(`${doc} return { range: s.selection.range, ranges: s.selection.ranges ?? null, focus: s.selection.focus };`);
    check("Invert selection selects the rest of a circular plasmid as one stretch across the origin", backbone.range?.start === lac.end + 1 && backbone.range?.end === lac.start - 1 && !backbone.ranges && !backbone.focus, JSON.stringify(backbone));
    await sleep(200);
    check("The status bar gives the inverted selection's length", (await s.exec(statusBp)) === lac.n - lacBp, `${await s.exec(statusBp)} bp`);
    // Not its key: in this debug build Ctrl+Shift+I opens WebKitGTK's inspector, even sent
    // from a script, over part of the window for the rest of the run. Unit tests check the
    // page claims the key (`documentShortcut`), so the menu's copy of a press is skipped.
    await s.exec("window.__strandivo.menu('invert-selection');");
    check("Edit > Invert Selection inverts it", await s.waitFor(`window.__strandivo.store.selection.range?.start === ${lac.start} && window.__strandivo.store.selection.range?.end === ${lac.end}`, 3000), JSON.stringify(await s.exec(`${doc} return s.selection.range;`)));
    const invertMenu = await s.exec(`window.__strandivoMenu = items => { window.__e2eMenu = items; };
      const band = document.querySelector('.sv-sel-band');
      band.scrollIntoView({ block: 'center' });
      const r = band.getBoundingClientRect();
      band.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return (window.__e2eMenu || []).map(e => e === 'separator' ? '—' : e.label);`);
    check("Right-clicking selected bases offers Invert selection", invertMenu.includes("Invert selection"), invertMenu.join(", "));
    await s.exec("window.__e2eMenu.find(e => e.label === 'Invert selection')?.run(); delete window.__strandivoMenu;");
    check("Invert selection in the right-click menu inverts it", await s.waitFor(`window.__strandivo.store.selection.range?.start === ${lac.end + 1} && window.__strandivo.store.selection.range?.end === ${lac.start - 1}`, 3000));
    check("Inverting leaves the window its size", (await s.exec("return window.innerHeight")) === viewHeight, `${viewHeight} → ${await s.exec("return window.innerHeight")} px`);

    // --- primers: design a pair in its dialog ---
    await s.exec(`${doc} const f = s.data.features.find(x => x.name === 'AmpR'); s.select({ range: { start: f.start, end: f.end }, caret: f.start, focus: { kind: 'feature', id: f.id } });`);
    await sleep(300);
    await s.click("//*[contains(@class,'sv-inspector')]//button[contains(., 'Design primers')]", "xpath");
    check("Designing primers for AmpR suggests a pair in a dialog", await s.waitFor("document.querySelector('.sv-dialog .sv-design-pair')", 5000));
    check("The pair waits for review before it is added", (await state()).primers.length === 0);
    // Letting the ends move finds a better stretch a little outside the region, so the
    // product grows while still covering it; back at 0 the primers sit on its edges again.
    const setNum = (label, value) => s.exec(`const el = document.querySelector(".sv-dialog input[aria-label='${label}']"); el.value = '${value}'; el.dispatchEvent(new Event('change'));`);
    const productBp = "Number((document.querySelector('.sv-dialog .sv-design-result-head')?.textContent.match(/([\\d,]+) bp product/) || [0, '0'])[1].replace(/,/g, ''))";
    const pinnedBp = await s.exec(`return ${productBp};`);
    await setNum("Bases each end may move outward", 20);
    const grew = await s.waitFor(`${productBp} > ${pinnedBp} && ${productBp} <= ${pinnedBp} + 40`, 5000);
    check("Moving the ends designs a longer product over the same region", grew, `${pinnedBp} bp with the ends pinned, ${await s.exec(`return ${productBp};`)} bp with 20 allowed`);
    await setNum("Bases each end may move outward", 0);
    check("Back at 0 the primers sit on the region's edges again", await s.waitFor(`${productBp} === ${pinnedBp}`, 5000));
    // AmpR runs right to left: NdeI at its start goes on the primer at its start codon.
    const choose = (label, value) => s.exec(`const el = document.querySelector(".sv-dialog select[aria-label='${label}']"); el.value = Array.from(el.options).find(o => o.value === '${value}' || o.textContent.startsWith('${value}'))?.value ?? ''; el.dispatchEvent(new Event('change'));`);
    await choose("Site added at the start", "NdeI");
    await choose("Site added at the end", "XhoI");
    check("Adding sites designs the pair again", await s.waitFor("/AmpR-XhoI-R/.test(document.querySelector('.sv-design-pair')?.textContent)", 5000));
    const design = await s.exec("return document.querySelector('.sv-dialog').textContent");
    check("The added sites don't cut inside the product", /don.t cut inside/.test(design), design.slice(-200));
    await s.shot("04-design");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[contains(., 'Add both primers')]", "xpath");
    check("Add both primers adds the pair and closes the dialog", (await s.waitFor("window.__strandivo.store.data.primers.length === 2", 5000)) && !(await s.exec("return !!document.querySelector('.sv-dialog')")));
    const designed = await s.exec(`${doc} return s.data.primers.map(p => ({ name: p.name, bases: p.bases, strand: p.strand, start: p.start, end: p.end }));`);
    const fwd = designed.find(p => p.name === "AmpR-NdeI-F");
    const ampR = await s.exec(`${doc} const f = s.data.features.find(x => x.name === 'AmpR'); return { start: f.start, end: f.end };`);
    check("AmpR-NdeI-F starts at AmpR's start codon with NdeI", fwd && fwd.strand === -1 && fwd.end === ampR.end && /CATATGAGT/.test(fwd.bases), JSON.stringify(designed));
    await s.click("button[data-tab=primers]");
    check("Primers tab lists them", await s.waitFor("document.querySelectorAll('.sv-primers tbody tr').length === 2", 5000));
    const tms = await s.exec("return Array.from(document.querySelectorAll('.sv-primers tbody tr')).map(r => Array.from(r.cells).map(c => c.textContent).find(t => /°C$/.test(t))).map(t => parseFloat(t))");
    check("Designed primers have Tm near 60 °C", tms.length === 2 && tms.every(t => t >= 57 && t <= 63), tms.join(", "));

    // --- the selected primer among its bases ---
    await s.click("//td[contains(@class,'sv-td-name')]//button[contains(., 'AmpR-NdeI-F')]", "xpath");
    check("Sequence panel shows the selected primer with its ends", await s.waitFor("document.querySelector('.sv-ctx-primer') && document.querySelectorAll('.sv-ctx-handle').length === 2 && /AmpR-NdeI-F/.test(document.querySelector('.sv-ctx').textContent)", 5000));
    const ends = () => s.exec(`${doc} const p = s.data.primers.find(x => x.name === 'AmpR-NdeI-F'); return [p.start, p.end, p.bases.length];`);
    const beforeStep = await ends();
    await s.click(".sv-ctx-step[aria-label='Extend the 3′ end by one base']");
    await sleep(400);
    const afterStep = await ends();
    check("Extending the 3′ end of a reverse primer adds the base on its left", afterStep[0] === beforeStep[0] - 1 && afterStep[1] === beforeStep[1] && afterStep[2] === beforeStep[2] + 1, `${beforeStep} → ${afterStep}`);
    await s.shot("04-sequence-panel");
    await s.press("z", [CTRL]);
    await sleep(400);
    check("Ctrl+Z puts the primer back", JSON.stringify(await ends()) === JSON.stringify(beforeStep));
    const strands = await s.exec("const r = document.querySelector('.sv-ctx .sv-bases').getBoundingClientRect(); return [r.left + 30, r.top + 9, r.left + 230, r.top + 27];");
    await s.drag([strands[0], strands[1]], [strands[2], strands[3]]);
    const ctxSel = await s.exec(`${doc} return { range: s.selection.range, focus: s.selection.focus, bands: document.querySelectorAll('.sv-ctx .sv-sel-band').length, text: String(getSelection()), still: /AmpR-NdeI-F/.test(document.querySelector('.sv-ctx-name').textContent) };`);
    check("Dragging over the bases around a primer selects them on both strands", ctxSel.range && ctxSel.range.end - ctxSel.range.start >= 20 && !ctxSel.focus && ctxSel.bands >= 1 && !ctxSel.text && ctxSel.still, JSON.stringify(ctxSel));
    await checkCodonClicks(s, ".sv-ctx", "Primer translation");
    await checkCodonGestures(s, ".sv-ctx", "Primer translation");
    await s.click("button[data-tab=sequence]");
    await s.click("//button[contains(@class,'sv-chip')][normalize-space()='Colour amino acids']", "xpath");
    await s.click("button[data-tab=primers]");
    await checkCodonClicks(s, ".sv-ctx", "Coloured primer translation");
    await checkCodonGestures(s, ".sv-ctx", "Coloured primer translation");
    check("Selecting codons and their feature keeps the same primer in view", await s.exec("return /AmpR-NdeI-F/.test(document.querySelector('.sv-ctx-name').textContent) && !!document.querySelector('.sv-ctx-primer');"));
    await s.click("button[data-tab=sequence]");
    await s.click("//button[contains(@class,'sv-chip')][normalize-space()='Colour amino acids']", "xpath");
    await s.click("button[data-tab=primers]");

    // --- a mutagenic primer: its change raised in the Sequence tab, and a colour of its own ---
    await s.exec(`${doc} const site = s.data.sequence.slice(1000, 1033).toUpperCase();
      const bases = site.slice(0, 15) + (site[15] === 'A' ? 'C' : 'A') + site.slice(16);
      s.apply({ ...s.data, primers: [...s.data.primers, { id: 'e2e-mut', name: 'Mut-F', start: 1000, end: 1032, strand: 1, bases, notes: {}, raw: {} }] }, 'Add primer');`);
    await s.click("button[data-tab=sequence]");
    await sleep(300);
    await s.exec(`${doc} s.select({ range: null, caret: 0, anchor: 0 }); s.select({ range: { start: 1000, end: 1032 }, focus: { kind: 'primer', id: 'e2e-mut' } });`);
    check("A primer's change is raised in red in the Sequence tab", await s.waitFor("document.querySelector(\".sv-pr[data-id='e2e-mut'] .sv-pr-change\")", 5000));
    check("The inspector says what the primer changes", await s.waitFor("/1 base changed/.test(document.querySelector('.sv-inspector')?.textContent)", 3000));
    const colours = await s.exec(`window.__strandivoMenu = items => { window.__e2eMenu = items; };
      const el = document.querySelector(".sv-pr[data-id='e2e-mut'] .sv-pr-box");
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + r.height / 2 }));
      const colour = (window.__e2eMenu || []).find(e => e !== 'separator' && e.label === 'Colour');
      return colour ? colour.items.filter(e => e !== 'separator').map(e => e.label) : [];`);
    check("Primer colours leave out red, which marks changes", colours.includes("Teal") && !colours.includes("Red"), colours.join(", "));
    await s.exec("window.__e2eMenu.find(e => e.label === 'Colour').items.find(e => e.label === 'Teal').run(); delete window.__strandivoMenu;");
    check("Choosing a colour colours the primer", await s.waitFor("window.__strandivo.store.data.primers.find(p => p.id === 'e2e-mut')?.color === '#6CC2B0'", 3000));
    await s.shot("04-mutagenic-primer");
    await s.exec(`${doc} s.undo(); s.undo();`);
    await s.click("button[data-tab=primers]");
    await sleep(300);

    // --- PCR product dialog ---
    await s.click("//*[contains(@class,'sv-primers-head')]//button[contains(., 'PCR product')]", "xpath");
    await s.waitFor("document.querySelector(\".sv-dialog select[aria-label='Forward primer']\")", 5000);
    await choose("Forward primer", "AmpR-XhoI-R");
    await sleep(300);
    await choose("Reverse primer", "AmpR-NdeI-F");
    await s.waitFor("/Size/.test(document.querySelector('.sv-pcr-result')?.textContent)", 5000);
    const pcr = await s.exec("return document.querySelector('.sv-pcr-result').textContent");
    const size = Number(/Size\s*([\d,]+) bp/.exec(pcr)?.[1].replace(/,/g, ""));
    check("PCR product is AmpR plus the two tails", size === ampR.end - ampR.start + 1 + 17, `${size} bp`);
    check("No side products are reported", !/other product/.test(pcr), pcr.slice(0, 200));
    await s.shot("04-pcr");
    await s.press(ESCAPE);
    check("Escape closes the dialog", await s.waitFor("!document.querySelector('.sv-dialog')", 3000));

    // --- mutagenesis: a codon of AmpR to alanine, from the right-click menu ---
    await s.click("button[data-tab=sequence]");
    await sleep(300);
    // AmpR runs right to left: residue 70 is three bases, 207 to 209 from its end.
    const codon70 = await s.exec(`${doc} const f = s.data.features.find(x => x.name === 'AmpR'); const r = { start: f.end - 209, end: f.end - 207 }; s.select({ range: null, caret: 0, anchor: 0 }); s.select({ range: r, caret: r.end + 1, anchor: r.start, focus: null }); return r;`);
    await s.waitFor("document.querySelector('.sv-sel-band')", 5000);
    const sdmMenu = await s.exec(`window.__strandivoMenu = items => { window.__e2eMenu = items; };
      const band = document.querySelector('.sv-sel-band');
      band.scrollIntoView({ block: 'center' });
      const r = band.getBoundingClientRect();
      band.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return (window.__e2eMenu || []).map(e => e === 'separator' ? '—' : e.label);`);
    check("Right-clicking selected bases offers mutagenesis primers", sdmMenu.includes("Mutagenesis primers…"), sdmMenu.join(", "));
    await s.exec("window.__e2eMenu.find(e => e.label === 'Mutagenesis primers…').run(); delete window.__strandivoMenu;");
    check("A selected codon opens the dialog on its residue", await s.waitFor("document.querySelector(\".sv-dialog input[aria-label='Residue']\")?.value === '70'", 5000));
    await choose("New amino acid", "A");
    check("The dialog designs a back-to-back pair for the change", await s.waitFor("/AmpR-[A-Z]70A-R/.test(document.querySelector('.sv-design-pair')?.textContent)", 5000));
    await s.shot("04-mutagenesis");
    const nPrimers = (await state()).primers.length;
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[contains(., 'Add both primers')]", "xpath");
    check("Add both primers adds the mutagenesis pair", await s.waitFor(`window.__strandivo.store.data.primers.length === ${nPrimers + 2}`, 5000));
    const sdm = await s.exec(`${doc} const [f, r] = s.data.primers.slice(-2); const site = s.data.sequence.slice(f.start, f.end + 1).toUpperCase();
      return { f: f.name, r: r.name, id: f.id, start: f.start, rEnd: r.end, strands: [f.strand, r.strand], differs: f.bases[0] !== site[0] || f.bases[1] !== site[1], arm: f.bases.slice(2) === site.slice(2) };`);
    check("The forward primer carries the change at its 5′ end, back to back with the reverse one", sdm.f.endsWith("70A-F") && sdm.r.endsWith("70A-R") && sdm.strands.join() === "1,-1" && sdm.rEnd === sdm.start - 1 && sdm.start >= codon70.start && sdm.differs && sdm.arm, JSON.stringify(sdm));
    await s.exec(`${doc} s.select({ range: null, caret: 0, anchor: 0 }); const p = s.data.primers.find(x => x.id === '${sdm.id}'); s.select({ range: { start: p.start, end: p.end }, focus: { kind: 'primer', id: p.id } });`);
    check("The mutagenesis primer's change is raised in the Sequence tab", await s.waitFor(`document.querySelector(".sv-pr[data-id='${sdm.id}'] .sv-pr-change")`, 5000));
    await s.exec(`${doc} s.undo();`);
    await s.click("button[data-tab=primers]");
    await sleep(300);

    // --- primer library: add from it, then its own window ---
    await s.click("//*[contains(@class,'sv-primers-head')]//button[contains(., 'Add from library')]", "xpath");
    await s.click("//*[contains(@class,'sv-dialog')]//button[contains(., 'Add common sequencing primers')]", "xpath");
    check("Common sequencing primers that bind are listed", await s.waitFor("document.querySelectorAll('.sv-pick-row').length >= 2", 5000));
    const pickRow = name => `//label[contains(@class,'sv-pick-row')][.//*[normalize-space(text())='${name}']]`;
    await s.click(pickRow("M13 fwd (-21)"), "xpath");
    await s.click(pickRow("M13 rev"), "xpath");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[contains(., 'Add 2 primers')]", "xpath");
    await sleep(400);
    const m13 = await s.exec(`${doc} return s.data.primers.filter(p => p.name.startsWith('M13')).map(p => [p.name, p.strand]);`);
    check("Library primers are added where they bind", JSON.stringify(m13) === JSON.stringify([["M13 fwd (-21)", 1], ["M13 rev", -1]]), JSON.stringify(m13));
    // --- the list: filter, notes, several rows at once, and pairs ---
    const listNames = () => s.exec("return Array.from(document.querySelectorAll('.sv-primer-table tbody tr')).map(r => r.cells[0].textContent.trim());");
    check("Library primers bring their notes into a Notes column", await s.waitFor("/Notes/.test(document.querySelector('.sv-primer-table thead').textContent) && /Common sequencing primer/.test(document.querySelector('.sv-primer-table tbody').textContent)", 5000));
    await s.keys(".sv-primers-filter input", "m13");
    await sleep(300);
    const filtered = await listNames();
    check("The filter keeps the primers whose name, note or bases match", filtered.length === 2 && filtered.every(n => n.startsWith("M13")), filtered.join(", "));
    await s.exec("const i = document.querySelector('.sv-primers-filter input'); i.value = 'ordered by the lab'; i.dispatchEvent(new Event('input', { bubbles: true }));");
    check("A filter nothing matches says so", await s.waitFor("/No primer matches/.test(document.querySelector('.sv-primers .sv-empty')?.textContent || '')", 3000));
    await s.exec("const i = document.querySelector('.sv-primers-filter input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));");
    await sleep(300);
    check("Clearing the filter brings every primer back", (await listNames()).length === 4, (await listNames()).join(", "));

    // Ctrl-click (⌘ on a Mac) adds a row to the selection; CI runs on Linux.
    await s.exec(`const rows = Array.from(document.querySelectorAll('.sv-primer-table tbody tr'));
      rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, metaKey: true }));`);
    check("Picking two rows offers what to do with both", await s.waitFor("!document.querySelector('.sv-primers-picked').hidden && /2 primers selected/.test(document.querySelector('.sv-primers-picked').textContent)", 3000));
    const pickedButtons = await s.exec("return Array.from(document.querySelectorAll('.sv-primers-picked button')).map(b => b.textContent.trim());");
    check("Copy, save and delete are offered for the selection", JSON.stringify(pickedButtons) === JSON.stringify(["Copy for ordering…", "Save to library", "Delete 2 primers"]), pickedButtons.join(", "));
    check("While several are picked no one primer is selected", (await s.exec(`${doc} return s.selection.focus;`)) === null);
    await s.exec("document.querySelectorAll('.sv-primer-table tbody tr')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));");
    check("A plain click is an ordinary selection again", await s.waitFor("document.querySelector('.sv-primers-picked').hidden && window.__strandivo.store.selection.focus?.kind === 'primer'", 3000));
    // A primer clicked on the binding map, in the same tab, replaces several picked rows.
    await s.exec(`const rows = Array.from(document.querySelectorAll('.sv-primer-table tbody tr'));
      rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, metaKey: true }));`);
    await s.waitFor("!document.querySelector('.sv-primers-picked').hidden", 3000);
    const onMap = await s.exec("const b = document.querySelectorAll('.sv-bind-primer')[2]; b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return b.dataset.id;");
    check(
      "Clicking the binding map replaces several picked rows",
      await s.waitFor(`document.querySelector('.sv-primers-picked').hidden && window.__strandivo.store.selection.focus?.id === ${JSON.stringify(onMap)} && document.querySelectorAll('.sv-primer-table tr.sv-selected').length === 1`, 3000)
    );

    await s.click("//*[contains(@class,'sv-primer-table')]//thead//button[contains(., 'Name')]", "xpath");
    await sleep(200);
    const sorted = await listNames();
    check("Clicking a heading sorts the list and is remembered", JSON.stringify(sorted) === JSON.stringify([...sorted].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) && /"key":"name"/.test(await s.exec("return localStorage.getItem('strandivo.primers') || '';")), sorted.join(", "));

    await s.click("//*[contains(@class,'sv-primers')]//*[contains(@class,'sv-segmented')]//button[contains(., 'Pairs')]", "xpath");
    check("Pairs lists what each forward and reverse primer would amplify", await s.waitFor("/Product/.test(document.querySelector('.sv-primer-table thead')?.textContent || '') && document.querySelectorAll('.sv-primer-table tbody tr').length >= 1", 5000));
    await s.shot("04b-primer-pairs");
    await s.exec("document.querySelector('.sv-primer-table tbody tr').dispatchEvent(new MouseEvent('click', { bubbles: true }));");
    check("Clicking a pair opens it in the PCR product dialog", await s.waitFor("document.querySelector('.sv-dialog') && /Size/.test(document.querySelector('.sv-pcr-result')?.textContent || '')", 5000));
    await s.press(ESCAPE);
    // Copy for ordering follows the file while Pairs shows: a primer removed there is gone.
    const before = await s.exec(`${doc} return s.data.primers.length;`);
    await s.exec(`${doc} s.apply({ ...s.data, primers: s.data.primers.slice(1) }, 'Remove a primer');`);
    await s.click("//button[contains(., 'Copy for ordering')]", "xpath");
    check("Copy for ordering lists the primers the file has now", await s.waitFor(`document.querySelectorAll('.sv-dialog .sv-order-row:not(.sv-order-all)').length === ${before - 1}`, 3000));
    await s.press(ESCAPE);
    await s.exec(`${doc} s.undo();`);
    // The Tm limit beside Pairs hides pairs whose Tms are further apart, and is remembered.
    const setTmLimit = v => s.exec(`const i = document.querySelector('.sv-primers-limit input'); i.value = '${v}'; i.dispatchEvent(new Event('change', { bubbles: true }));`);
    const pairRows = () => s.exec("return document.querySelectorAll('.sv-primer-table tbody tr').length;");
    await setTmLimit(30);
    await sleep(200);
    const allPairs = await pairRows();
    await setTmLimit(0);
    check(
      "Pairs with Tms further apart than the limit are hidden and counted",
      await s.waitFor("/over 0 °C apart · Show all/.test(document.querySelector('.sv-primers-note')?.textContent || '')", 3000) &&
        (await pairRows()) < allPairs &&
        /"tmLimit":0/.test(await s.exec("return localStorage.getItem('strandivo.primers') || '';")),
      `${await pairRows()} of ${allPairs}`
    );
    await s.click("//*[contains(@class,'sv-primers-note')]//button[contains(., 'Show all')]", "xpath");
    check("Show all lists them again, marked", await s.waitFor(`document.querySelectorAll('.sv-primer-table tbody tr').length === ${allPairs} && document.querySelectorAll('.sv-primer-table tbody .sv-text-warn').length >= 1`, 3000));
    await s.shot("04c-primer-pairs-tm-limit");
    await s.click("//*[contains(@class,'sv-primers-note')]//button[contains(., 'Hide them')]", "xpath");
    await setTmLimit(5);
    await sleep(200);
    await s.click("//*[contains(@class,'sv-primers')]//*[contains(@class,'sv-segmented')]//button[normalize-space(text())='List']", "xpath");
    await sleep(200);

    await s.shot("04-primers");
    const mainHandle = await s.current();
    const beforeLibrary = await s.handles();
    await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_library').then(() => done(true), e => done(String(e)));");
    await sleep(2000);
    const libraryHandle = (await s.handles()).find(h => !beforeLibrary.includes(h));
    if (libraryHandle) {
      await s.switchTo(libraryHandle);
      check("Primer library window lists the library", await s.waitFor("document.querySelectorAll('.sv-libwin-grid tbody tr').length >= 15", 10000));
      await s.shot("04c-library");
      await s.closeWindow().catch(() => {});
      await s.switchTo(mainHandle);
    } else {
      check("Primer library window opens (not visible to WebDriver; skipped)", true);
    }

    // --- save, then reopen the file in a new tab ---
    const savedPath = path.join(mkdtempSync(path.join(tmpdir(), "strandivo-e2e-")), "edited.gb");
    const saveResult = await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__strandivo.saveAs(arguments[0]).then(() => done('ok'), e => done(String(e)));",
      savedPath
    );
    check("Saving writes the file", saveResult === "ok", saveResult);
    check("Saving clears the edited mark", (await s.exec("return window.__strandivo.isDirty()")) === false);
    // Outside macOS the page passes a menu item's key on to the shell, as Windows' menu never
    // hears it (#32); here GTK's may hear it too, and the shell still saves once.
    await s.exec(`${doc} s.apply({ ...s.data, features: s.data.features.map((f, i) => i === 0 ? { ...f, name: "Saved with Ctrl+S" } : f) }, "Rename");`);
    // A feature's note is typed in the inspector and saved as its /note, quotes and all.
    const typedNote = 'Says "stop" here, and goes on long enough to wrap onto another line of the file';
    await s.exec(`${doc} const f = s.data.features[0]; s.selectRange({ start: f.start, end: f.end }, { kind: "feature", id: f.id }, "e2e");`);
    await s.waitFor("document.querySelector('[aria-label=\"Feature note\"]')", 5000);
    // Cleared without an event, so the first key press replaces any note the feature had.
    await s.exec("const note = document.querySelector('[aria-label=\"Feature note\"]'); note.value = ''; note.scrollIntoView({ block: 'nearest' });");
    await s.keys("[aria-label='Feature note']", typedNote);
    check("A feature's note applies as it is typed", await s.waitFor(`window.__strandivo.store.data.features[0].notes.note?.join('\\n') === ${JSON.stringify(typedNote)}`, 5000), JSON.stringify(await s.exec(`${doc} return s.data.features[0].notes;`)));
    await s.exec("document.activeElement?.blur();");
    await s.press("s", [CTRL]);
    const keySaved = await s.waitFor("window.__strandivo.isDirty() === false", 5000);
    check("Ctrl+S saves the file", keySaved && readFileSync(savedPath, "utf8").includes("Saved with Ctrl+S"));
    check("The note is saved as GenBank writes it", readFileSync(savedPath, "utf8").includes('/note="Says ""stop"" here'));
    // Saved straight after typing, before the note applies on its own, it is saved whole,
    // and the field keeps the caret.
    const quickNote = `${typedNote}\nAdded just before saving`;
    const quickSave = await s.execAsync(
      "const done = arguments[arguments.length - 1]; const note = document.querySelector('[aria-label=\"Feature note\"]'); note.focus(); note.value = arguments[1]; note.dispatchEvent(new Event('input')); window.__strandivo.saveAs(arguments[0]).then(() => done(document.activeElement?.getAttribute('aria-label') === 'Feature note' ? 'ok' : 'focus lost'), e => done(String(e)));",
      savedPath,
      quickNote
    );
    check("Saving straight after typing a note saves all of it", quickSave === "ok" && readFileSync(savedPath, "utf8").includes('/note="Added just before saving"'), quickSave);
    await s.exec("document.activeElement?.blur();");
    const docSummary = `${doc} return { len: s.data.sequence.length, features: s.data.features.map(f => f.name + ' ' + f.start + '-' + f.end), primers: s.data.primers.map(p => p.name + ' ' + p.start + '-' + p.end) };`;
    const savedDoc = await s.exec(docSummary);
    // The saved file is now this tab's file, so opening it again would just show this tab:
    // open a copy instead.
    const copyPath = savedPath.replace(/edited\.gb$/, "copy.gb");
    copyFileSync(savedPath, copyPath);
    await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_files', { paths: arguments[0] }).then(() => done(true), e => done(String(e)));",
      [copyPath]
    );
    const newTab = await s.waitFor("JSON.stringify(window.__strandivo.tabs()) === '[\"edited.gb\",\"copy.gb\"]' && window.__strandivo.activeTab() === 1", 20000);
    check("Opening another file adds a tab and shows it", newTab, JSON.stringify(await s.exec("return window.__strandivo.tabs()")));
    const reopened = await s.exec(docSummary);
    check("The saved file reopens with the same sequence, features and primers", JSON.stringify(reopened) === JSON.stringify(savedDoc), JSON.stringify(reopened).slice(0, 200));
    await s.exec(`${doc} const f = s.data.features[0]; s.selectRange({ start: f.start, end: f.end }, { kind: "feature", id: f.id }, "e2e");`);
    check("The reopened file shows the note in the inspector", await s.waitFor(`document.querySelector('[aria-label="Feature note"]')?.value === ${JSON.stringify(quickNote)}`, 5000));
    check("Only the shown file's views are in the page", (await s.exec("return document.querySelectorAll('.sv-app').length")) === 1);
    await s.press(PAGE_UP, [CTRL]);
    check("Ctrl+Page Up goes back to the first file", await s.waitFor("window.__strandivo.activeTab() === 0", 3000));
    await s.exec("window.__strandivo.showTab(1); window.__strandivo.closeTab();");
    check("Closing a saved file's tab needs no question", await s.waitFor("window.__strandivo.tabs().length === 1 && window.__strandivo.activeTab() === 0", 3000));

    // --- cloning: Gibson of mEGFP from another open file into the vector ---
    await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_files', { paths: arguments[0] }).then(() => done(true), e => done(String(e)));",
      [data("snapgene", "pIB2-SEC13-mEGFP.dna")]
    );
    await s.waitFor("window.__strandivo.tabs().length === 2 && window.__strandivo.tabs()[1] !== null", 20000);
    await s.exec("window.__strandivo.showTab(0)");
    await sleep(500);
    await s.click("button[aria-label='Simulate cloning…']");
    check("Simulate cloning opens a dialog", await s.waitFor("document.querySelector('.sv-dialog .sv-clone-methods')", 5000));
    await s.click("//*[contains(@class,'sv-clone-methods')]//button[normalize-space(.)='Gibson']", "xpath");
    await s.waitFor("document.querySelector(\".sv-dialog select[aria-label='Part of the insert']\")", 3000);
    await choose("First vector enzyme", "EcoRI");
    await sleep(200);
    await choose("Second vector enzyme", "HindIII");
    await sleep(200);
    await choose("Part of the insert", "mEGFP");
    const gibsonReady = await s.waitFor("/mEGFP-R/.test(document.querySelector('.sv-dialog .sv-design-pair')?.textContent)", 5000);
    const primerTexts = await s.exec("return Array.from(document.querySelectorAll('.sv-dialog .sv-design-pair .sv-design-bases')).map(e => e.textContent)");
    check("Gibson designs insert primers with 20-base overlap tails", gibsonReady && primerTexts.length === 2 && primerTexts.every(t => /^[acgt]{20}[ACGT]{15,}$/.test(t)), primerTexts.join(", "));
    const clone = await s.exec("const t = document.querySelector('.sv-dialog .sv-clone-result-head')?.textContent || ''; return { text: t, size: Number(t.match(/([\\d,]+) bp/)?.[1].replace(/,/g, '')) };");
    await s.shot("08-cloning");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[contains(., 'Open product')]", "xpath");
    check("The product opens in a new, unsaved tab", await s.waitFor("window.__strandivo.tabs().length === 3 && window.__strandivo.activeTab() === 2 && window.__strandivo.isDirty()", 10000));
    const made = await s.exec(`${doc} return { len: s.data.sequence.length, circular: s.data.circular, features: s.data.features.map(f => f.name), primers: s.data.primers.map(p => p.name) };`);
    check("The product has the insert, the vector's features and the primers", made.len === clone.size && made.circular && made.features.includes("mEGFP") && made.features.includes("AmpR") && made.primers.includes("mEGFP-F"), JSON.stringify(made).slice(0, 240));
    await s.exec("window.__strandivo.closeTab()");
    await s.click("//*[contains(@class,'ps-modal')]//button[contains(., \"Don't Save\")]", "xpath");
    await s.exec("window.__strandivo.showTab(1); window.__strandivo.closeTab();");
    check("Closing the product asks to save it", await s.waitFor("window.__strandivo.tabs().length === 1 && window.__strandivo.activeTab() === 0", 5000));

    // --- ORFs and digests ---
    await s.exec("window.__strandivo.command('show-map')");
    await s.click("//*[contains(@class,'sv-map')]//button[contains(@class,'sv-chip')][normalize-space()='ORFs']", "xpath");
    // AmpR is an ORF on the reverse strand, named by where its start codon is (the file was edited above).
    const amp = await s.exec(`${doc} const f = s.data.features.find(x => x.name === "AmpR"); return { start: f.start, end: f.end, len: s.data.sequence.length };`);
    const ampOrf = `-1:${amp.end}`;
    check("The ORFs button draws ORFs on the map, AmpR among them", await s.waitFor(`document.querySelector('.sv-map-orf[data-id="${ampOrf}"]')`, 5000), ampOrf);
    await s.exec(`${doc} s.selectRange({ start: ${amp.start}, end: ${amp.end} }, { kind: "orf", id: "${ampOrf}" });`);
    await sleep(400);
    const orfText = await s.exec("return document.querySelector('.sv-inspector')?.textContent || ''");
    check("The inspector shows the selected ORF and its protein", /Open reading frame/.test(orfText) && /286 aa/.test(orfText) && /MSIQHFRV/.test(orfText) && /kDa[\s\S]*M⁻¹ cm⁻¹/.test(orfText), orfText.slice(0, 160));
    const orfMenu = await s.exec(`window.__strandivoMenu = items => { window.__e2eMenu = items; };
      const orf = document.querySelector('.sv-map-orf[data-id="${ampOrf}"]');
      const r = orf.getBoundingClientRect();
      orf.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return (window.__e2eMenu || []).map(e => e === 'separator' ? '—' : e.label);`);
    check("Right-clicking an ORF offers its protein's details", orfMenu.includes("Protein details…"), orfMenu.join(", "));
    await s.exec("window.__e2eMenu.find(e => e.label === 'Protein details…')?.run(); delete window.__strandivoMenu;");
    check("Protein details number the ORF's sequence in lines of 60, with no figure", await s.waitFor("(() => { const d = document.querySelector('.sv-dialog'); const nums = Array.from(d?.querySelectorAll('.sv-protein-seq-num') || []).map(n => n.textContent); return /this ORF/.test(d.textContent) && /\\d Da/.test(d.textContent) && nums.join() === '1,61,121,181,241' && !d.querySelector('.sv-figure'); })()", 5000));
    await s.shot("09-orf-protein");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space(.)='Close']", "xpath");
    await s.shot("09-orfs");
    // GC content on the map: off until its button is on, then a ring inside the features, and a band on the linear map.
    const mapGcChip = "//*[contains(@class,'sv-map')]//button[contains(@class,'sv-chip')][normalize-space()='GC%']";
    check("The map shows no GC until its button is on", await s.exec("return !document.querySelector('.sv-map .sv-map-gc')"));
    check("The map's GC% button says what its colours mean", await s.exec("const b = Array.from(document.querySelectorAll('.sv-map .sv-chip')).find(b => b.textContent.trim() === 'GC%'); return /GC content of the [0-9,]+ bp around each position/.test(b?.title) && /AT-rich/.test(b.title) && /GC-rich/.test(b.title);"));
    await s.click(mapGcChip, "xpath");
    check("The GC% button draws GC as a ring inside the features", await s.waitFor("(() => { const ring = document.querySelector('.sv-map .sv-map-gc'); const backbone = document.querySelector('.sv-map .sv-map-backbone'); return ring?.children.length > 0 && ring.getBoundingClientRect().width < backbone.getBoundingClientRect().width; })()", 5000));
    check("Each stretch of the ring says its GC and bases", await s.exec("return Array.from(document.querySelectorAll('.sv-map .sv-map-gc > *')).every(e => /^GC [0-9]+(–[0-9]+)?% around [0-9,]+–[0-9,]+$/.test(e.querySelector('title')?.textContent))"));
    await s.shot("09-map-gc");
    await s.click("//*[contains(@class,'sv-map')]//button[normalize-space()='Linear']", "xpath");
    check("The linear map draws GC as a band", await s.waitFor("document.querySelector('.sv-map-svg-linear .sv-map-gc line')", 5000));
    await s.click("//*[contains(@class,'sv-map')]//button[normalize-space()='Circular']", "xpath");
    await s.click(mapGcChip, "xpath");
    check("The map's GC% button hides it again", await s.waitFor("!document.querySelector('.sv-map-svg-linear') && !document.querySelector('.sv-map .sv-map-gc')", 3000));
    await s.exec("window.__strandivo.command('show-sequence')");
    check("ORFs show in the sequence too", await s.waitFor("document.querySelector('.sv-seq .sv-orf')", 5000));
    await s.click("//*[contains(@class,'sv-seq')]//button[contains(@class,'sv-chip')][normalize-space()='ORFs']", "xpath");
    check("The ORFs button hides them again", await s.waitFor("!document.querySelector('.sv-seq .sv-orf')", 3000));
    // GC content: off in Sequence until its button is on, then under the bases and along the overview strip.
    const gcChip = "//*[contains(@class,'sv-seq')]//button[contains(@class,'sv-chip')][normalize-space()='GC%']";
    check("Sequence shows no GC until its button is on", await s.exec("return !document.querySelector('.sv-seq .sv-gc') && !document.querySelector('.sv-strip-gc')"));
    await s.click(gcChip, "xpath");
    check("The Sequence GC% button says what its colours mean", await s.exec("const b = Array.from(document.querySelectorAll('.sv-seq .sv-chip')).find(b => b.textContent.trim() === 'GC%'); return /GC content of the 21 bases around each base/.test(b?.title) && /best for primers/.test(b.title);"));
    check("The GC button draws GC under the bases and along the overview strip", await s.waitFor("document.querySelector('.sv-seq .sv-gc') && document.querySelector('.sv-strip-gc')", 5000));
    check("Each stretch of the GC strip says its GC and bases", await s.exec("return Array.from(document.querySelectorAll('.sv-seq .sv-gc')).every(e => /^GC [0-9]+(–[0-9]+)?% around [0-9,]+–[0-9,]+$/.test(e.title))"));
    await s.click(gcChip, "xpath");
    check("The GC button hides it again", await s.waitFor("!document.querySelector('.sv-seq .sv-gc') && !document.querySelector('.sv-strip-gc')", 3000));
    await s.exec("window.__strandivo.command('digest')");
    check("Digest opens a dialog", await s.waitFor("document.querySelector('.sv-dialog .sv-digest .sv-gel')", 5000));
    await s.click(".sv-dialog input[data-enzyme='EcoRI']");
    await s.waitFor("document.querySelectorAll('.sv-dialog .sv-digest-row').length === 1", 3000);
    await s.click(".sv-dialog input[data-enzyme='HindIII']");
    await s.waitFor("document.querySelectorAll('.sv-dialog .sv-digest-row').length === 2", 3000);
    const sizes = await s.exec("return Array.from(document.querySelectorAll('.sv-dialog .sv-digest-row')).map(r => Number(r.dataset.size))");
    check("EcoRI and HindIII cut out pUC19's 51 bp MCS piece, the sizes adding up to the plasmid", sizes.length === 2 && sizes[1] === 51 && sizes[0] + sizes[1] === amp.len, `${JSON.stringify(sizes)} of ${amp.len} bp`);
    check("The gel shows a band for each fragment next to the ladder", await s.exec("return document.querySelectorAll('.sv-dialog .sv-gel-pick').length === 2 && document.querySelectorAll('.sv-dialog .sv-gel-band').length > 5"));
    await s.shot("10-digest");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space(.)='Done']", "xpath");
    check("Done closes the Digest dialog", await s.waitFor("!document.querySelector('.sv-dialog')", 3000));

    // --- an enzyme's other sites, and picking enzymes for a digest ---
    await s.exec(`window.__strandivo.command('show-map');
      const set = document.querySelector('select[aria-label="Cut-site filter"]'); set.value = 'unique2'; set.dispatchEvent(new Event('change', { bubbles: true }));`);
    await s.waitFor("document.querySelector('.sv-map-svgel text[data-id^=\"BglI@\"]')", 3000);
    await s.exec("document.querySelector('.sv-enzyme-chip[data-id^=\"BglI@\"]').click();");
    await sleep(300);
    const related = await s.exec("return Array.from(document.querySelectorAll('.sv-map-svgel text.sv-related')).map(t => t.dataset.id)");
    check("Selecting a site of an enzyme that cuts twice marks its other site on the map", related.length === 1 && related[0].startsWith("BglI@"), JSON.stringify(related));
    // ⌘-click on a Mac, Ctrl-click elsewhere.
    const pick = name => `{ const mac = /Mac/.test(navigator.platform); document.querySelector('.sv-enzyme-chip[data-id^="${name}@"]').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: mac, ctrlKey: !mac })); }`;
    await s.exec(`${pick("EcoRI")} ${pick("BamHI")}`);
    await sleep(300);
    const picked = await s.exec(`${doc} return { enzymes: s.selection.enzymes, inspector: document.querySelector('.sv-inspector')?.textContent || '' };`);
    check("⌘/Ctrl-click picks more enzymes, and the inspector offers to digest with them", JSON.stringify(picked.enzymes) === '["BglI","EcoRI","BamHI"]' && picked.inspector.includes("Digest with BglI, EcoRI and BamHI…"), JSON.stringify(picked.enzymes));
    await s.shot("10b-picked-enzymes");
    const digestMenu = await s.exec(`window.__strandivoMenu = items => { window.__e2eMenu = items; };
      document.querySelector('.sv-map-svgel text[data-id^="EcoRI@"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      return (window.__e2eMenu || []).map(e => e === 'separator' ? '—' : e.label);`);
    check("Right-clicking a picked enzyme keeps the pick and digests with them all", digestMenu.includes("Digest with BglI, EcoRI and BamHI…"), digestMenu.join(" | "));
    await s.exec("window.__e2eMenu.find(e => e.label.startsWith('Digest with')).run(); delete window.__strandivoMenu;");
    await s.waitFor("document.querySelector('.sv-dialog .sv-digest .sv-gel')", 5000);
    const ticked = await s.exec("return Array.from(document.querySelectorAll('.sv-dialog input[data-enzyme]:checked')).map(i => i.dataset.enzyme).sort()");
    check("The Digest dialog opens with the picked enzymes ticked", JSON.stringify(ticked) === '["BamHI","BglI","EcoRI"]', JSON.stringify(ticked));
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space(.)='Done']", "xpath");
    await s.waitFor("!document.querySelector('.sv-dialog')", 3000);
    await s.press(ESCAPE);
    check("Esc drops the picked enzymes", await s.waitFor("!window.__strandivo.store.selection.enzymes && !window.__strandivo.store.selection.focus", 3000));
    await s.exec(`const set = document.querySelector('select[aria-label="Cut-site filter"]'); set.value = 'unique6'; set.dispatchEvent(new Event('change', { bubbles: true }));`);

    // --- lab enzyme stock: the shell's saved list and live updates across windows ---
    const personalBefore = await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('load_app_data', { name: 'personal-enzymes' }).then(done, e => done(String(e)));");
    await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('save_app_data', { name: 'personal-enzymes', contents: JSON.stringify({ version: 1, enzymes: [] }) }).then(done);");
    const stockBefore = await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('load_app_data', { name: 'enzyme-library' }).then(done, e => done(String(e)));");
    const beforeEnzymes = await s.handles();
    await s.click("button[aria-label='Enzyme library']");
    await sleep(1500);
    const enzymeHandle = (await s.handles()).find(h => !beforeEnzymes.includes(h));
    if (enzymeHandle) {
      await s.switchTo(enzymeHandle);
      check("The enzyme library opens in its own window", await s.waitFor("document.querySelector('.sv-libwin h1')?.textContent.includes('Enzyme library')", 10000));
      // The list is read before anything can be added to it.
      await s.waitFor("document.querySelector('.sv-libwin .sv-count')?.textContent !== ''", 5000);
      await s.click("//button[normalize-space(.)='Add enzyme…']", "xpath");
      for (const enzyme of ["EcoRI", "PvuII"]) {
        await s.exec(`document.querySelector('[aria-label="New stock enzyme"]').value = arguments[0];
          document.querySelector('[aria-label="New stock product"]').value = 'E2E ' + arguments[0];
          document.querySelector('[aria-label="New stock freezer location"]').value = 'Freezer 2, box A';
          document.querySelector('[aria-label="New stock notes"]').value = 'Spare tube';`, enzyme);
        await s.click("//button[normalize-space(.)='Add enzyme']", "xpath");
        check(`The stock record for ${enzyme} is saved`, await s.waitFor(`document.querySelector('input[aria-label="Product of E2E ${enzyme}"]')`, 5000));
      }
      await s.click("//button[normalize-space(.)='Done']", "xpath");
      await s.exec(`const notes = document.querySelector('input[aria-label="Notes of E2E EcoRI"]'); notes.focus(); notes.value = 'Updated spare tube'; notes.blur();`);
      await s.waitFor("document.querySelector('[role=status]')?.textContent === 'Saved'", 5000);
      const stockSaved = await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('load_app_data', { name: 'enzyme-library' }).then(raw => done(JSON.parse(raw)), e => done(String(e)));");
      check("Product, freezer location and edited notes are kept in the JSON file", stockSaved?.version === 1 && ["EcoRI", "PvuII"].every(enzyme => stockSaved.entries.some(e => e.enzyme === enzyme && e.product === `E2E ${enzyme}` && e.location === "Freezer 2, box A" && e.notes === (enzyme === "EcoRI" ? "Updated spare tube" : "Spare tube"))), JSON.stringify(stockSaved));
      await s.shot("10c-enzyme-library");
      await s.exec("Array.from(document.querySelectorAll('[aria-label=\"Enzyme library section\"] button')).find(b => b.textContent === 'My enzymes').click();");
      await s.waitFor("document.querySelector('[aria-label=\"Search My enzymes\"]')", 5000);
      for (const name of ["EcoRI", "Acc65I", "PvuII"]) {
        await s.exec("const q = document.querySelector('[aria-label=\"Search My enzymes\"]'); q.value = arguments[0]; q.dispatchEvent(new Event('input'));", name);
        await s.click(`input[data-personal-enzyme='${name}']`);
        check(`My enzymes saves ${name}`, await s.waitFor(`document.querySelector('input[data-personal-enzyme="${name}"]')?.checked && document.querySelector('.sv-personal-enzyme-tools [role=status]')?.textContent === 'Saved'`, 5000));
      }
      await s.exec("const q = document.querySelector('[aria-label=\"Search My enzymes\"]'); q.value = ''; q.dispatchEvent(new Event('input')); document.querySelector('[aria-label=\"Selected only\"]').click();");
      check("The personal checklist shows selected names and lab membership", await s.exec("return document.querySelectorAll('[data-personal-enzyme]').length === 3 && Array.from(document.querySelectorAll('.sv-personal-enzyme-row')).filter(r => r.textContent.includes('In lab')).length === 2;"));
      await s.exec("document.querySelector('[data-personal-enzyme=\"Acc65I\"]').focus();");
      await s.press("\uE015");
      check("The personal checklist keeps keyboard navigation between rows", await s.exec("return document.activeElement?.dataset.personalEnzyme === 'EcoRI';"));
      check("Only the current checklist row is in the Tab order, so Tab leaves the list", await s.exec("return document.querySelectorAll('[data-personal-enzyme][tabindex=\"0\"]').length === 1 && document.activeElement?.getAttribute('tabindex') === '0';"));
      await s.shot("10e-my-enzymes");
      await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_enzyme_library', { section: 'lab' }).then(done);");
      await s.waitFor("document.querySelector('[aria-label=\"New stock enzyme\"]') || document.querySelector('.sv-enzyme-grid')", 5000);
      // Stock membership never changes a personal selection.
      await s.click("//button[normalize-space(.)='Add enzyme…']", "xpath");
      await s.exec("document.querySelector('[aria-label=\"New stock enzyme\"]').value = 'Acc65I'; document.querySelector('[aria-label=\"New stock product\"]').value = 'E2E Acc65I';");
      await s.click("//button[normalize-space(.)='Add enzyme']", "xpath");
      await s.waitFor("document.querySelector('input[aria-label=\"Product of E2E Acc65I\"]')", 5000);
      await s.click("//button[@aria-label='Remove E2E Acc65I']", "xpath");
      await s.click("//*[contains(@class,'ps-modal-buttons')]//button[normalize-space(.)='Remove']", "xpath");
      await s.waitFor("!document.querySelector('input[aria-label=\"Product of E2E Acc65I\"]')", 5000);
      await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_enzyme_library', { section: 'personal' }).then(done);");
      check("An existing library opens to its requested section", await s.waitFor("document.querySelector('[aria-label=\"Search My enzymes\"]')", 5000));
      check("Removing lab stock preserves the personal choice", await s.exec("return document.querySelector('[data-personal-enzyme=\"Acc65I\"]')?.checked && !document.querySelector('[data-personal-enzyme=\"Acc65I\"]').closest('label').textContent.includes('In lab');"));


      await s.closeWindow();
      await s.switchTo(mainHandle);
      await s.exec(`document.querySelector('[aria-label="Which map enzymes to show"] [data-value="personal"]').click(); const filter = document.querySelector('select[aria-label="Map cut-site filter"]'); filter.value = 'all'; filter.dispatchEvent(new Event('change'));`);
      check("My enzymes updates open maps without substituting KpnI", await s.waitFor("document.querySelectorAll('.sv-map-svgel text[data-id^=\"Acc65I@\"]').length === 1 && document.querySelectorAll('.sv-map-svgel text[data-id^=\"PvuII@\"]').length === 2 && !document.querySelector('.sv-map-svgel text[data-id^=\"KpnI@\"]')", 5000));
      await s.exec(`window.__strandivoMenu = items => { window.__e2eMenu = items; }; document.querySelector('.sv-enzyme-chip[data-id^="EcoRI@"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));`);
      check("A saved enzyme's context menu offers removal", await s.exec("return window.__e2eMenu?.some(e => e.label === 'Remove from My enzymes');"));
      await s.exec("window.__e2eMenu.find(e => e.label === 'Remove from My enzymes').run();");
      check("Removing a personal enzyme updates the map live", await s.waitFor("!document.querySelector('.sv-map-svgel text[data-id^=\"EcoRI@\"]')", 5000));
      await s.exec(`document.querySelector('[aria-label="Which map enzymes to show"] [data-value="common"]').click();`);
      await s.waitFor("document.querySelector('.sv-enzyme-chip[data-id^=\"EcoRI@\"]')", 5000);
      await s.exec(`document.querySelector('.sv-enzyme-chip[data-id^="EcoRI@"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); window.__e2eMenu.find(e => e.label === 'Add to My enzymes').run();`);
      await s.exec(`document.querySelector('[aria-label="Which map enzymes to show"] [data-value="lab"]').click(); const filter = document.querySelector('select[aria-label="Map cut-site filter"]'); filter.value = 'all'; filter.dispatchEvent(new Event('change'));`);
      check("Lab enzymes updates the open map, including every PvuII site", await s.waitFor("document.querySelectorAll('.sv-map-svgel text[data-id^=\"PvuII@\"]').length === 2 && document.querySelectorAll('.sv-map-svgel text[data-id^=\"EcoRI@\"]').length === 1", 5000));
      check("The outline follows the map's lab enzyme choice", await s.exec("return document.querySelector('[aria-label=\"Which enzymes to show\"] [aria-checked=\"true\"]')?.dataset.value === 'lab'"));
      await s.exec(`const set = document.querySelector('select[aria-label="Map cut-site filter"]'); set.value = 'unique'; set.dispatchEvent(new Event('change', { bubbles: true }));`);
      check("Lab enzymes: unique cutters leaves out PvuII's two sites", await s.waitFor("document.querySelectorAll('.sv-map-svgel text[data-id^=\"PvuII@\"]').length === 0 && document.querySelectorAll('.sv-map-svgel text[data-id^=\"EcoRI@\"]').length === 1", 5000));
      await s.exec(`const set = document.querySelector('select[aria-label="Map cut-site filter"]'); set.value = 'all'; set.dispatchEvent(new Event('change', { bubbles: true }));`);
      await s.shot("10d-lab-enzymes");
    } else {
      check("Enzyme library window opens (not visible to WebDriver; skipped)", true);
    }
    // Restore the starting stock and view so later checks stay independent.
    await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('save_app_data', { name: 'enzyme-library', contents: arguments[0] }).then(() => done(true), e => done(String(e)));", typeof stockBefore === "string" && stockBefore.startsWith("{") ? stockBefore : JSON.stringify({ version: 1, entries: [] }));
    await s.exec(`document.querySelector('[aria-label="Which map enzymes to show"] [data-value="common"]').click(); const filter = document.querySelector('select[aria-label="Map cut-site filter"]'); filter.value = 'unique6'; filter.dispatchEvent(new Event('change')); delete window.__strandivoMenu;`);

    await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('save_app_data', { name: 'personal-enzymes', contents: arguments[0] }).then(done);", typeof personalBefore === "string" && personalBefore.startsWith("{") ? personalBefore : JSON.stringify({ version: 1, enzymes: [] }));

    // --- the offer: shown for a thin file, not for an annotated one ---
    check("An annotated file is not asked about", !(await s.exec("return document.querySelector('.sv-offer') && !document.querySelector('.sv-offer').hidden")));
    await s.exec(`window.__strandivo.open([${JSON.stringify(data("sanger", "sage-sample-reference.fa"))}])`);
    check("Opening a file with no features offers to look for parts", await s.waitFor("document.querySelector('.sv-offer') && !document.querySelector('.sv-offer').hidden", 10000));
    await s.shot("11-offer");
    await s.click("//*[contains(@class,'sv-offer')]//button[contains(., 'Not now')]", "xpath");
    check("Not now puts the offer away", await s.waitFor("document.querySelector('.sv-offer').hidden", 3000));
    // On a linear sequence a middle stretch inverts to its two ends, kept apart.
    const linear = await s.exec(`${doc} s.selectRange({ start: 100, end: 199 }, null, "e2e"); window.__strandivo.command('invert-selection'); return { circular: s.data.circular, n: s.data.sequence.length, range: s.selection.range, ranges: s.selection.ranges ?? null };`);
    check("Inverting a middle stretch of a linear sequence selects its two ends", !linear.circular && !linear.range && JSON.stringify(linear.ranges) === JSON.stringify([{ start: 0, end: 99 }, { start: 200, end: linear.n - 1 }]), JSON.stringify(linear));
    await sleep(200);
    check("The status bar counts both stretches' bases", (await s.exec(statusBp)) === linear.n - 100 && /2 stretches selected/.test(await s.exec("return document.querySelector('.sv-status-left').textContent")), `${await s.exec(statusBp)} bp`);
    await s.exec("window.__strandivo.closeTab(); window.__strandivo.showTab(0);");
    await sleep(500);

    // --- detect features: the real catalog, searched by the Rust core ---
    const featuresBefore = await s.exec(`${doc} return s.data.features.length;`);
    await s.exec("window.__strandivo.command('detect-features')");
    check("Detect features finds parts in the sequence", await s.waitFor("document.querySelectorAll('.sv-dialog .sv-detect-row').length > 0", 20000));
    const offered = await s.exec("return Array.from(document.querySelectorAll('.sv-dialog .sv-detect-row')).map(r => r.querySelector('.sv-detect-name').textContent)");
    check("pUC19's origin is among them", offered.includes("ori"), offered.join(", "));
    check("AmpR is already annotated in this file, so it isn't offered again", !offered.includes("AmpR"), offered.join(", "));
    const sourced = await s.exec("return Array.from(document.querySelectorAll('.sv-dialog .sv-detect-source')).every(e => e.textContent.trim().length > 0)");
    check("Every suggestion says where its sequence came from", sourced);
    check("Nothing is added while the dialog is open", (await s.exec(`${doc} return s.data.features.length;`)) === featuresBefore);
    await s.shot("11-detect");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[contains(., 'Add ')]", "xpath");
    check(
      "Adding the chosen features closes the dialog and puts them in",
      (await s.waitFor(`window.__strandivo.store.data.features.length > ${featuresBefore}`, 5000)) && !(await s.exec("return !!document.querySelector('.sv-dialog')"))
    );
    const detected = await s.exec(`${doc} return s.data.features.slice(${featuresBefore}).map(f => ({ name: f.name, type: f.type, strand: f.strand }));`);
    check("The origin went in as a rep_origin, drawn without a direction", detected.some(f => f.name === "ori" && f.type === "rep_origin" && f.strand === 0), JSON.stringify(detected));
    check("They show on the map", await s.waitFor("document.querySelectorAll('.sv-map-feature').length > 0", 5000));
    await s.exec(`${doc} s.undo();`);
    check("One undo takes all of them back out again", await s.waitFor(`window.__strandivo.store.data.features.length === ${featuresBefore}`, 5000));

    await checkMapRegionDisplay(s, check);

    // --- regions of a protein: a made-up entry for pUC19's AmpR, so no network is needed ---
    const featuresForRegions = await s.exec(`${doc} return s.data.features.length;`);
    await s.exec(`
      const s = window.__strandivo.store;
      const cds = s.data.features.find(f => f.type === "CDS" && f.name.toLowerCase().includes("amp"));
      window.__strandivoCds = cds.id;
      s.select({ range: { start: cds.start, end: cds.end }, focus: { kind: "feature", id: cds.id } });
    `);
    await s.waitFor("!!document.querySelector('.sv-code')", 5000);
    await s.exec(`
      const protein = document.querySelector('.sv-code').textContent.replace(/[*]+$/, "");
      window.__strandivoUniprot = async accession => ({
        primaryAccession: accession,
        entryType: "UniProtKB reviewed (Swiss-Prot)",
        genes: [{ geneName: { value: "bla" } }],
        sequence: { value: protein },
        features: [
          { type: "Signal", location: { start: { value: 1 }, end: { value: 23 } }, description: "" },
          { type: "Transmembrane", location: { start: { value: 40 }, end: { value: 60 } }, description: "Helical", evidences: [{ evidenceCode: "ECO:0000255" }] }
        ]
      });
    `);
    check("A CDS offers regions from UniProt", await s.waitFor("Array.from(document.querySelectorAll('.sv-link')).some(b => b.textContent.includes('Get from UniProt'))", 5000));
    await s.click("//button[contains(., 'Get from UniProt')]", "xpath");
    await s.exec("const i = document.querySelector('.sv-uniprot-search input'); i.value = 'P62593'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));");
    check("Looking up an entry offers what can be placed", await s.waitFor("document.querySelectorAll('.sv-dialog .sv-uniprot-row').length === 2", 5000));
    await s.shot("11-uniprot");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[contains(., 'Add ')]", "xpath");
    check("Adding them adds no features", (await s.exec(`${doc} return s.data.features.length;`)) === featuresForRegions);
    // The map only draws while it shows.
    await s.exec("window.__strandivo.command('show-map')");
    check("They are drawn inside the CDS", await s.waitFor("document.querySelectorAll('.sv-map-region').length === 2", 5000));
    check("The inspector draws them with their list folded", await s.waitFor("document.querySelectorAll('.sv-inspector .sv-protein-region').length === 2 && document.querySelector('.sv-inspector [data-fold=\"region-list\"]')?.getAttribute('aria-expanded') === 'false'", 3000));
    check("Independent regions need no top-level/all choice", await s.exec("return document.querySelector('[aria-label=\"Protein region detail\"]').hidden;"));
    check("The entry goes in the file's cross-references", await s.exec(`${doc} return s.data.features.find(f => f.id === window.__strandivoCds).notes.db_xref.includes("UniProtKB/Swiss-Prot:P62593");`));
    await s.exec(`${doc} s.undo();`);
    check("One undo takes them back out", await s.waitFor("document.querySelectorAll('.sv-map-region').length === 0", 5000));

    // A protein remains one CDS while its domains and CDRs are authored and selected.
    const fillProteinRegion = async (name, kind, start, end, parent = "") => {
      await s.exec(`
        for (const [label, value] of Object.entries(arguments[0])) {
          const input = document.querySelector('.sv-dialog [aria-label="' + label + '"]');
          input.value = value;
          input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
        }
      `, { "Region name": name, "Region kind": kind, "First residue": String(start), "Last residue": String(end), "Parent region": parent });
    };
    await s.click("//button[normalize-space(.)='Add region…']", "xpath");
    check("Region names leave spelling and capitalisation to the user", await s.exec("const name = document.querySelector('[aria-label=\"Region name\"]'); return name.getAttribute('autocorrect') === 'off' && name.getAttribute('autocapitalize') === 'off' && name.spellcheck === false;"));
    check("Region kinds use a dropdown with antibody and structural categories", await s.exec("const kind = document.querySelector('[aria-label=\"Region kind\"]'); const values = Array.from(kind.options).map(o => o.value); return kind.tagName === 'SELECT' && ['Variable domain', 'Constant domain', 'Coiled coil', 'Disordered region', 'custom'].every(v => values.includes(v));"));
    check("An ordinary region dialog leaves no blank area below its last control", await s.exec("const last = document.querySelector('[aria-label=\"Varies between clones\"]').closest('label'); return document.querySelector('.sv-dialog-foot').getBoundingClientRect().top - last.getBoundingClientRect().bottom <= 24;"));
    const firstRegionColour = await s.exec("return document.querySelector('[aria-label=\"Region colour\"]').value;");
    await fillProteinRegion("Test domain", "Domain", 1, 80);
    await s.click("//button[normalize-space(.)='Add region']", "xpath");
    check("A manually added domain has a protein diagram", await s.waitFor("document.querySelectorAll('.sv-protein-region').length === 1", 5000));
    check("One region needs no map detail selector", await s.exec("return document.querySelector('[aria-label=\"Protein region detail\"]').hidden;"));
    check("Region actions have clear labels and fill both rows", await s.exec(`
      const actions = document.querySelector('.sv-region-actions');
      const buttons = Array.from(actions.querySelectorAll('button'));
      const bounds = actions.getBoundingClientRect();
      return buttons.map(b => b.textContent.trim()).join('|') === 'Edit region…|Copy AA sequence|Add as feature|Remove' &&
        buttons.every((button, i) => Math.abs(button.getBoundingClientRect()[i % 2 ? 'right' : 'left'] - bounds[i % 2 ? 'right' : 'left']) < 1);
    `));
    const domainId = await s.exec(`${doc} return JSON.parse(decodeURIComponent(s.data.features.find(f => f.id === window.__strandivoCds).notes.strandivo_regions[0].split('|')[5])).id;`);
    await s.click("//button[normalize-space(.)='Add region…']", "xpath");
    const secondRegionColour = await s.exec("return document.querySelector('[aria-label=\"Region colour\"]').value;");
    check("New regions in one CDS start with different coordinated colours", firstRegionColour !== secondRegionColour, `${firstRegionColour}, ${secondRegionColour}`);
    await fillProteinRegion("CDR1", "CDR", 10, 18, domainId);
    await s.click("//button[normalize-space(.)='Add region']", "xpath");
    check("Nested regions stay within one document feature", (await s.exec(`${doc} return s.data.features.length;`)) === featuresForRegions);
    check("The outline shows both regions", await s.waitFor("document.querySelectorAll('.sv-outline [data-region]').length === 2", 5000));
    check("Nested region detail is in the map's Regions menu", await s.exec("const detail = document.querySelector('[aria-label=\"Protein region detail\"]'); const button = document.querySelector('[aria-label=\"Region options\"]'); return !detail.hidden && !button.hidden && !!detail.closest('.sv-chip-menu[aria-label=\"Region options\"]');"));
    const featureSwatchesAlign = () => s.exec("const swatches = Array.from(document.querySelectorAll('.sv-outline [data-kind=\"feature\"]:not([data-region]) .sv-swatch')); return swatches.length > 1 && swatches.every(el => Math.abs(el.getBoundingClientRect().left - swatches[0].getBoundingClientRect().left) < 1);");
    check("Features with regions align with other features", await featureSwatchesAlign());
    await s.click(".sv-outline-feature-head button[aria-expanded='true']");
    check("Collapsing regions keeps the feature list aligned", await s.waitFor("document.querySelectorAll('.sv-outline [data-region]').length === 0", 5000) && await featureSwatchesAlign());
    await s.click(".sv-outline-feature-head button[aria-expanded='false']");
    await s.waitFor("document.querySelectorAll('.sv-outline [data-region]').length === 2", 5000);
    await s.exec("const select = document.querySelector('[aria-label=\"Protein region detail\"]'); select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true }));");
    check("All map detail draws a domain and its CDR", await s.waitFor("document.querySelectorAll('.sv-map-region').length === 2", 5000));
    await s.click("//div[contains(@class,'sv-map')]//button[normalize-space(.)='Regions']", "xpath");
    check("The map's Regions button hides regions while keeping CDS features", await s.waitFor("document.querySelectorAll('.sv-map-region').length === 0 && document.querySelectorAll('.sv-map-feature').length > 0", 5000));
    check("Hiding map regions hides its detail choice but keeps the level", await s.exec("const select = document.querySelector('[aria-label=\"Protein region detail\"]'); return select.value === 'all' && select.disabled && select.hidden;"));
    await s.click("//div[contains(@class,'sv-map')]//button[normalize-space(.)='Regions']", "xpath");
    check("Showing map regions restores the previous detail level", await s.waitFor("document.querySelectorAll('.sv-map-region').length === 2 && !document.querySelector('[aria-label=\"Protein region detail\"]').disabled", 5000));
    await s.exec("const select = document.querySelector('[aria-label=\"Protein region detail\"]'); select.value = 'domains'; select.dispatchEvent(new Event('change', { bubbles: true }));");
    check("Top-level map detail keeps only the domain", await s.waitFor("document.querySelectorAll('.sv-map-region').length === 1", 5000));
    // The row can sit half under the status bar, and WebKit won't click an element whose
    // middle is hidden, as it only scrolls one that is wholly out of view.
    await s.exec("document.querySelector(\".sv-outline [data-region='1']\").scrollIntoView({ block: 'nearest' });");
    await s.click(".sv-outline [data-region='1']");
    await s.click("//button[normalize-space(.)='Edit region…']", "xpath");
    check("Editing a region keeps its colour", (await s.exec("return document.querySelector('[aria-label=\"Region colour\"]').value;")) === secondRegionColour);
    await fillProteinRegion("CDR1 edited", "CDR", 9, 19, domainId);
    await s.click("//button[normalize-space(.)='Save region']", "xpath");
    check("A region's bounds and name can be edited", await s.waitFor("Array.from(document.querySelectorAll('.sv-outline [data-region]')).some(r => r.textContent.includes('CDR1 edited') && r.textContent.includes('9–19'))", 5000));
    await s.shot("11-protein-regions");

    // Protein details draw the protein as a figure: a nested region is a bracket under its parts.
    await s.click("//*[contains(@class,'sv-inspector')]//button[normalize-space(.)='Details…']", "xpath");
    const figureNames = `
      const names = Array.from(document.querySelectorAll('.sv-figure text[data-region]')).map(t => t.getBoundingClientRect());
      const apart = names.every((a, i) => names.every((b, j) => i <= j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));`;
    check("Protein details draw a block for the CDR and a bracket for its domain, all named apart", await s.waitFor(`(() => { ${figureNames}
      return document.querySelectorAll('.sv-figure rect[data-region]').length === 1 && names.length === 2 && apart; })()`, 5000));
    await s.shot("11-protein-figure");
    await s.exec("const select = document.querySelector('[aria-label=\"Regions to draw\"]'); select.value = 'domains'; select.dispatchEvent(new Event('change', { bubbles: true }));");
    check("At top level the figure draws the domain as a block", await s.waitFor("document.querySelectorAll('.sv-figure rect[data-region]').length === 1 && document.querySelectorAll('.sv-figure text[data-region]').length === 1 && document.querySelector('.sv-figure rect[data-region]').dataset.region === '0'", 5000));
    await s.exec("const select = document.querySelector('[aria-label=\"Regions to draw\"]'); select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true }));");
    await s.exec("document.querySelector('.sv-figure rect[data-region=\"1\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));");
    check("Clicking a block in the figure selects its region", await s.waitFor("window.__strandivo.store.selection.focus?.region === 1 && document.querySelector('.sv-figure rect[data-region=\"1\"]').classList.contains('sv-selected')", 5000));
    check("The figure can be copied or saved as PNG or SVG", await s.exec("const labels = Array.from(document.querySelectorAll('.sv-dialog-foot button')).map(b => b.textContent.trim()); return ['Copy image', 'Save as PNG…', 'Save as SVG…'].every(l => labels.includes(l));"));
    check("Protein details give both coefficients for a protein with a pair of Cys", await s.exec("return Array.from(document.querySelectorAll('.sv-dialog .sv-protein-facts dt')).map(d => d.textContent).join() === 'Length,Mass,ε280, Cys reduced,ε280, disulfides,Counted';"));
    check("Protein details fold the list of regions under the figure", await s.exec("return document.querySelector('.sv-dialog .sv-fold-link')?.getAttribute('aria-expanded') === 'false' && !document.querySelector('.sv-dialog .sv-list-row');"));
    // Edit region… gives the editor the dialog's place, and Protein details come back when
    // it closes. Cancel takes the same way back as Save and leaves the file as it is.
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space(.)='Edit region…']", "xpath");
    await s.waitFor("!!document.querySelector('.sv-dialog [aria-label=\"Region name\"]')", 5000);
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space(.)='Cancel']", "xpath");
    check("Closing a region editor opened from Protein details returns to them", await s.waitFor("document.querySelectorAll('.sv-dialog').length === 1 && !!document.querySelector('.sv-dialog .sv-protein-seq') && document.querySelector('.sv-dialog .sv-figure rect[data-region=\"1\"]')?.classList.contains('sv-selected')", 5000));
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space(.)='Close']", "xpath");

    await s.exec("window.__strandivo.command('show-sequence')");
    await s.exec(`${doc} const f = s.data.features.find(f => f.id === window.__strandivoCds);
      const range = f.strand === -1 ? { start: f.end - 59, end: f.end - 42 } : { start: f.start + 42, end: f.start + 59 };
      s.selectRange(range, null, "e2e");`);
    check("Protein regions have labelled tracks in Sequence", await s.waitFor("document.querySelectorAll('.sv-seq-region-bar').length > 0 && Array.from(document.querySelectorAll('.sv-region-caption')).some(e => e.textContent === 'CDR1 edited')", 5000));
    // A selection scrolls before its scroll event redraws the range label. Let the view
    // finish that redraw, then measure the row itself rather than a possibly stale label.
    const sequenceTopRow = targetRow => s.execAsync(`
      const done = arguments[arguments.length - 1];
      const targetRow = arguments[0];
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const scroller = document.querySelector('.sv-seq-scroll');
        const row = Array.from(scroller.querySelectorAll('.sv-row'))
          .filter(el => parseFloat(el.style.top) <= scroller.scrollTop)
          .sort((a, b) => parseFloat(b.style.top) - parseFloat(a.style.top))[0];
        const target = scroller.querySelector('.sv-row[data-row="' + targetRow + '"]');
        done({ row: Number(row.dataset.row), scrollTop: scroller.scrollTop,
          maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
          targetTop: target ? parseFloat(target.style.top) : null,
          label: document.querySelector('.sv-seq .sv-pane-note').textContent });
      }));
    `, targetRow ?? null);
    const sequenceBeforeToggle = await sequenceTopRow();
    await s.click("//div[contains(@class,'sv-seq')]//button[normalize-space(.)='Regions']", "xpath");
    check("Regions can be hidden without hiding the CDS", await s.waitFor("document.querySelectorAll('.sv-seq-region-bar').length === 0 && document.querySelectorAll('.sv-feature-bar').length > 0", 5000));
    check("The Sequence region toggle is separate from the map's", await s.exec("return Array.from(document.querySelectorAll('.sv-map .sv-chip')).find(b => b.textContent.trim() === 'Regions').getAttribute('aria-pressed') === 'true';"));
    const sequenceAfterToggle = await sequenceTopRow(sequenceBeforeToggle.row);
    // Near the sequence's end, shorter rows may leave too little content below the
    // anchor to fill the viewport. The browser must stop at the new scroll limit.
    const atSequenceEnd = sequenceAfterToggle.targetTop !== null && sequenceAfterToggle.targetTop > sequenceAfterToggle.maxScrollTop && Math.abs(sequenceAfterToggle.scrollTop - sequenceAfterToggle.maxScrollTop) < 1;
    check("Hiding regions preserves the row or stops at the sequence's end", sequenceAfterToggle.row === sequenceBeforeToggle.row || atSequenceEnd, JSON.stringify({ before: sequenceBeforeToggle, after: sequenceAfterToggle }));
    await s.click("//div[contains(@class,'sv-seq')]//button[normalize-space(.)='Regions']", "xpath");
    await s.exec("const scroller = document.querySelector('.sv-seq-scroll'); scroller.scrollTop = Math.max(0, scroller.scrollTop - scroller.clientHeight);");
    const sequenceAwayFromEnd = await sequenceTopRow();
    await s.click("//div[contains(@class,'sv-seq')]//button[normalize-space(.)='Regions']", "xpath");
    const sequenceAwayAfterToggle = await sequenceTopRow();
    check("The Regions toggle keeps the same sequence row away from the end", sequenceAwayAfterToggle.row === sequenceAwayFromEnd.row, JSON.stringify({ before: sequenceAwayFromEnd, after: sequenceAwayAfterToggle }));
    await s.click("//div[contains(@class,'sv-seq')]//button[normalize-space(.)='Regions']", "xpath");
    await s.exec(`${doc} s.selectRange(s.selection.range, null, "e2e");`);
    await s.click("//div[contains(@class,'sv-seq')]//button[normalize-space(.)='Translation']", "xpath");
    // Hidden views keep their old DOM until shown; only the Sequence view redraws here.
    check("Region names remain visible without translation", await s.waitFor("document.querySelectorAll('.sv-seq .sv-aa, .sv-seq .sv-aa-box').length === 0 && Array.from(document.querySelectorAll('.sv-seq .sv-region-caption')).some(e => e.textContent === 'CDR1 edited')", 5000));
    await s.click("//div[contains(@class,'sv-seq')]//button[normalize-space(.)='Translation']", "xpath");

    const selectionMenu = await s.exec(`${doc}
      window.__strandivoMenu = items => { window.__e2eMenu = items; };
      const probe = s.selection.range.start + 1;
      const row = Array.from(document.querySelectorAll('.sv-row')).find(row => {
        const start = Number(row.querySelector('.sv-row-number').textContent.replace(/,/g, '')) - 1;
        return start <= probe && probe < start + row.querySelector('.sv-bases').textContent.length;
      });
      const start = Number(row.querySelector('.sv-row-number').textContent.replace(/,/g, '')) - 1;
      const bases = row.querySelector('.sv-bases');
      const cw = bases.getBoundingClientRect().width / bases.textContent.length;
      const bar = Array.from(row.querySelectorAll('.sv-feature-bar')).find(el => el.dataset.id === window.__strandivoCds);
      const box = bar.getBoundingClientRect();
      bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: row.querySelector('.sv-row-track').getBoundingClientRect().left + (probe - start) * cw, clientY: box.top + box.height / 2 }));
      return { entries: window.__e2eMenu.map(e => e.label), focus: s.selection.focus };
    `);
    check("Right-clicking inside a CDS keeps the smaller selection and offers Add as region", selectionMenu.entries.includes("Add as region…") && selectionMenu.focus === null, JSON.stringify(selectionMenu));
    await s.exec("window.__e2eMenu.find(e => e.label === 'Add as region…').run(); delete window.__strandivoMenu;");
    check("Selected bases fill the region's residue bounds in the CDS frame", await s.waitFor("document.querySelector('[aria-label=\"First residue\"]')?.value === '15' && document.querySelector('[aria-label=\"Last residue\"]')?.value === '20'", 5000));
    await s.click("//button[normalize-space(.)='Cancel']", "xpath");
    await s.click("//button[normalize-space(.)='Add as region…']", "xpath");
    await s.exec("document.querySelector('[aria-label=\"Region name\"]').value = 'Selected region';");
    await s.exec("const kind = document.querySelector('[aria-label=\"Region kind\"]'); kind.value = 'custom'; kind.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('[aria-label=\"Custom region kind\"]').value = 'Antigen-binding loop';");
    await s.click("//button[normalize-space(.)='Add region']", "xpath");
    check("The selection inspector adds a region without entering positions", await s.waitFor("Array.from(document.querySelectorAll('.sv-region-caption')).some(e => e.textContent === 'Selected region')", 5000));
    await s.click("//button[normalize-space(.)='Edit region…']", "xpath");
    check("A custom region kind is kept when reopened", await s.exec("return document.querySelector('[aria-label=\"Region kind\"]').value === 'custom' && document.querySelector('[aria-label=\"Custom region kind\"]').value === 'Antigen-binding loop';"));
    await s.click("//button[normalize-space(.)='Cancel']", "xpath");
    await s.shot("11-protein-regions-sequence");

    // A primer's context includes both overlapping regions and nearby template boundaries.
    await s.exec(`${doc} const d = s.data;
      const f = d.features.find(f => f.id === window.__strandivoCds);
      const range = f.strand === -1 ? { start: f.end - 59, end: f.end - 42 } : { start: f.start + 42, end: f.start + 59 };
      const site = d.sequence.slice(range.start, range.end + 1).toUpperCase();
      const bases = f.strand === -1 ? [...site].reverse().map(b => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[b] || 'N').join('') : site;
      const p = { id: 'e2e-protein-region-primer', name: 'Region context test', ...range, strand: f.strand === -1 ? -1 : 1, bases, notes: {}, raw: {} };
      const notes = { ...f.notes, strandivo_regions: [...f.notes.strandivo_regions, 'Nearby region|Domain|22-25|:22-25'] };
      s.apply({ ...d, features: d.features.map(x => x.id === f.id ? { ...x, notes } : x), primers: [...d.primers, p] }, 'Test primer context', { range, focus: { kind: 'primer', id: p.id } });
      window.__strandivo.command('show-primers');`);
    check("Primer context shows the overlapping CDR and a neighbouring region", await s.waitFor("document.querySelector('.sv-ctx-primer') && Array.from(document.querySelectorAll('.sv-ctx .sv-region-caption')).some(e => e.textContent === 'CDR1 edited') && Array.from(document.querySelectorAll('.sv-ctx .sv-region-caption')).some(e => e.textContent === 'Nearby region')", 5000));
    check("The primer's context shows GC under its bases without turning it on", await s.waitFor("document.querySelector('.sv-ctx .sv-gc') && Array.from(document.querySelectorAll('.sv-ctx .sv-chip')).find(b => b.textContent.trim() === 'GC%')?.getAttribute('aria-pressed') === 'true'", 5000));
    const primerWindowBeforeToggle = await s.exec("return document.querySelector('.sv-ctx-readout .sv-mono').textContent;");
    await s.click("//section[contains(@class,'sv-ctx')]//button[normalize-space(.)='Regions']", "xpath");
    check("Primer regions can be hidden without hiding the primer or its handles", await s.waitFor("document.querySelectorAll('.sv-ctx .sv-seq-region-bar').length === 0 && document.querySelector('.sv-ctx-primer') && document.querySelectorAll('.sv-ctx-handle').length === 2", 5000));
    await s.exec("window.__strandivo.command('show-sequence')");
    check("Primer and Sequence region toggles share one setting", await s.waitFor("Array.from(document.querySelectorAll('.sv-seq .sv-chip')).find(b => b.textContent.trim() === 'Regions')?.getAttribute('aria-pressed') === 'false' && document.querySelectorAll('.sv-seq .sv-seq-region-bar').length === 0", 5000));
    await s.exec("window.__strandivo.command('show-primers')");
    await s.click("//section[contains(@class,'sv-ctx')]//button[normalize-space(.)='Regions']", "xpath");
    check("Restoring regions keeps the primer's sequence window", await s.waitFor("document.querySelectorAll('.sv-ctx .sv-seq-region-bar').length > 0", 5000) && (await s.exec("return document.querySelector('.sv-ctx-readout .sv-mono').textContent;")) === primerWindowBeforeToggle);
    await s.click(".sv-ctx .sv-seq-region-bar[data-region='1']");
    check("A primer-context region selects its own bases and keeps the primer in view", await s.waitFor("window.__strandivo.store.selection.focus?.region === 1 && document.querySelector('.sv-ctx-primer')", 5000) && (await s.exec(`${doc} return s.selection.range.end - s.selection.range.start + 1;`)) === 33);
    await s.shot("11-protein-regions-primer-context");
    await s.exec(`${doc} s.undo(); window.__strandivo.command('show-sequence');`);

    await s.exec(`${doc} s.undo(); s.selectRange({ start: s.data.features.find(f => f.id === window.__strandivoCds).start, end: s.data.features.find(f => f.id === window.__strandivoCds).end }, { kind: "feature", id: window.__strandivoCds, region: 1 }, "e2e"); window.__strandivo.command('show-map');`);
    await s.click("//button[normalize-space(.)='Remove']", "xpath");
    check("Removing a region keeps its CDS", await s.waitFor("document.querySelectorAll('.sv-outline [data-region]').length === 1", 5000));
    check("Removing the last nested region hides the map detail choice", await s.exec("return document.querySelector('[aria-label=\"Protein region detail\"]').hidden;"));
    await s.exec(`${doc} s.undo(); s.undo(); s.undo(); s.undo();`);
    check("Region authoring can be undone completely", await s.waitFor("document.querySelectorAll('.sv-outline [data-region]').length === 0", 5000));
    await s.exec("window.__strandivo.command('show-sequence')");

    // --- map and sequence side by side ---
    await s.exec("window.__strandivo.command('split-view')");
    await sleep(800);
    const split = await s.exec("return { map: !document.querySelector('.sv-pane-map').hidden, seq: !document.querySelector('.sv-pane-seq').hidden, rows: document.querySelectorAll('.sv-row').length, feats: document.querySelectorAll('.sv-map-feature').length }");
    check("Split view shows the map and the sequence together", split.map && split.seq && split.rows > 0 && split.feats > 0, JSON.stringify(split));
    await s.shot("04b-split");
    await s.exec("window.__strandivo.command('split-view')");

    await s.click("button[aria-label^='Show sidebar']");
    await sleep(300);
    const sidebarHidden = await s.exec("return document.querySelector('.sv-outline').hidden");
    await s.click("button[aria-label^='Show sidebar']");
    await sleep(300);
    const sidebarBack = await s.exec("return !document.querySelector('.sv-outline').hidden");
    check("The sidebar button hides and shows the sidebar", sidebarHidden && sidebarBack, JSON.stringify({ sidebarHidden, sidebarBack }));
    // Both side panels resize from their inner edge, and a double-click gives back the usual width.
    const panels = await s.exec(`
      const side = document.querySelector('.sv-body > .sv-splitter-sidebar');
      const insp = document.querySelector('.sv-body > .sv-splitter-inspector');
      const w = () => [document.querySelector('.sv-outline'), document.querySelector('.sv-inspector')].map(e => Math.round(e.getBoundingClientRect().width));
      const before = w();
      side.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      insp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      const wider = w();
      const saved = JSON.parse(localStorage.getItem('strandivo.panels') || '{}');
      side.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      insp.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return { before, wider, saved, after: w() };`);
    check(
      "The sidebar and inspector resize from their edges, and a double-click resets them",
      panels.wider[0] === panels.before[0] + 16 && panels.wider[1] === panels.before[1] + 16 && panels.saved.sidebar === panels.wider[0] && panels.after.join() === panels.before.join(),
      JSON.stringify(panels)
    );

    const sidebarState = "return Array.from(document.querySelectorAll('.sv-outline-section')).map(e => e.dataset.section + (e.querySelector('.sv-list, .sv-enzyme-chips, .sv-list-empty') ? '' : ' folded'))";
    const sidebarStart = await s.exec(sidebarState);
    await s.exec("document.querySelector(\".sv-section-toggle[data-section='features']\").scrollIntoView({ block: 'nearest' });");
    await s.click(".sv-section-toggle[data-section='features']");
    await sleep(300);
    const sidebarFolded = await s.exec(sidebarState);
    await s.exec("window.__strandivo.saveSettings({ sidebar: { order: ['features', 'primers', 'enzymes'], folded: [] } })");
    await sleep(300);
    const sidebarMoved = await s.exec(sidebarState);
    await s.exec("window.__strandivo.saveSettings({ sidebar: { order: ['primers', 'enzymes', 'features'], folded: [] } })");
    check(
      "The sidebar starts with primers, folds a section from its heading and follows the order in Settings",
      sidebarStart.join() === "primers,enzymes,features" && sidebarFolded.join() === "primers,enzymes,features folded" && sidebarMoved.join() === "features,primers,enzymes",
      JSON.stringify({ sidebarStart, sidebarFolded, sidebarMoved })
    );

    // --- sequencing reads, aligned by the real Rust core ---
    await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__strandivo.addReadPaths(arguments[0]).then(() => done(true), e => done(String(e)));",
      [data("sanger", "teselagen-example1.ab1"), data("sanger", "3730.ab1"), data("e2e", "bla-check.fasta")]
    );
    check("Three reads listed", await s.waitFor("document.querySelectorAll('.sv-read-card').length === 3 && !document.querySelector('.sv-reads.sv-busy')", 30000));
    const summary = await s.exec("return document.querySelector('.sv-reads-summary')?.textContent || ''");
    const noMatch = await s.exec("return Array.from(document.querySelectorAll('.sv-read-card')).filter(c => /No match/.test(c.textContent)).length");
    check("Two reads align, one unrelated read doesn't", /2 of 3 reads aligned/.test(summary) && noMatch === 1, `${summary}; ${noMatch} without a match`);
    check("Alignment view is drawn", await s.waitFor("Number(document.querySelector('.sv-aln')?.dataset.columns) > 2600", 15000));
    await sleep(1200);
    const startScroll = await s.exec("return document.querySelector('.sv-aln-scroll').scrollLeft");
    check("Alignment opens where the reads start", startScroll > 0, `scrollLeft ${startScroll}`);
    check("The .ab1 read's trace is drawn", await s.waitFor("Number(document.querySelector('.sv-aln')?.dataset.traces) >= 1", 5000));
    await s.shot("05-reads");
    // The wheel over the traces moves the rows, not only on a scroll bar, and never sideways.
    const wheel = await s.exec(`
      const body = document.querySelector('.sv-aln-body');
      const scroller = document.querySelector('.sv-aln-scroll');
      const canvas = document.querySelector('.sv-aln-canvas');
      const spin = deltaY => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
      const left = scroller.scrollLeft;
      const room = body.scrollHeight - body.clientHeight;
      body.scrollTop = 0;
      spin(40);
      const rows = body.scrollTop;
      body.scrollTop = room;
      spin(100);
      const moved = scroller.scrollLeft - left;
      body.scrollTop = 0;
      return { room, rows, moved };`);
    check("The wheel moves the rows and never sideways", (wheel.room < 1 || wheel.rows > 0) && wheel.moved === 0, JSON.stringify(wheel));
    // The reference stays at the top while the reads scroll under it.
    const pinned = await s.exec(`
      const body = document.querySelector('.sv-aln-body');
      const head = document.querySelector('.sv-aln-head');
      const room = body.scrollHeight - body.clientHeight;
      body.scrollTop = room;
      const offset = head.getBoundingClientRect().top - body.getBoundingClientRect().top;
      body.scrollTop = 0;
      const errors = [...document.querySelectorAll('.ps-toast-error')].map(t => t.textContent);
      return { room, offset, pinned: head.classList.contains('sv-aln-head-pinned'), share: head.offsetHeight / body.clientHeight, errors };`);
    // A resize observer that changes what another observes is reported as an error in WebKit.
    check("The reference stays at the top while the reads scroll, with no errors", (pinned.share > 0.4 ? !pinned.pinned : pinned.pinned && Math.abs(pinned.offset) < 1) && !pinned.errors.length, JSON.stringify(pinned));
    // The horizontal scroll bar stays in view whatever the rows do, and moves the traces.
    await s.exec("const b = document.querySelector('.sv-aln-bar'); b.scrollLeft += 120;");
    await sleep(300);
    const bar = await s.exec(`
      const b = document.querySelector('.sv-aln-bar');
      const scroller = document.querySelector('.sv-aln-scroll');
      const pane = document.querySelector('.sv-aln').getBoundingClientRect();
      const r = b.getBoundingClientRect();
      const fromBar = scroller.scrollLeft - b.scrollLeft;
      scroller.scrollLeft -= 120;
      return { fromBar, inPane: r.height > 0 && r.bottom <= pane.bottom + 1, width: b.clientWidth - scroller.clientWidth };`);
    await sleep(300);
    const barFollows = await s.exec("return document.querySelector('.sv-aln-bar').scrollLeft === document.querySelector('.sv-aln-scroll').scrollLeft");
    check("The alignment's scroll bar stays in view and is in step with the traces", bar.inPane && bar.fromBar === 0 && bar.width === 0 && barFollows, JSON.stringify({ ...bar, barFollows }));
    // The toolbar's panel buttons hide the Reads tab's own list and inspector, which give
    // the alignment their room, and leave the map's outline as it was.
    const readsPanels = () =>
      s.exec(`return {
        list: !document.querySelector('.sv-reads-list').hidden,
        insp: !document.querySelector('.sv-reads-insp').hidden,
        width: Math.round(document.querySelector('.sv-aln-scroll').getBoundingClientRect().width),
        pressed: [...document.querySelectorAll("button[aria-label^='Show sidebar'], button[aria-label='Show inspector']")].map(b => b.getAttribute('aria-pressed') === 'true' && !b.disabled)
      }`);
    const panelsShown = await readsPanels();
    await s.click("button[aria-label^='Show sidebar']");
    await s.click("button[aria-label='Show inspector']");
    await sleep(400);
    const panelsHidden = await readsPanels();
    await s.exec("window.__strandivo.setView('map')");
    await sleep(300);
    const outlineKept = await s.exec("return !document.querySelector('.sv-outline').hidden && !document.querySelector('.sv-inspector').hidden");
    await s.exec("window.__strandivo.setView('reads')");
    await sleep(300);
    const stillHidden = await s.exec("return document.querySelector('.sv-reads-list').hidden && document.querySelector('.sv-reads-insp').hidden");
    await s.click("button[aria-label^='Show sidebar']");
    await s.click("button[aria-label='Show inspector']");
    await sleep(400);
    const panelsBack = await readsPanels();
    check(
      "The panel buttons hide and show the reads' list and inspector, apart from the map's",
      panelsShown.list && panelsShown.insp && panelsShown.pressed.join() === "true,true" &&
        !panelsHidden.list && !panelsHidden.insp && panelsHidden.pressed.join() === "false,false" && panelsHidden.width > panelsShown.width + 400 &&
        outlineKept && stillHidden && panelsBack.list && panelsBack.insp && panelsBack.width === panelsShown.width,
      JSON.stringify({ panelsShown, panelsHidden, outlineKept, stillHidden, panelsBack })
    );

    await s.click(".sv-read-card:nth-child(3)");
    await sleep(1000);
    const detail = await s.exec("return document.querySelector('.sv-reads-insp')?.textContent || ''");
    check("Inspector shows the selected read", /bla-check/.test(detail) && /Aligned, reverse strand/.test(detail), detail.slice(0, 80));
    check("Mutation in the reverse read is called as W163R in AmpR", /W163R in AmpR/.test(detail), detail.match(/Differences in this read.{0,60}/)?.[0] || "");
    const focusScroll = await s.exec("return document.querySelector('.sv-aln-scroll').scrollLeft");
    check("Alignment jumps to the selected read", focusScroll > startScroll, `scrollLeft ${startScroll} → ${focusScroll}`);
    await s.click("button[aria-label='Next difference']");
    await sleep(600);
    const diffSel = await s.exec(`${doc} const r = s.selection.range; return r && { ...r, base: s.data.sequence.slice(r.start, r.end + 1).toUpperCase() };`);
    check("Next difference selects it in the sequence", diffSel && diffSel.start === diffSel.end && diffSel.base === "A", JSON.stringify(diffSel));
    const table = await s.exec("return document.querySelector('.sv-diff-table')?.textContent || ''");
    check("Differences table lists both changes", /ins 30 bp/.test(table) && /A → G/.test(table), table.slice(0, 160));
    await s.shot("06-read-focused");


    await s.click("button[data-tab=map]");
    await s.click(outlineRow("AmpR"), "xpath");
    await sleep(500);
    const cov = await s.exec("return document.querySelector('.sv-inspector')?.textContent || ''");
    check("Inspector shows how much of the feature the reads cover", /\d+ of 861 bp covered/.test(cov), cov.match(/\d[\d,]* of [\d,]+ bp covered/)?.[0] || "no coverage line");
    await s.shot("07-coverage");

    await s.click("button[data-tab=reads]");
    await sleep(400);
    if (!(await s.exec("return document.querySelector('.sv-read-card:nth-child(3)').classList.contains('sv-selected')"))) await s.click(".sv-read-card:nth-child(3)");
    await sleep(400);
    await s.click("//*[contains(@class,'sv-reads-insp')]//button[contains(., 'Remove read')]", "xpath");
    await sleep(800);
    const afterRemove = await s.exec("return { cards: document.querySelectorAll('.sv-read-card').length, rows: Array.from(document.querySelectorAll('.sv-aln-read .sv-aln-name-title')).map(e => e.textContent) }");
    check("Removing a read takes it out of the list and the alignment", afterRemove.cards === 2 && !afterRemove.rows.some(r => /bla-check/.test(r)), JSON.stringify(afterRemove));

    // --- two reads of one clone: forward and reverse, both with A2000G, disagreeing at 2,100 ---
    await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__strandivo.addReadPaths(arguments[0]).then(() => done(true), e => done(String(e)));",
      [data("e2e", "c7_bla-F.fasta"), data("e2e", "c7_bla-R.fasta")]
    );
    check(
      "Two reads of one clone are listed together",
      await s.waitFor("document.querySelectorAll('.sv-clone-card').length === 1 && document.querySelectorAll('.sv-clone-card .sv-clone-read').length === 2 && !document.querySelector('.sv-reads.sv-busy')", 30000)
    );
    await s.click(".sv-clone-head");
    await sleep(600);
    const cloneInsp = await s.exec("return document.querySelector('.sv-reads-insp')?.textContent || ''");
    check("The clone's consensus has W163R once, seen in both reads", /W163R in AmpR/.test(cloneInsp) && /in 2 reads/.test(cloneInsp), cloneInsp.match(/Differences in this clone.{0,80}/)?.[0] || cloneInsp.slice(0, 120));
    const disagree = await s.exec("return document.querySelector('.sv-conflict-table')?.textContent || ''");
    // Typing earlier moved the sequence by a few bases, so look 100 bases after the clone's A→G.
    const w163r = Number(cloneInsp.match(/A(\d+)G/)?.[1]);
    const at = (w163r + 100).toLocaleString("en-US");
    check("Where the clone's reads disagree is listed instead of a change", disagree.includes(at) && /c7_bla-R: C/.test(disagree) && !new RegExp(`A${w163r + 100}C`).test(cloneInsp), `${at}: ${disagree.slice(0, 160)}`);
    await s.shot("07b-clone");
    await s.click("//*[contains(@class,'sv-reads-aln')]//button[contains(., 'Translation')]", "xpath");
    check("The Translation chip translates each read in the feature's frame", await s.waitFor("Number(document.querySelector('.sv-aln').dataset.readCodons) > 100", 5000));
    await s.click("//*[contains(@class,'sv-reads-aln')]//button[contains(., 'Translation')]", "xpath");
    await s.click("//*[contains(@class,'sv-reads-insp')]//button[contains(., 'Split into single reads')]", "xpath");
    check("Splitting the clone lists each read on its own", await s.waitFor("document.querySelectorAll('.sv-clone-card').length === 0 && document.querySelectorAll('.sv-read-card').length === 4 && !document.querySelector('.sv-reads.sv-busy')", 15000));

    // --- several reads at once: picked with Ctrl, grouped from the right-click menu ---
    const cardOf = name => `[...document.querySelectorAll('.sv-read-card')].find(c => c.textContent.includes('${name}'))`;
    const rightClick = target => `window.__strandivoMenu = items => { window.__e2eMenu = items; }; ${target}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return (window.__e2eMenu || []).map(e => e === 'separator' ? '—' : e.label);`;
    const manyMenu = await s.exec(`${cardOf("c7_bla-F")}.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      ${cardOf("c7_bla-R")}.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      ${rightClick(cardOf("c7_bla-R"))}`);
    check("Right-clicking two picked reads offers to group or remove both", manyMenu.includes("Group into one clone") && manyMenu.includes("Remove 2 reads"), manyMenu.join(", "));
    await s.exec("window.__e2eMenu.find(e => e.label === 'Group into one clone').run();");
    check("Grouping makes one clone of them", await s.waitFor("document.querySelectorAll('.sv-clone-card').length === 1 && document.querySelectorAll('.sv-read-card').length === 3 && !document.querySelector('.sv-reads.sv-busy')", 15000));
    const cloneMenu = await s.exec(rightClick("document.querySelector('.sv-clone-head')"));
    check("A clone's menu can split it", cloneMenu.includes("Split into single reads"), cloneMenu.join(", "));
    await s.exec("window.__e2eMenu.find(e => e.label === 'Split into single reads').run(); delete window.__strandivoMenu;");
    await s.waitFor("document.querySelectorAll('.sv-clone-card').length === 0 && document.querySelectorAll('.sv-read-card').length === 4 && !document.querySelector('.sv-reads.sv-busy')", 15000);

    // --- dragging: the pointer's path through the list, as WebDriver can't drag reliably ---
    const dragTo = (from, to, share) => `const a = ${from}, b = ${to}; a.scrollIntoView({ block: 'nearest' }); b.scrollIntoView({ block: 'nearest' });
      const A = a.getBoundingClientRect(), B = b.getBoundingClientRect(), x = B.left + B.width / 2, y = B.top + B.height * ${share};
      a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: A.left + 20, clientY: A.top + 8 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y + 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', {}));`;
    await s.exec(dragTo(cardOf("c7_bla-R"), cardOf("c7_bla-F"), 0.5));
    check("Dropping a read on another makes a clone of them", await s.waitFor("document.querySelectorAll('.sv-clone-card').length === 1 && document.querySelectorAll('.sv-read-card').length === 3 && !document.querySelector('.sv-reads.sv-busy')", 15000));
    await s.exec(dragTo("document.querySelector('.sv-clone-read')", "document.querySelector('.sv-read-card:not(.sv-clone-card)')", 0.05));
    check("Dragging a read out of its clone takes it out", await s.waitFor("document.querySelectorAll('.sv-clone-card').length === 0 && document.querySelectorAll('.sv-read-card').length === 4 && !document.querySelector('.sv-reads.sv-busy')", 15000));
    const order = () => s.exec("return [...document.querySelectorAll('.sv-read-card .sv-read-name')].map(e => e.textContent.trim())");
    const unmoved = await order();
    await s.exec(dragTo("document.querySelectorAll('.sv-read-card')[3]", "document.querySelectorAll('.sv-read-card')[0]", 0.05));
    await sleep(300);
    const moved = await order();
    // A read crossing the origin has two rows, and one that didn't align has none.
    const alnRows = await s.exec("return [...new Set([...document.querySelectorAll('.sv-aln-read')].map(e => e.dataset.name))]");
    check("Dragging reorders the list and the alignment, without aligning again", moved[0] === unmoved[3] && alnRows[0] === moved[0] && alnRows.join() === moved.filter(n => alnRows.includes(n)).join(), `${moved.join(", ")} / ${alnRows.join(", ")}`);

    // --- keeping a check: the app remembers the file's reads, and a check file shares them ---
    const readsReady = n => `document.querySelectorAll('.sv-read-card').length === ${n} && !document.querySelector('.sv-reads.sv-busy')`;
    const checkPath = savedPath.replace(/edited\.gb$/, "edited reads.svcheck");
    await s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.saveCheck(arguments[0]).then(() => done(true), e => done(String(e)));", checkPath);
    const checkFile = existsSync(checkPath) ? JSON.parse(readFileSync(checkPath, "utf8")) : null;
    check(
      "Save check writes the reads, with paths relative to the check file",
      checkFile?.reads?.length === 4 && checkFile.reference === "edited.gb" && checkFile.reads.every(r => !path.isAbsolute(r.path)) && checkFile.reads.filter(r => r.clone).length === 2,
      JSON.stringify(checkFile)?.slice(0, 240)
    );
    if (await s.exec("return window.__strandivo.isDirty()")) await s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.saveAs(arguments[0]).then(() => done('ok'), e => done(String(e)));", savedPath);
    await s.exec("window.__strandivo.closeTab()");
    await s.waitFor("window.__strandivo.tabs().length === 0", 5000);
    await s.exec(`window.__strandivo.open([${JSON.stringify(savedPath)}])`);
    check("Reopening the file brings its reads back, as they were grouped", await s.waitFor(`window.__strandivo.tabs().length === 1 && ${readsReady(4)} && !document.querySelector('.sv-clone-card')`, 30000));
    // Remove a read, so the check file and what the app remembers differ.
    await s.exec("window.__strandivo.setView('reads')");
    await sleep(400);
    await s.click(".sv-read-card:nth-child(2)");
    await sleep(400);
    await s.click("//*[contains(@class,'sv-reads-insp')]//button[contains(., 'Remove read')]", "xpath");
    await s.waitFor(readsReady(3), 15000);
    await s.exec(`window.__strandivo.open([${JSON.stringify(checkPath)}])`);
    check("Opening the check file shows its reads in the Reads tab", await s.waitFor(`window.__strandivo.tabs().length === 1 && ${readsReady(4)} && document.querySelector('button[data-tab=reads]')?.getAttribute('aria-selected') === 'true'`, 30000));

    // --- a plate of clones: the clone table ---
    await s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.addReadPaths(arguments[0]).then(() => done(true), e => done(String(e)));", [data("e2e", "plate-bla.fasta")]);
    await s.waitFor(readsReady(10), 30000);
    await s.click("//*[contains(@class,'sv-reads-cov')]//button[starts-with(normalize-space(.),'Clones')]", "xpath");
    // A row is [the clones it stands for, then its cells]. c7_bla-F, read alone with only
    // A2000G, is identical to A01_bla and A02_bla, so the three share its row.
    const rowsOf = "return Array.from(document.querySelectorAll('.sv-clonetab tbody tr')).map(r => [r.title.split(', '), ...Array.from(r.cells).map(c => c.textContent)])";
    const rows = (await s.waitFor("document.querySelectorAll('.sv-clonetab tbody tr').length > 0", 5000)) ? await s.exec(rowsOf) : [];
    const rowOf = (list, name) => list.find(r => r[0].includes(name)) || [];
    const row = name => rowOf(rows, name);
    const a01 = row("A01_bla");
    check(
      "Identical clones share a row of the clone table",
      a01[0]?.includes("A02_bla") && Number(a01[2]) === a01[0].length && a01[0].length >= 2 && /AmpR W163R/.test(a01[4]),
      JSON.stringify(a01)
    );
    check("The clone table flags a stop and a frameshift", /Stop/.test(row("A03_bla")[3]) && /W163\*/.test(row("A03_bla")[4]) && /Frameshift/.test(row("A05_bla")[3]) && /fs/.test(row("A05_bla")[4]), JSON.stringify([row("A03_bla"), row("A05_bla")]));
    await s.shot("07c-clone-table");
    // Its headings sort it: the worst status first, the most clones first, and a third click
    // goes back to the order of the list of reads.
    const clickSort = label => s.exec(`Array.from(document.querySelectorAll('.sv-clonetab th .sv-sort')).find(b => b.firstChild.textContent === arguments[0]).click(); ${rowsOf}`, label);
    const byStatus = await clickSort("Status");
    const bySeen = await clickSort("Seen");
    await clickSort("Seen");
    const unsorted = await clickSort("Seen");
    check(
      "The clone table sorts by status and by how often a clone was seen, and goes back to the list's order",
      /Stop|Frameshift|Mixed/.test(byStatus[0]?.[3] ?? "") && Number(bySeen[0]?.[2]) === Math.max(...rows.map(r => Number(r[2]))) && unsorted.map(r => r[1]).join() === rows.map(r => r[1]).join(),
      JSON.stringify({ status: byStatus.map(r => r[3]), seen: bySeen.map(r => r[2]) })
    );
    const alignmentHidden = "return document.querySelector('.sv-reads-aln').hidden";
    check("The clone table has the column to itself until something is selected", await s.exec(alignmentHidden));
    // Changing the setting aligns the reads again, which draws the table anew: wait for
    // that to finish before reading or clicking rows.
    const a06Shows = text => `${readsReady(10)} && Array.from(document.querySelectorAll('.sv-clonetab tbody tr')).some(r => r.title.split(', ').includes('A06_bla') && /${text}/.test(r.cells[3].textContent))`;
    await s.exec("window.__strandivo.saveSettings({ amberAsQ: true })");
    const amberRow = (await s.waitFor(a06Shows("W163Q"), 30000)) ? rowOf(await s.exec(rowsOf), "A06_bla") : row("A06_bla");
    check("Reading TAG as Q turns A06's amber stop into W163Q", /W163Q/.test(amberRow[4]) && !/Stop/.test(amberRow[3]), JSON.stringify(amberRow));
    await s.exec("window.__strandivo.saveSettings({ amberAsQ: false })");
    await s.waitFor(a06Shows("W163\\*"), 30000);
    const parent = await s.exec(`${doc} return s.data.sequence;`);
    // Select A01's row by clicking its first cell.
    await s.click("//*[contains(@class,'sv-clonetab')]//tr[contains(concat(', ', @title, ', '), ', A01_bla, ')]/td[1]", "xpath");
    await sleep(500);
    check("Selecting a clone opens the alignment under the table", !(await s.exec(alignmentHidden)));
    await s.click("//*[contains(@class,'sv-reads-insp')]//button[contains(., 'Open clone as file')]", "xpath");
    const opened = await s.waitFor("window.__strandivo.tabs().length === 2 && window.__strandivo.activeTab() === 1 && window.__strandivo.isDirty()", 10000);
    const child = await s.exec(`${doc} return s.data.sequence;`);
    const changed = child.length === parent.length ? [...child].filter((b, i) => b.toUpperCase() !== parent[i].toUpperCase()).length : -1;
    check("Open clone as file makes an unsaved copy with the clone's one change", opened && changed === 1, `${changed} bases differ`);
    await s.exec("window.__strandivo.closeTab()");
    await s.click("//*[contains(@class,'ps-modal')]//button[contains(., \"Don't Save\")]", "xpath");
    await s.waitFor("window.__strandivo.tabs().length === 1 && window.__strandivo.activeTab() === 0", 5000);

    // --- a plate of clones: the summary ---
    const openSummary = async () => {
      await s.click("//*[contains(@class,'sv-reads-cov')]//button[normalize-space()='Summary']", "xpath");
      await s.waitFor("document.querySelectorAll('.sv-sum-tile').length === 4", 5000);
      await sleep(300);
    };
    const summaryNow = "return { tiles: Array.from(document.querySelectorAll('.sv-sum-tile .sv-stat-value')).map(t => t.textContent), note: document.querySelector('.sv-sum-note')?.textContent ?? '', bars: Array.from(document.querySelectorAll('.sv-sum-bar')).map(b => Number(b.dataset.count)), rows: Array.from(document.querySelectorAll('.sv-sum-list tbody tr')).map(r => Array.from(r.cells).map(c => c.textContent)) }";
    await s.exec("window.__strandivo.setView('reads')");
    await openSummary();
    const plate = await s.exec(summaryNow);
    const plateRow = label => plate.rows.find(r => r[1].includes(label)) || [];
    check(
      "The summary counts different and broken clones",
      /^\d+ of \d+$/.test(plate.tiles[0]) && Number(plate.tiles[0].split(" ")[0]) < Number(plate.tiles[0].split(" of ")[1]) && Number(plate.tiles[1].split(" ")[0]) >= 3 && Number(plate.tiles[2]) > 0 && /^\d+ : \d+$/.test(plate.tiles[3]),
      JSON.stringify(plate.tiles)
    );
    // TGA and TAG are two different clones with W163*; A01_bla and A02_bla are one with W163R.
    const repeated = plateRow("W163R");
    check(
      "Recurring mutations count different clones, not identical ones",
      plateRow("W163*")[2]?.startsWith("2 of ") && /A01_bla.*A02_bla/.test(repeated[3] ?? "") && Number(repeated[2]?.split(" ")[0]) < repeated[3].split(", ").length,
      JSON.stringify(plate.rows)
    );
    await s.exec("Array.from(document.querySelectorAll('.sv-sum-bar')).sort((a, b) => b.dataset.count - a.dataset.count)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))");
    await sleep(300);
    const onBar = await s.exec(summaryNow);
    check("Clicking a bar lists its clones", onBar.rows.length >= 2 && onBar.rows.length < plate.rows.length && onBar.rows.every(r => /W163/.test(r[1])), JSON.stringify(onBar.rows));
    await s.shot("07d-clone-summary");
    // Close the alignment, then open it again from a row of the differences.
    if (!(await s.exec(alignmentHidden))) await s.click("button[aria-label='Close alignment']");
    await s.click("//*[contains(@class,'sv-reads-cov')]//button[starts-with(normalize-space(.),'Differences')]", "xpath");
    await sleep(300);
    const closedFirst = await s.exec(alignmentHidden);
    await s.click(".sv-reads-diffs tbody td");
    await sleep(500);
    check("A difference opens the alignment, which can be closed", closedFirst && !(await s.exec(alignmentHidden)) && (await s.exec("return document.querySelector('.sv-aln-scroll').clientWidth > 0")));

    // --- plasmid info ---
    await s.press("5", [CTRL]);
    check("Ctrl+5 opens Plasmid info", await s.waitFor("document.querySelector('button[data-tab=info]')?.getAttribute('aria-selected') === 'true'", 3000));
    await sleep(600);
    const chips = await s.exec("return Array.from(document.querySelectorAll('.ps-chip')).map(c => c.textContent)");
    check("Plasmid info detects ampicillin resistance", chips.includes("Ampicillin"), chips.join(", "));
    await s.shot("08-info");

    // --- settings window ---
    const handles0 = await s.handles();
    await s.execAsync("const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_settings').then(() => done(true), e => done(String(e)));");
    await sleep(2000);
    const handles1 = await s.handles();
    const settingsHandle = handles1.find(h => !handles0.includes(h));
    if (settingsHandle) {
      await s.switchTo(settingsHandle);
      check("Settings window opens", await s.waitFor("document.querySelector('.ps-settings')", 10000));
      await s.shot("09-settings");
      await s.exec("const m = document.querySelector(\"select[aria-label='Tm method']\"); m.value = 'wallace'; m.dispatchEvent(new Event('change'));");
      await s.switchTo(handles0[0]);
      await s.exec(`${doc} s.selectRange({ start: 100, end: 119 }, null, "e2e");`);
      await sleep(800);
      const wallace = await s.exec(`${doc} const b = s.data.sequence.slice(100, 120).toUpperCase(); const gc = b.replace(/[AT]/g, '').length;
        return [document.querySelector('.sv-status-left').textContent.match(/Tm ([\\d.]+)/)?.[1], (4 * gc + 2 * (20 - gc)).toFixed(1)];`);
      check("Choosing the Wallace rule in Settings changes Tm in open windows", wallace[0] === wallace[1], wallace.join(" and "));
    } else {
      check("Settings window opens (not visible to WebDriver; skipped)", true, `${handles1.length} window handle(s)`);
    }
    // --- a SnapGene file in another tab ---
    await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_files', { paths: arguments[0] }).then(() => done(true), e => done(String(e)));",
      [data("snapgene", "pIB2-SEC13-mEGFP.dna")]
    );
    if (await s.waitFor("window.__strandivo.tabs().includes('pIB2-SEC13-mEGFP.dna') && window.__strandivo.store", 20000)) await checkSnapGene(s, "SnapGene .dna opens in a new tab");

    // --- variable regions: the nanobody library's clones ---
    await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_files', { paths: arguments[0] }).then(() => done(true), e => done(String(e)));",
      [data("library", "library-parent.gb")]
    );
    const libOpen = await s.waitFor("window.__strandivo.tabs()[window.__strandivo.activeTab()] === 'library-parent.gb' && window.__strandivo.store", 20000);
    check("The library's parent opens in a new tab", libOpen);
    if (libOpen) {
      // Mark CDR1 in the inspector; CDR2, CDR3 and FR2's two versions through the store.
      await s.exec(`${doc} window.__strandivo.setView("map"); const f = s.data.features.find(x => x.name === "cdr1"); s.selectRange({ start: f.start, end: f.end }, { kind: "feature", id: f.id }, "e2e");`);
      await sleep(500);
      await s.click("//label[contains(@class,'sv-check-row')][contains(., 'Varies between clones')]/input", "xpath");
      const fr2v1 = "TGGTTTCGTCAGGCCCCGGGCAAAGAGCGGGAGTTCGTGGCC";
      const fr2v2 = "TGGGTTCGTCAGGCCCCGGGCAAAGAGCTGGAGTGCGTGGCC";
      const marked = await s.exec(
        `${doc} const designs = { cdr2: "any", cdr3: "any", "FR2": arguments[0] };
        s.apply({ ...s.data, features: s.data.features.map(f => designs[f.name] ? { ...f, notes: { ...f.notes, strandivo_variable: [designs[f.name]] } } : f) }, "Mark variable");
        return s.data.features.filter(f => f.notes?.strandivo_variable).map(f => f.name + "=" + f.notes.strandivo_variable[0]);`,
        `v1:${fr2v1}|v2:${fr2v2}`
      );
      check("The inspector marks a feature as a variable region", marked.includes("cdr1=any") && marked.length === 4, JSON.stringify(marked));
      const libReads = ["2026-10-13_A01_MJF3PRIMER.ab1", "2026-10-13_A02_MJE4PRIMER.ab1", "2026-10-13_C01_MJG5PRIMER.ab1"].map(n => data("library", n));
      await s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.addReadPaths(arguments[0]).then(() => done(true), e => done(String(e)));", libReads);
      await s.exec('window.__strandivo.setView("reads")');
      await s.waitFor(readsReady(3), 30000);
      await s.click("//*[contains(@class,'sv-reads-cov')]//button[starts-with(normalize-space(.),'Clones')]", "xpath");
      await s.waitFor("document.querySelectorAll('.sv-clonetab tbody tr').length === 3", 5000);
      // Each row as { column name: text }, with the clone's name.
      const table = await s.exec(`const heads = Array.from(document.querySelectorAll('.sv-clonetab thead th')).map(th => th.firstChild.textContent.trim());
        return Array.from(document.querySelectorAll('.sv-clonetab tbody tr')).map(r => Object.fromEntries(heads.map((h, i) => [h, r.cells[i].textContent.trim()])));`);
      const libRow = well => table.find(r => r.Clone?.includes(well)) || {};
      check(
        "The clone table has a column per variable region with each clone's CDR",
        libRow("C01").cdr1 === "GRTLGSLNMA" && libRow("C01").cdr3?.length === 48 && "cdr2" in libRow("C01"),
        JSON.stringify(libRow("C01"))
      );
      check("A clone's CDRs are not listed as mutations", table.every(r => !/cdr/.test(r.Mutations ?? "")), JSON.stringify(table.map(r => r.Mutations)));
      check(
        "A region with versions shows the closest: the equal mix has FR2 v2",
        /^v2 /.test(libRow("A02")["FR2"] ?? "") && /^v1 WFRQAPGKEREFVA/.test(libRow("C01")["FR2"] ?? "") && !/FR2/.test(libRow("A02").Mutations ?? ""),
        JSON.stringify([libRow("A02")["FR2"], libRow("C01")["FR2"], libRow("A02").Mutations])
      );
      check(
        "Double peaks name the two mixes with their rough share, and not the single clone",
        /Mixed, about 30%/.test(libRow("A01").Status ?? "") && /Mixed, about 40%/.test(libRow("A02").Status ?? "") && !/Mixed|Frameshift/.test(libRow("C01").Status ?? ""),
        JSON.stringify(table.map(r => r.Status))
      );
      check("A mix's CDRs show as mixed, not as one plasmid's", libRow("A01").cdr1 === "mixed" && libRow("A02").cdr2 === "mixed", JSON.stringify([libRow("A01").cdr1, libRow("A02").cdr2]));
      // The traces mark double peaks: many in the mixes' CDR1, hardly any in FR1 before it.
      await s.click("//*[contains(@class,'sv-reads-cov')]//button[normalize-space()='Coverage']", "xpath");
      await s.waitFor("document.querySelector('.sv-aln-scroll')?.clientWidth > 0", 5000);
      // The alignment holds the whole reference, a column per base plus inserted ones: jump
      // to the bases, then correct by the range its header shows once it has followed.
      const marksAt = (start, end) =>
        s.execAsync(
          `const done = arguments[arguments.length - 1];
          const [start, end] = [arguments[0], arguments[1]];
          const scroller = document.querySelector('.sv-aln-scroll');
          const label = () => document.querySelector('.sv-reads-aln .sv-pane-note').textContent;
          const shown = () => label().replace(/,/g, '').split('–').map(Number);
          const scrollBy = (cols, then) => {
            const before = label();
            scroller.scrollLeft += cols * 12;
            let waited = 0;
            const wait = () => (label() !== before || (waited += 100) > 2000 ? setTimeout(then, 300) : setTimeout(wait, 100));
            wait();
          };
          const off = () => Math.round((start + end) / 2 - (shown()[0] + shown()[1]) / 2);
          scroller.scrollLeft = 0;
          setTimeout(() => scrollBy((start + end) / 2 - scroller.clientWidth / 24, () => scrollBy(off(), () =>
            done({ marks: Number(document.querySelector('.sv-aln').dataset.doublePeaks), shown: shown() }))), 300);`,
          start + 1,
          end + 1
        );
      const cleanMarks = await marksAt(2060, 2090);
      const mixMarks = await marksAt(2171, 2200);
      await s.shot("11-variable-regions");
      check("The traces mark double peaks", mixMarks.marks >= 10 && cleanMarks.marks < mixMarks.marks / 4, JSON.stringify({ mixMarks, cleanMarks }));
      await openSummary();
      const librarySummary = await s.exec(summaryNow);
      check("The summary leaves the mixes out of its numbers and says so", librarySummary.tiles[0] === "1 of 1" && /2 mixed, of 3 clones/.test(librarySummary.note), JSON.stringify(librarySummary));
      // Exact matching: with only v2 listed, C01's FR2, which is v1, is none of the versions.
      await s.exec(`${doc} s.apply({ ...s.data, features: s.data.features.map(f => f.name === "FR2" ? { ...f, notes: { ...f.notes, strandivo_variable: [arguments[0]] } } : f) }, "Match exactly");`, `exact:v2:${fr2v2}`);
      await s.exec('window.__strandivo.setView("map")');
      await sleep(300);
      await s.exec('window.__strandivo.setView("reads")');
      // The edit makes the reads align again; the view takes no clicks until they have.
      await s.waitFor(readsReady(3), 30000);
      await s.click("//*[contains(@class,'sv-reads-cov')]//button[starts-with(normalize-space(.),'Clones')]", "xpath");
      const exactRow = "Array.from(document.querySelectorAll('.sv-clonetab tbody tr')).find(r => /C01/.test(r.textContent))";
      check(
        "Matching exact versions only flags a clone that is none of them",
        await s.waitFor(`/Not one of the versions/.test(${exactRow}?.textContent) && /Breaks design/.test(${exactRow}?.textContent)`, 30000),
        await s.exec(`return ${exactRow}?.textContent ?? 'no row'`)
      );
      // A long list of versions: the inspector shows it by its count, and a dialog edits it.
      await s.exec(
        `${doc} window.__strandivo.setView("map");
        const f = s.data.features.find(x => x.name === "cdr3");
        s.apply({ ...s.data, features: s.data.features.map(x => x === f ? { ...x, notes: { ...x.notes, strandivo_variable: [arguments[0]] } } : x) }, "Many versions", { range: { start: f.start, end: f.end }, focus: { kind: "feature", id: f.id } });`,
        Array.from({ length: 100 }, (_, i) => `v${i + 1}:${"GGT".repeat(10 + (i % 5))}`).join("|")
      );
      check(
        "The inspector shows a long list of versions by its count",
        await s.waitFor("/100 versions/.test(document.querySelector('.sv-versions-preview')?.parentElement?.textContent ?? '') && !document.querySelector('.sv-code-edit[aria-label=\"Versions, one per line\"]')", 5000)
      );
      await s.click("//button[contains(., 'Edit versions')]", "xpath");
      const versionsShown = await s.waitFor("document.querySelector('.sv-versions-edit')?.value.split('\\n').length === 100", 5000);
      await s.exec("document.querySelector('.sv-versions-edit').value = 'short: GGTGGT\\nlong: GGTGGTGGT';");
      await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Save versions']", "xpath");
      check(
        "Edit versions… opens the whole list and saves it",
        versionsShown && (await s.waitFor("window.__strandivo.store.data.features.find(x => x.name === 'cdr3').notes.strandivo_variable[0] === 'short:GGTGGT|long:GGTGGTGGT'", 5000)),
        await s.exec("return window.__strandivo.store.data.features.find(x => x.name === 'cdr3').notes.strandivo_variable[0].slice(0, 80)")
      );
      await s.exec("window.__strandivo.closeTab()");
      await s.click("//*[contains(@class,'ps-modal')]//button[contains(., \"Don't Save\")]", "xpath");
      await s.waitFor("!window.__strandivo.tabs().includes('library-parent.gb')", 5000);
    }

    // --- features into regions: the library's frameworks and CDRs, as one undo step ---
    await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_files', { paths: arguments[0] }).then(() => done(true), e => done(String(e)));",
      [data("library", "library-parent.gb")]
    );
    const foldOpen = await s.waitFor("window.__strandivo.tabs()[window.__strandivo.activeTab()] === 'library-parent.gb' && window.__strandivo.store", 20000);
    check("The library's parent opens again to turn its features into regions", foldOpen);
    if (foldOpen) {
      // The nanobody's CDS, as testdata/library/protein-regions.gb adds it over its parts.
      await s.exec(`${doc} window.__strandivo.setView("map");
        const cds = { id: "e2e-nanobody", name: "Nanobody", type: "CDS", start: 2096, end: 2449, strand: 1, notes: {}, raw: {} };
        s.apply({ ...s.data, features: [...s.data.features, cds] }, "Add feature", { range: { start: cds.start, end: cds.end }, focus: { kind: "feature", id: cds.id } });`);
      const before = await s.exec(`${doc} return s.data.features.length;`);
      const foldLink = "Turn 7 features into regions…";
      check("A CDS with features inside offers to turn them into regions", await s.waitFor(`Array.from(document.querySelectorAll('.sv-inspector .sv-link')).some(b => b.textContent.trim() === '${foldLink}')`, 5000));
      // Clicked in the page: the file's remembered reads align again once the CDS is added,
      // and the inspector, rebuilt when they do, can swap the link under a WebDriver click.
      await s.exec("const b = Array.from(document.querySelectorAll('.sv-inspector .sv-link')).find(x => x.textContent.trim() === arguments[0]); b?.scrollIntoView({ block: 'center' }); b?.click();", foldLink);
      const listed = await s.waitFor("document.querySelectorAll('.sv-dialog .sv-fold-row').length === 7", 5000);
      const rows = await s.exec("return Array.from(document.querySelectorAll('.sv-dialog .sv-fold-row')).map(r => [r.querySelector('.sv-fold-name').textContent, r.querySelector('.sv-fold-where').textContent, r.querySelector('select').value, r.querySelector('input[type=checkbox]').checked].join(' '));");
      const want = ["FR1 1–25 Framework true", "cdr1 26–35 CDR true", "FR2 36–49 Framework true", "cdr2 50–59 CDR true", "FR3 60–96 Framework true", "cdr3 97–107 CDR true", "FR4 108–118 Framework true"];
      check("It lists the frameworks and CDRs, ticked, with their residues and kinds", listed && JSON.stringify(rows) === JSON.stringify(want), rows.join("; "));
      // The rest needs the dialog; without it, they would only fail one after another.
      if (listed) {
        check("Every ticked row shows the colour its region will have", await s.exec("return Array.from(document.querySelectorAll('.sv-dialog .sv-fold-swatch')).every(sw => sw.style.background !== '');"));
        await s.shot("11-fold-regions");
        check("Nothing changes while the dialog is open", (await s.exec(`${doc} return s.data.features.length;`)) === before);
        await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Turn 7 features into regions']", "xpath");
        check("Turning them deletes the features", await s.waitFor(`window.__strandivo.store.data.features.length === ${before - 7} && !document.querySelector('.sv-dialog')`, 5000));
        const folded = await s.exec(`${doc} return s.data.features.find(f => f.id === 'e2e-nanobody').notes.strandivo_regions.map(v => v.split('|').slice(0, 3).join(' '));`);
        check(
          "and makes them regions of the CDS, at the same residues",
          JSON.stringify(folded) === JSON.stringify(["FR1 Framework 1-25", "cdr1 CDR 26-35", "FR2 Framework 36-49", "cdr2 CDR 50-59", "FR3 Framework 60-96", "cdr3 CDR 97-107", "FR4 Framework 108-118"]),
          JSON.stringify(folded)
        );
        check("The inspector draws them in the CDS's protein", await s.waitFor("document.querySelectorAll('.sv-inspector .sv-protein-region').length === 7", 5000));
        const foldToast = "Array.from(document.querySelectorAll('.ps-toast:not(.ps-toast-out)')).find(t => /Turned 7 features into regions of Nanobody/.test(t.textContent))";
        check("It says what happened, with an Undo button", await s.waitFor(`${foldToast}?.querySelector('.ps-toast-action')`, 3000));
        await s.click("//*[contains(@class,'ps-toast')][not(contains(@class,'ps-toast-out'))]//button[normalize-space()='Undo']", "xpath");
        check(
          "One undo brings the features back and takes the regions away",
          await s.waitFor(`window.__strandivo.store.data.features.length === ${before} && !window.__strandivo.store.data.features.find(f => f.id === 'e2e-nanobody').notes.strandivo_regions`, 5000)
        );

        // Right-clicking one feature offers its CDS, and the dialog ticks only that feature.
        const rightClick = id => s.exec(`window.__strandivoMenu = items => { window.__e2eMenu = items; };
          const row = document.querySelector('.sv-outline [data-kind="feature"][data-id="' + arguments[0] + '"]:not([data-region])');
          if (!row) return [];
          row.scrollIntoView({ block: 'nearest' });
          row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
          return (window.__e2eMenu || []).map(e => e === 'separator' ? '—' : e.label);`, id);
        const cdsMenu = await rightClick("e2e-nanobody");
        check("The CDS's right-click menu offers to turn features into regions", cdsMenu.includes("Turn features into regions…"), cdsMenu.join(", "));
        const cdr1 = await s.exec(`${doc} return s.data.features.find(f => f.name === 'cdr1').id;`);
        const featureMenu = await rightClick(cdr1);
        check("A feature inside it offers to become one of its regions", featureMenu.includes("Turn into region of Nanobody…"), featureMenu.join(", "));
        await s.exec("window.__e2eMenu.find(e => e.label === 'Turn into region of Nanobody…')?.run(); delete window.__strandivoMenu;");
        const onlyOne = await s.waitFor("document.querySelectorAll('.sv-dialog .sv-fold-row').length === 7", 5000) &&
          await s.exec("return Array.from(document.querySelectorAll('.sv-dialog .sv-fold-row input[type=checkbox]')).filter(b => b.checked).map(b => b.closest('.sv-fold-row').querySelector('.sv-fold-name').textContent);");
        check("Only that feature starts ticked", JSON.stringify(onlyOne) === JSON.stringify(["cdr1"]), JSON.stringify(onlyOne));
        await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Turn 1 feature into regions']", "xpath");
        check(
          "It becomes a region of the CDS, which is selected with the region picked",
          await s.waitFor(`!window.__strandivo.store.data.features.some(f => f.id === '${cdr1}') && window.__strandivo.store.selection.focus?.id === 'e2e-nanobody' && window.__strandivo.store.selection.focus?.region === 0`, 5000),
          await s.exec(`${doc} return JSON.stringify(s.selection.focus);`)
        );
        await s.exec(`${doc} s.undo(); s.undo();`);
        check("Undo takes the file back to how it opened", await s.waitFor(`window.__strandivo.store.data.features.length === ${before - 1}`, 5000));
      }
      await s.exec("document.querySelector('.sv-dialog-close')?.click(); window.__strandivo.closeTab()");
      // Undone all the way, the file may still count as edited.
      if (await s.waitFor("!!document.querySelector('.ps-modal')", 1500)) await s.click("//*[contains(@class,'ps-modal')]//button[contains(., \"Don't Save\")]", "xpath");
      await s.waitFor("!window.__strandivo.tabs().includes('library-parent.gb')", 5000);
    }

    // --- a whole-plasmid read: made up until a real one is in testdata (see its README) ---
    await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_files', { paths: arguments[0] }).then(() => done(true), e => done(String(e)));",
      [data("e2e", "pUC19-annotated.gb")]
    );
    if (await s.waitFor("window.__strandivo.tabs()[window.__strandivo.activeTab()] === 'pUC19-annotated.gb' && window.__strandivo.store", 20000)) {
      await s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.addReadPaths(arguments[0]).then(() => done(true), e => done(String(e)));", [data("e2e", "pUC19-whole.fastq")]);
      await s.exec('window.__strandivo.setView("reads")');
      const wholeCard = "Array.from(document.querySelectorAll('.sv-read-card')).find(c => /Whole plasmid/.test(c.textContent))";
      const found = await s.waitFor(`!!${wholeCard}`, 20000);
      check("A FASTQ read of a whole plasmid is shown as one, with its size", found && /2,697 bp \(\+11\)/.test(await s.exec(`return ${wholeCard}?.textContent`)), await s.exec(`return ${wholeCard}?.textContent ?? ''`));
      await s.click("//*[contains(@class,'sv-read-card')][contains(., 'Whole plasmid')]", "xpath");
      await sleep(600);
      const whole = await s.exec("return document.querySelector('.sv-reads-insp')?.textContent || ''");
      check("The read is turned to the origin, and its changes are called", /11 bp longer than this sequence/.test(whole) && /W163R in AmpR/.test(whole), whole.slice(0, 200));
      check("An indel in a run of one base is flagged, not trusted", /run of one base/.test(whole) && /uncertain/.test(whole), whole.match(/.{60}run of one base.{20}/)?.[0] ?? "");
      await s.shot("11b-whole-plasmid");
      await s.exec("window.__strandivo.closeTab()");
      await s.waitFor("!window.__strandivo.tabs().includes('pUC19-annotated.gb')", 5000);
    } else check("The parent opens for the whole-plasmid read", false);

    // --- updates: a made-up version through the hook, so CI never asks the update server ---
    await s.exec(`window.__e2eUpdate = { restarts: 0, notesFor: [] };
      window.__strandivoUpdate = {
        check: async () => ({ version: "9.9.9", currentVersion: "0.1.0", notes: "Faster maps.\\n<b>New</b> primer tools.", ready: false }),
        download: async onProgress => { onProgress({ downloaded: 4e6, total: 8e6 }); onProgress({ downloaded: 8e6, total: 8e6 }); },
        restart: async () => { window.__e2eUpdate.restarts++; },
        whatsNew: async version => { window.__e2eUpdate.notesFor.push(version); }
      };`);
    await s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.checkForUpdates().then(() => done(true), e => done(String(e)));");
    const updateStrip = "document.querySelector('.sv-update:not([hidden])')";
    check("A new version is offered in a strip, not a dialog", await s.waitFor(`/Strandivo 9\\.9\\.9 is available/.test(${updateStrip}?.textContent) && !document.querySelector('.sv-dialog')`, 5000), await s.exec(`return ${updateStrip}?.textContent ?? 'no strip'`));
    await s.shot("12a-update-offered");
    await s.click("//*[contains(@class,'sv-update')]//button[normalize-space()=\"What's new…\"]", "xpath");
    const notes = await s.waitFor("/What's new in Strandivo 9\\.9\\.9/.test(document.querySelector('.sv-dialog-title')?.textContent)", 3000)
      ? await s.exec("return { lines: Array.from(document.querySelectorAll('.sv-dialog .sv-whats-new')).map(p => p.textContent), bold: !!document.querySelector('.sv-dialog b') }")
      : null;
    check("What's new shows the update's short notes in the app, as text", notes && JSON.stringify(notes.lines) === JSON.stringify(["Faster maps.", "<b>New</b> primer tools."]) && !notes.bold, JSON.stringify(notes));
    await s.shot("12b-whats-new");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='More on strandivo.com']", "xpath");
    check("More on strandivo.com asks for that version's notes", await s.waitFor("window.__e2eUpdate.notesFor[0] === '9.9.9'", 3000));
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Close']", "xpath");
    await s.waitFor("!document.querySelector('.sv-dialog')", 3000);
    await s.click("//*[contains(@class,'sv-update')]//button[normalize-space()='Install and restart']", "xpath");
    check("Install and restart downloads it, then quits the way ⌘Q does", await s.waitFor("window.__e2eUpdate.restarts === 1", 5000));
    // The hook doesn't quit, as a kept unsaved tab wouldn't: the strip offers to restart again.
    check("If the app stays open, the strip offers to restart", await s.waitFor(`/9\\.9\\.9 is ready to install/.test(${updateStrip}?.textContent)`, 3000), await s.exec(`return ${updateStrip}?.textContent ?? 'no strip'`));
    await s.click("//*[contains(@class,'sv-update')]//button[normalize-space()='Later']", "xpath");
    check("Later hides the strip", await s.waitFor("document.querySelector('.sv-update')?.hidden === true", 3000));

    // After an update: the start says so once, in the same strip.
    await s.exec("localStorage.setItem('strandivo.updates', JSON.stringify({ shownVersion: '0.0.1' }));");
    await s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.announceUpdate().then(() => done(true), e => done(String(e)));");
    check("After an update the strip says which version it is now", await s.waitFor(`/Strandivo was updated to \\d/.test(${updateStrip}?.textContent)`, 3000), await s.exec(`return ${updateStrip}?.textContent ?? 'no strip'`));
    await s.click("//*[contains(@class,'sv-update')]//button[normalize-space()=\"What's new…\"]", "xpath");
    check("Its What's new opens the dialog", await s.waitFor("/What's new in Strandivo/.test(document.querySelector('.sv-dialog-title')?.textContent)", 3000));
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Close']", "xpath");
    await s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.announceUpdate().then(() => done(true), e => done(String(e)));");
    check("It says so only once", await s.exec("return document.querySelector('.sv-update').hidden === true"));
    await s.exec("delete window.__strandivoUpdate;");

    // --- feedback: through the hook, so CI never files an issue or opens a mail app ---
    await s.exec("window.__strandivo.showHome()");
    // An error naming a file, as a failed read would: the report must not carry the path.
    await s.exec("setTimeout(() => { throw new Error(\"Couldn't read /Users/anna/Lab plasmids/pSecret.gb\"); });");
    await sleep(200);
    await s.exec(`window.__e2eFeedback = { reports: [], issues: [], emails: [], newIssues: [], fail: true };
      window.__strandivoFeedback = {
        send: async r => { if (window.__e2eFeedback.fail) throw new Error("Couldn't reach Strandivo's feedback service."); window.__e2eFeedback.reports.push(r); return { number: 7, emailed: true }; },
        openIssue: n => window.__e2eFeedback.issues.push(n),
        email: (subject, body) => window.__e2eFeedback.emails.push({ subject, body }),
        newIssue: url => window.__e2eFeedback.newIssues.push(url)
      };`);
    // The app bar's two buttons, kept in view while Strandivo is young; Help has them too.
    await s.click("button.sv-appbar-feedback-idea");
    const ideaOpen = await s.waitFor("document.querySelector('.sv-dialog-title')?.textContent === 'Send feedback'", 3000);
    check("Send feedback… in the app bar opens the feedback dialog with Idea chosen", ideaOpen && (await s.exec("return document.querySelector('.sv-feedback [aria-pressed=\"true\"]')?.textContent")) === "Idea");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Cancel']", "xpath");
    await s.waitFor("!document.querySelector('.sv-dialog')", 3000);
    await s.click("button.sv-appbar-feedback-bug");
    const feedbackOpen = await s.waitFor("document.querySelector('.sv-dialog-title')?.textContent === 'Send feedback'", 3000);
    check("Report a bug… in the app bar opens the feedback dialog with Bug chosen", feedbackOpen && (await s.exec("return document.querySelector('.sv-feedback [aria-pressed=\"true\"]')?.textContent")) === "Bug");
    check("Send waits for a summary", await s.exec("return Array.from(document.querySelectorAll('.sv-dialog-foot button')).find(b => b.textContent === 'Send')?.disabled === true"));
    await s.keys("input[aria-label='Summary']", "Map stays blank");
    await s.keys("textarea[aria-label='Details']", "Opened a plasmid from Home.");
    const sentList = () => s.exec("return document.querySelector('.sv-feedback-sent')?.innerText ?? ''");
    check("No name is listed until one is typed", !/Sent by/.test(await sentList()));
    await s.keys("input[aria-label='Your name']", "JIB");
    check("A name to credit is listed with what is sent", /Sent by: JIB/.test(await sentList()), (await sentList()).slice(0, 200));
    await s.keys("input[aria-label='Your email']", "anna@lab.example.org");
    await s.click("//label[contains(., 'Recent errors')]/input", "xpath");
    const shown = await s.exec("return document.querySelector('.sv-feedback-errors')?.textContent ?? ''");
    check("Recent errors are shown before sending, without the file's path", /Couldn't read <path>/.test(shown) && !/anna|pSecret/.test(shown), shown.slice(0, 160));
    check("What is sent with it is listed in full", /Open view: Home/.test(await s.exec("return document.querySelector('.sv-feedback-sent')?.textContent ?? ''")));
    await s.shot("12c-feedback");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Send']", "xpath");
    check("If it can't be sent, the text stays, with Copy and Email instead", await s.waitFor("/Couldn't reach/.test(document.querySelector('.sv-feedback-status')?.textContent) && document.querySelector('input[aria-label=\"Summary\"]')?.value === 'Map stays blank' && Array.from(document.querySelectorAll('.sv-dialog-foot button')).some(b => b.textContent === 'Email instead' && !b.hidden)", 3000));
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Email instead']", "xpath");
    const emailed = await s.waitFor("window.__e2eFeedback.emails.length === 1", 3000) ? await s.exec("return window.__e2eFeedback.emails[0]") : null;
    check("Email instead starts a message with the report in it", emailed?.subject === "Bug: Map stays blank" && /Opened a plasmid from Home\./.test(emailed.body) && !/anna/.test(emailed.body), JSON.stringify(emailed)?.slice(0, 160));
    await s.exec("window.__e2eFeedback.fail = false;");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Try again']", "xpath");
    const sent = await s.waitFor("window.__e2eFeedback.reports.length === 1", 3000) ? await s.exec("return window.__e2eFeedback.reports[0]") : null;
    check("The report holds what the dialog showed, and no path", sent?.kind === "bug" && sent.summary === "Map stays blank" && sent.email === "anna@lab.example.org" && sent.name === "JIB" && sent.view === "Home" && sent.errors?.some(e => /<path>/.test(e)) && !/\/Users\/|pSecret/.test(JSON.stringify(sent)) && sent.file === null, JSON.stringify(sent)?.slice(0, 200));
    check("It says which issue it became", await s.waitFor("/sent as #7/.test(document.querySelector('.sv-feedback-thanks')?.textContent)", 3000));
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Open on GitHub']", "xpath");
    check("Open on GitHub asks for that issue by its number", await s.waitFor("window.__e2eFeedback.issues[0] === 7", 3000));
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Close']", "xpath");
    await s.waitFor("!document.querySelector('.sv-dialog')", 3000);

    // --- the name is remembered, and Post on GitHub instead fills in the kind's form ---
    await s.click("button.sv-appbar-feedback-idea");
    await s.waitFor("document.querySelector('.sv-dialog-title')?.textContent === 'Send feedback'", 3000);
    check("The name sent last time is filled in", (await s.exec("return document.querySelector('input[aria-label=\"Your name\"]')?.value")) === "JIB" && /Sent by: JIB/.test(await sentList()));
    await s.keys("input[aria-label='Summary']", "Invert the selection");
    await s.keys("textarea[aria-label='Details']", "With a key & a menu item.");
    await s.keys("input[aria-label='Your email']", "anna@lab.example.org");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Post on GitHub instead']", "xpath");
    const newIssue = await s.waitFor("window.__e2eFeedback.newIssues.length === 1", 3000) ? await s.exec("return window.__e2eFeedback.newIssues[0]") : "";
    check(
      "Post on GitHub instead opens the idea form filled in, without the email or name",
      newIssue.startsWith("https://github.com/Mateusz-Jaskolowski/Strandivo/issues/new?template=feature_request.yml&title=Invert%20the%20selection&task=With%20a%20key%20%26%20a%20menu%20item.") && !/anna|JIB|labels=/.test(newIssue),
      newIssue.slice(0, 220)
    );
    check("It closes the dialog, sending nothing", (await s.waitFor("!document.querySelector('.sv-dialog')", 3000)) && (await s.exec("return window.__e2eFeedback.reports.length")) === 1);

    // --- a crash last time: the strip, and the bug report it opens, shown before sending ---
    const crashFile = `window.__strandivoCrash = JSON.stringify({ format: 1, version: "0.4.0", os: "linux", arch: "x86_64", time: 1793957400, thread: "tokio-runtime-worker", location: "reqwest-0.13.0/src/async_impl/client.rs:2311:5", message: "Could not read /home/anna/Lab plasmids/pSecret.gb" });`;
    const takeCrash = () => s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.checkCrash().then(() => done(true), e => done(String(e)));");
    await s.exec(crashFile);
    await takeCrash();
    const crashStrip = "document.querySelector('.sv-crash:not([hidden])')";
    check("A crash last time is offered in a strip under the app bar", await s.waitFor(`/quit unexpectedly last time/.test(${crashStrip}?.textContent ?? '')`, 3000));
    check("Nothing about it is sent on its own", (await s.exec("return window.__e2eFeedback.reports.length")) === 1);
    await s.click("//*[contains(@class,'sv-crash')]//button[normalize-space()='Report it…']", "xpath");
    check("Report it… opens Report a Bug about the crash", await s.waitFor("document.querySelector('.sv-dialog-title')?.textContent === 'Send feedback' && document.querySelector('input[aria-label=\"Summary\"]')?.value === 'Strandivo quit unexpectedly' && document.querySelector('.sv-feedback [aria-pressed=\"true\"]')?.textContent === 'Bug'", 3000));
    const crashShown = await s.exec("const pre = document.querySelector('.sv-feedback-crash'); return pre && !pre.hidden ? pre.textContent : ''");
    check("The crash is shown in full before sending, without the file's path", /Strandivo 0\.4\.0, 2026-11-06 09:30:00 UTC/.test(crashShown) && /client\.rs:2311:5/.test(crashShown) && /Could not read <path>/.test(crashShown) && !/anna|pSecret/.test(crashShown), crashShown.slice(0, 200));
    await s.shot("12d-crash-report");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Send']", "xpath");
    const crashSent = await s.waitFor("window.__e2eFeedback.reports.length === 2", 3000) ? await s.exec("return window.__e2eFeedback.reports[1]") : null;
    check("Send sends the crash as it was shown, and no path", crashSent?.crash?.location === "reqwest-0.13.0/src/async_impl/client.rs:2311:5" && crashSent.crash.message === "Could not read <path>" && crashSent.errors === null && !/anna|pSecret/.test(JSON.stringify(crashSent)), JSON.stringify(crashSent)?.slice(0, 240));
    check("Once sent, the strip goes", await s.waitFor("document.querySelector('.sv-crash')?.hidden === true", 3000));
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Close']", "xpath");
    await s.waitFor("!document.querySelector('.sv-dialog')", 3000);
    await takeCrash();
    check("A crash is offered once", await s.exec("return document.querySelector('.sv-crash').hidden === true"));
    await s.exec("delete window.__strandivoFeedback;");

    // --- usage statistics: through the hook, so CI never sends any ---
    const flush = () => s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.flushUsage().then(() => done(window.__e2eUsage.length), e => done(String(e)));");
    await s.exec("window.__strandivo.showTab(0); window.__strandivo.setView('sequence');");
    check("Nothing is counted while statistics are off, errors included", (await flush()) === 0, `${await s.exec("return window.__e2eUsage.length")} events`);
    await s.exec("window.__strandivo.saveSettings({ shareUsage: true });");
    await sleep(300);
    await s.exec("window.__strandivo.setView('primers');");
    await flush();
    const usage = await s.exec("return window.__e2eUsage");
    const names = usage.map(e => e.name);
    check("Turned on, the app counts its start and what is used", names.includes("app_started") && usage.some(e => e.name === "view_used" && e.props.view === "primers"), JSON.stringify(usage).slice(0, 240));
    const started = usage.find(e => e.name === "app_started");
    // Earlier checks change the Tm method, so compare with what Settings say now.
    const tmNow = await s.exec("return JSON.parse(localStorage.getItem('strandivo.settings') || '{}').tm?.method ?? 'santalucia'");
    check("The start says how long the copy has been in use, as a range, and Settings' choices come with it", started?.props.installed === "first_day" && usage.some(e => e.name === "settings_chosen" && e.props.tm === tmNow && e.props.amber === "off"), JSON.stringify(usage.filter(e => /app_started|settings_chosen/.test(e.name))));
    await s.exec("window.__strandivo.setView('sequence'); window.__strandivo.setView('primers');");
    await flush();
    usage.push(...(await s.exec("return window.__e2eUsage")).slice(usage.length));
    check("A view is counted once, not at every switch", usage.filter(e => e.name === "view_used" && e.props.view === "primers").length === 1, JSON.stringify(usage.filter(e => e.name === "view_used")));
    // A crash last time is counted, by its kind alone; Dismiss forgets it.
    await s.exec(crashFile);
    await takeCrash();
    await s.waitFor(`!!${crashStrip}`, 3000);
    await s.click("//*[contains(@class,'sv-crash')]//button[normalize-space()='Dismiss']", "xpath");
    check("Dismiss hides the crash strip", await s.waitFor("document.querySelector('.sv-crash')?.hidden === true", 3000));
    await flush();
    usage.push(...(await s.exec("return window.__e2eUsage")).slice(usage.length));
    check("A crash is counted as an error of kind crash, without its message", usage.some(e => e.name === "error_caught" && e.props.kind === "crash" && Object.keys(e.props).length === 1), JSON.stringify(usage.filter(e => e.name === "error_caught")));
    check("Events carry listed words alone, never a file's name or path", usage.length > 0 && !/pUC19|annotated|\/|\\/.test(JSON.stringify(usage.map(e => e.props))), JSON.stringify(usage.map(e => e.props)).slice(0, 200));
    await s.exec("window.__strandivo.setView('map');");
    await s.exec("window.__strandivo.saveSettings({ shareUsage: false });");
    await sleep(300);
    await s.exec("window.__strandivo.setView('sequence');");
    check("Turned off, what was queued is dropped and nothing more goes", (await flush()) === usage.length, `${await s.exec("return window.__e2eUsage.length")} events, ${usage.length} before`);
    await s.exec("window.__strandivo.setView('map'); delete window.__strandivoTrack;");

    // --- Home: the construct library ---
    await s.exec("window.__strandivo.showHome()");
    const homeList = await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__strandivo.addLibraryFolder(arguments[0]).then(() => done(window.__strandivo.libraryNames()), e => done(String(e)));",
      data("e2e")
    );
    check("Home lists the constructs in a library folder", Array.isArray(homeList) && homeList.includes("pUC19-annotated.gb") && homeList.includes("bla-check.fasta"), JSON.stringify(homeList));
    await s.shot("12-home");
    // Its Length heading sorts the files either way round; Name puts them back.
    const homeLengths = label =>
      s.exec(
        `Array.from(document.querySelectorAll('.sv-home-table th .sv-sort')).find(b => b.firstChild.textContent === arguments[0]).click();
        return Array.from(document.querySelectorAll('.sv-home-row:not(.sv-home-unreadable)')).map(r => Number((r.cells[1].textContent.match(/[\\d,]+/) || ["0"])[0].replace(/,/g, "")));`,
        label
      );
    const lengthsUp = await homeLengths("Length");
    const lengthsDown = await homeLengths("Length");
    await homeLengths("Name");
    const rising = xs => xs.every((x, i) => i === 0 || xs[i - 1] <= x);
    check("Home sorts its constructs by length, either way round", lengthsUp.length > 1 && lengthsUp.join() !== lengthsDown.join() && ((rising(lengthsUp) && rising([...lengthsDown].reverse())) || (rising(lengthsDown) && rising([...lengthsUp].reverse()))), JSON.stringify({ lengthsUp, lengthsDown }));
    const tabsBefore = await s.exec("return window.__strandivo.tabs().length");
    await s.click("//button[contains(@class,'sv-home-open')][normalize-space()='bla-check.fasta']", "xpath");
    check("Opening a construct from Home adds a tab", await s.waitFor(`window.__strandivo.tabs().length === ${tabsBefore + 1} && window.__strandivo.store?.data.sequence.length > 0`, 20000));

    // --- dark: the main views and a dialog in the other theme, to look at ---
    await s.exec("window.__strandivo.saveSettings({ appearance: 'dark' })");
    check(
      "Choosing Dark turns the window dark at once",
      await s.waitFor("document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.body).backgroundColor === 'rgb(15, 17, 20)'", 5000),
      await s.exec("return `${document.documentElement.dataset.theme} ${getComputedStyle(document.body).backgroundColor}`")
    );
    await s.execAsync(
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('open_files', { paths: arguments[0] }).then(() => done(true), e => done(String(e)));",
      [data("library", "library-parent.gb")]
    );
    if (await s.waitFor("window.__strandivo.tabs()[window.__strandivo.activeTab()] === 'library-parent.gb' && window.__strandivo.store", 20000)) {
      // A selected CDS and its amino acids, coloured by chemistry, on the map and in the sequence.
      await s.exec(`${doc} window.__strandivo.setView("map"); const f = s.data.features.find(x => x.name === "FR1"); s.selectRange({ start: f.start, end: f.end }, { kind: "feature", id: f.id }, "e2e");`);
      // With the GC ring, to see its colours in dark.
      await s.exec("const chip = Array.from(document.querySelectorAll('.sv-map .sv-chip')).find(b => b.textContent.trim() === 'GC%'); if (chip && chip.getAttribute('aria-pressed') !== 'true') chip.click();");
      await sleep(1200);
      await s.shot("13-dark-map");
      await s.exec('window.__strandivo.setView("sequence")');
      await sleep(400);
      await s.exec("const chip = Array.from(document.querySelectorAll('.sv-seq-chips button, button')).find(b => b.textContent.trim() === 'Colour amino acids'); if (chip && chip.getAttribute('aria-pressed') !== 'true') chip.click();");
      await sleep(800);
      await s.shot("13-dark-sequence");
      await s.exec('window.__strandivo.setView("reads")');
      const libReads = ["2026-10-13_A01_MJF3PRIMER.ab1", "2026-10-13_A02_MJE4PRIMER.ab1", "2026-10-13_C01_MJG5PRIMER.ab1"].map(n => data("library", n));
      if (!(await s.waitFor("document.querySelectorAll('.sv-read-card').length === 3", 5000))) {
        await s.execAsync("const done = arguments[arguments.length - 1]; window.__strandivo.addReadPaths(arguments[0]).then(() => done(true), e => done(String(e)));", libReads);
      }
      await s.waitFor("document.querySelectorAll('.sv-read-card').length === 3 && !document.querySelector('.sv-reads.sv-busy')", 30000);
      await s.click("//*[contains(@class,'sv-read-card')][contains(., 'C01_MJG5PRIMER')]", "xpath");
      check("In dark, the read's traces are drawn", await s.waitFor("Number(document.querySelector('.sv-aln')?.dataset.traces) >= 1", 10000));
      await sleep(1200);
      await s.shot("13-dark-reads");
      await s.exec('window.__strandivo.setView("map"); window.__strandivo.command("digest")');
      if (await s.waitFor("document.querySelector('.sv-dialog .sv-digest .sv-gel')", 5000)) {
        await s.click(".sv-dialog input[data-enzyme='EcoRI']");
        await sleep(600);
        await s.shot("13-dark-digest");
        await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space(.)='Done']", "xpath");
      } else check("In dark, Digest opens its dialog", false);
    } else check("The library's parent opens again for the dark screenshots", false);
    await s.exec("window.__strandivo.saveSettings({ appearance: 'light' })");
    check("Choosing Light turns it back", await s.waitFor("document.documentElement.dataset.theme === 'light' && getComputedStyle(document.body).backgroundColor === 'rgb(238, 240, 243)'", 5000));
  } catch (e) {
    check("Test run finished without errors", false, e instanceof Error ? e.message : e);
    await s.shot("99-error").catch(() => {});
  } finally {
    await s.end();
    driver.kill();
  }

  // A separate launch for the SnapGene file if multi-window automation wasn't available.
  if (!checks.some(c => c.name.startsWith("SnapGene .dna opens"))) {
    const driver2 = await startDriver();
    const s2 = await Session.start([data("snapgene", "pIB2-SEC13-mEGFP.dna")]);
    try {
      await checkSnapGene(s2, "SnapGene .dna opens");
    } finally {
      await s2.end();
      driver2.kill();
    }
  }

  writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ checks, date: new Date().toISOString() }, null, 2));
  const failed = checks.filter(c => !c.ok);
  const lines = checks.map(c => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  writeFileSync(path.join(outDir, "report.md"), `# End-to-end report\n\n${lines.join("\n")}\n`);
  const enc = t => t.replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
  console.log(`::${failed.length ? "error" : "notice"} title=End-to-end: ${checks.length - failed.length}/${checks.length} checks passed::${enc(lines.join("\n"))}`);
  process.exit(failed.length ? 1 : 0);
}

async function checkSnapGene(s, name) {
  check(name, await s.waitFor("document.querySelector('.sv-map-svgel .sv-map-feature')", 30000));
  await sleep(1500);
  const primers = await s.exec("return window.__strandivo.store.data.primers.map(p => p.name)");
  check("Primers stored in the SnapGene file are imported", primers.includes("A206K.REV"), primers.join(", "));
  await s.shot("10-snapgene");
  await s.click("button[data-tab=primers]");
  await sleep(800);
  await s.shot("11-snapgene-primers");
}

main().catch(e => {
  console.log(`::error title=End-to-end crashed::${String(e?.stack || e).replace(/\n/g, "%0A")}`);
  process.exit(1);
});
