// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// End-to-end check of the browser version in Chrome: that alignment and detection work
// through the core compiled to WebAssembly, in its worker, with no test hooks standing in;
// and opening, saving and dropping files, with and without the browser's file pickers.
//
// Serves dist-web (`npm run build:web`) and testdata/ (under /testdata/) with Node's
// http, and drives headless Chrome through ChromeDriver over plain WebDriver, as
// e2e/run.mjs drives the desktop app. Screenshots and a report go to the output folder.
//
//   node e2e/web.mjs [output folder]     (default e2e-out/web)
//   node e2e/web.mjs --serve [port]      (only serves it, to try by hand; default 4173)
//
// ChromeDriver is found through CHROMEWEBDRIVER, which GitHub's runners set, or on the PATH.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dist = path.join(root, "dist-web");
const testdata = path.join(root, "testdata");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json"
};

/** The web build at /, test files at /testdata/; anything else is a 404. */
function serve(port) {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const [base, rel] = pathname.startsWith("/testdata/") ? [testdata, pathname.slice(10)] : [dist, pathname === "/" ? "index.html" : pathname.slice(1)];
    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// ---------- WebDriver ----------

const DRIVER = "http://127.0.0.1:9515";

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
  const bin = process.env.CHROMEWEBDRIVER ? path.join(process.env.CHROMEWEBDRIVER, "chromedriver") : "chromedriver";
  const driver = spawn(bin, ["--port=9515"], { stdio: ["ignore", "inherit", "inherit"] });
  driver.on("error", e => console.error(`ChromeDriver didn't start: ${e.message}`));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await (await fetch(DRIVER + "/status")).json()).value?.ready) return driver;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error("ChromeDriver did not start");
}

class Session {
  constructor(id, outDir) {
    this.id = id;
    this.outDir = outDir;
  }
  static async start(outDir) {
    const v = await wd("POST", "/session", {
      capabilities: {
        alwaysMatch: {
          browserName: "chrome",
          "goog:chromeOptions": { args: ["--headless=new", "--window-size=1400,900", "--no-sandbox", "--disable-dev-shm-usage"] }
        }
      }
    });
    return new Session(v.sessionId, outDir);
  }
  go(url) {
    return wd("POST", `/session/${this.id}/url`, { url });
  }
  exec(script, ...args) {
    return wd("POST", `/session/${this.id}/execute/sync`, { script, args });
  }
  /** Runs `script`, which ends by calling `done(value)`, and returns the value. */
  execAsync(script, ...args) {
    return wd("POST", `/session/${this.id}/execute/async`, { script: `const done = arguments[arguments.length - 1]; ${script}`, args });
  }
  async waitFor(expr, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        if (await this.exec(`return !!(${expr});`)) return true;
      } catch {
        /* page still loading */
      }
      await sleep(250);
    }
    return false;
  }
  async click(xpath) {
    const v = await wd("POST", `/session/${this.id}/element`, { using: "xpath", value: xpath });
    await wd("POST", `/session/${this.id}/element/${Object.values(v)[0]}/click`, {});
  }
  /** Types into an element; for a file input, the text is a file's path. */
  async keys(css, text) {
    const v = await wd("POST", `/session/${this.id}/element`, { using: "css selector", value: css });
    await wd("POST", `/session/${this.id}/element/${Object.values(v)[0]}/value`, { text });
  }
  /** Real key presses, with `mods` (WebDriver key codes) held down. */
  async press(text, mods = []) {
    const down = mods.map(value => ({ type: "keyDown", value }));
    const up = [...mods].reverse().map(value => ({ type: "keyUp", value }));
    const keys = Array.from(text).flatMap(value => [{ type: "keyDown", value }, { type: "keyUp", value }]);
    await wd("POST", `/session/${this.id}/actions`, { actions: [{ type: "key", id: "keyboard", actions: [...down, ...keys, ...up] }] });
    await wd("DELETE", `/session/${this.id}/actions`).catch(() => {});
  }
  async shot(name) {
    const b64 = await wd("GET", `/session/${this.id}/screenshot`);
    writeFileSync(path.join(this.outDir, `${name}.png`), Buffer.from(b64, "base64"));
  }
  end() {
    return wd("DELETE", `/session/${this.id}`).catch(() => {});
  }
}

// ---------- the checks ----------

async function main(outDir) {
  mkdirSync(outDir, { recursive: true });
  const checks = [];
  const check = (name, ok, detail = "") => {
    checks.push({ name, ok: !!ok, detail: String(detail) });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const server = await serve(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const driver = await startDriver();
  let s = null;
  try {
    s = await Session.start(outDir);
    await s.go(`${base}/?open=/testdata/e2e/pUC19-annotated.gb`);
    check("The web build opens a file in a tab with its map", await s.waitFor("document.querySelector('.sv-map-svgel .sv-map-feature')", 30000));
    check(
      "Nothing stands in for the core: no shell and no test hooks",
      await s.exec("return !('__TAURI_INTERNALS__' in window) && !window.__strandivoAlign && !window.__strandivoDetect")
    );
    // A first visit shows the welcome window over the file.
    if (await s.waitFor("/Welcome to Strandivo/.test(document.querySelector('.sv-dialog-title')?.textContent)", 5000)) {
      await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Start using Strandivo']");
      await s.waitFor("!document.querySelector('.sv-dialog')", 3000);
    }

    // --- detection, in the worker ---
    await s.exec("window.__strandivo.command('detect-features')");
    check("Detect features finds parts in the sequence", await s.waitFor("document.querySelectorAll('.sv-dialog .sv-detect-row').length > 0", 30000));
    const offered = await s.exec("return Array.from(document.querySelectorAll('.sv-dialog .sv-detect-row .sv-detect-name')).map(e => e.textContent)");
    check("pUC19's origin is among them, and AmpR, already in the file, isn't", offered.includes("ori") && !offered.includes("AmpR"), offered.join(", "));
    await s.shot("01-detect");
    await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Cancel']");
    await s.waitFor("!document.querySelector('.sv-dialog')", 3000);

    // --- a plate of clones, aligned in the worker ---
    const readsReady = n => `document.querySelectorAll('.sv-read-card').length === ${n} && !document.querySelector('.sv-reads.sv-busy')`;
    const added = await s.execAsync("window.__strandivo.addReadPaths(arguments[0]).then(() => done(true), e => done(String(e)));", ["/testdata/e2e/plate-bla.fasta"]);
    await s.exec("window.__strandivo.setView('reads')");
    check("A plate of reads aligns", added === true && (await s.waitFor(readsReady(6), 60000)), String(added));
    await s.click("//*[contains(@class,'sv-reads-cov')]//button[starts-with(normalize-space(.),'Clones')]");
    const rowsOf = "return Array.from(document.querySelectorAll('.sv-clonetab tbody tr')).map(r => [r.title.split(', '), ...Array.from(r.cells).map(c => c.textContent)])";
    const rows = (await s.waitFor("document.querySelectorAll('.sv-clonetab tbody tr').length > 0", 5000)) ? await s.exec(rowsOf) : [];
    const row = (list, name) => list.find(r => r[0].includes(name)) || [];
    const a01 = row(rows, "A01_bla");
    // The same clones and differences as the desktop's e2e finds with the native core.
    check("Identical clones share a row, with their change", a01[0]?.includes("A02_bla") && /AmpR W163R/.test(a01[4]), JSON.stringify(a01));
    check(
      "The clone table flags a stop and a frameshift",
      /Stop/.test(row(rows, "A03_bla")[3]) && /W163\*/.test(row(rows, "A03_bla")[4]) && /Frameshift/.test(row(rows, "A05_bla")[3]) && /fs/.test(row(rows, "A05_bla")[4]),
      JSON.stringify([row(rows, "A03_bla"), row(rows, "A05_bla")])
    );
    await s.shot("02-clone-table");

    // --- a panic in the core: reported, and the next request still answered ---
    const trapped = await s.execAsync("window.__strandivo.trapCore().then(() => done('no error'), e => done(e.message));");
    check("A panic in the core fails its request with the panic's message", /stopped unexpectedly.*capacity overflow/s.test(trapped), trapped);
    // Reading TAG as Q aligns the plate again.
    const a06Shows = text => `${readsReady(6)} && Array.from(document.querySelectorAll('.sv-clonetab tbody tr')).some(r => r.title.split(', ').includes('A06_bla') && /${text}/.test(r.cells[3].textContent))`;
    await s.exec("window.__strandivo.saveSettings({ amberAsQ: true })");
    const amber = (await s.waitFor(a06Shows("W163Q"), 30000)) ? row(await s.exec(rowsOf), "A06_bla") : [];
    check("After it, the core aligns the plate again (A06's amber stop as W163Q)", /W163Q/.test(amber[4] ?? ""), JSON.stringify(amber));
    check("No alignment failed along the way", !(await s.exec("return Array.from(document.querySelectorAll('.ps-toast')).some(t => /failed/i.test(t.textContent))")));
    await s.shot("03-after-panic");

    // --- the menu, in place of a menu bar ---
    await s.exec("window.__strandivo.showHome()");
    await s.click("//button[@aria-label='Menu']");
    const groups = await s.exec("return Array.from(document.querySelectorAll('.ps-context-menu > button')).map(b => b.textContent)");
    check("The app bar's menu has the menu bar's groups", groups.join() === "File,Edit,View,Tools,Window,Help", groups.join());
    await s.click("//*[contains(@class,'ps-context-menu')]/button[normalize-space()='File']");
    const fileItems = await s.exec("return Array.from(document.querySelectorAll('.ps-context-sub button')).map(b => ({ label: b.firstChild.textContent, key: b.querySelector('.ps-context-key')?.textContent ?? '', on: !b.disabled }))");
    const item = label => fileItems.find(i => i.label === label) ?? {};
    check(
      "It shows the keys that work in a browser, and greys out what needs a file",
      item("New Sequence").key === "Ctrl+Alt+N" && item("Open…").key === "Ctrl+O" && item("Close Tab").key === "" && item("Open…").on && !item("Save").on,
      JSON.stringify(fileItems)
    );
    await s.shot("04-menu");
    await s.press("\uE00C"); // Escape
    const CTRL = "\uE009";
    const ALT = "\uE00A";
    await s.exec("document.activeElement?.blur()");
    await s.press("n", [CTRL, ALT]);
    check("Ctrl+Alt+N makes a new sequence, as the browser keeps Ctrl+N", await s.waitFor("window.__strandivo.tabs().includes('Untitled')", 5000));
    await s.exec("window.__strandivo.closeTab()");

    // --- opening and saving a file the browser has a handle to (Chrome and Edge) ---
    // The file pickers are stood in for with files in the page's private file system, whose
    // handles are real ones: the app reads, writes and keeps them as it would a user's.
    const fileText = "return (async () => { const root = await navigator.storage.getDirectory(); return (await (await root.getFileHandle(arguments[0])).getFile()).text(); })()";
    const opened = await s.execAsync(`
      (async () => {
        const root = await navigator.storage.getDirectory();
        const text = await (await fetch('/testdata/e2e/pUC19-annotated.gb')).text();
        const file = await root.getFileHandle('pUC19-handle.gb', { create: true });
        const out = await file.createWritable();
        await out.write(text);
        await out.close();
        window.showOpenFilePicker = async () => [file];
        window.showSaveFilePicker = async () => root.getFileHandle('pUC19-copy.gb', { create: true });
        window.__strandivo.menu('open');
      })().then(() => done(true), e => done(String(e)));`);
    check("Open… opens the file the browser's picker gave", opened === true && (await s.waitFor("window.__strandivo.tabs().includes('pUC19-handle.gb') && window.__strandivo.store", 15000)), String(opened));
    const leaving = "const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented;";
    check("Leaving the page isn't asked about with nothing unsaved", !(await s.exec(leaving)));
    await s.exec("const s = window.__strandivo.store; s.apply({ ...s.data, name: 'pUC19 from the browser' }, 'Rename');");
    check("With unsaved changes, the browser asks before leaving", await s.exec(leaving));
    await s.exec("window.__strandivo.command('save')");
    await s.waitFor("!window.__strandivo.isDirty()", 5000);
    const inPlace = await s.exec(fileText, "pUC19-handle.gb");
    check("Save writes over the file it opened", /^LOCUS {7}pUC19_from_the_browser/.test(inPlace), inPlace.slice(0, 40));
    await s.exec("window.__strandivo.command('save-as')");
    const copied = (await s.waitFor("window.__strandivo.tabs().includes('pUC19-copy.gb')", 5000)) ? await s.exec(fileText, "pUC19-copy.gb") : "";
    check("Save As writes the file chosen in the browser's save dialog, and the tab follows it", /^LOCUS {7}pUC19_from_the_browser/.test(copied), copied.slice(0, 40));
    check(
      "Recent files keep files with a handle, shown by name",
      await s.exec("window.__strandivo.showHome(); return Array.from(document.querySelectorAll('.sv-home-recent-name')).map(e => e.textContent).includes('pUC19-copy.gb') && Array.from(document.querySelectorAll('.sv-home-recent-dir')).every(e => !e.textContent.includes('web:'));")
    );

    // --- a browser without them (Safari and Firefox): a file input, and downloads ---
    await s.exec(`
      window.showOpenFilePicker = undefined;
      window.showSaveFilePicker = undefined;
      window.__e2eDownloads = [];
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__e2eDownloads.push({ name: this.download, href: this.href }); };
      // Headless Chrome can't show a file dialog and cancels it at once, which the app takes
      // for Cancel: the dialog is stood in for by WebDriver handing the input a file.
      const click = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () { if (this.type !== 'file') click.call(this); };
      window.__strandivo.menu('open');`);
    const snapgene = path.join(testdata, "snapgene", "pIB2-SEC13-mEGFP.dna");
    const input = await s.waitFor("document.querySelector('input.sv-file-input')", 5000);
    check("Open… falls back to a file input", input);
    if (input) await s.keys("input.sv-file-input", snapgene);
    check("The file input opens a SnapGene file", await s.waitFor("window.__strandivo.tabs().includes('pIB2-SEC13-mEGFP.dna') && document.querySelector('.sv-map-svgel .sv-map-feature')", 20000));
    check("The SnapGene file's primers come with it", (await s.exec("return window.__strandivo.store?.data.primers.map(p => p.name) ?? []")).includes("A206K.REV"));
    await s.exec("window.__strandivo.command('save')");
    const downloaded = (await s.waitFor("window.__e2eDownloads.length === 1", 5000))
      ? await s.execAsync("const d = window.__e2eDownloads[0]; fetch(d.href).then(r => r.text()).then(t => done({ name: d.name, text: t.slice(0, 12) }), e => done(String(e)));")
      : null;
    check("Save, which can't write over it, downloads a GenBank copy", downloaded?.name === "pIB2-SEC13-mEGFP.gb" && downloaded.text.startsWith("LOCUS"), JSON.stringify(downloaded));
    const told = "return Array.from(document.querySelectorAll('.ps-toast')).filter(t => /each save is a new download/.test(t.textContent)).length";
    check("The first download says why", (await s.exec(told)) === 1);
    await s.exec("window.__strandivo.command('save')");
    await s.waitFor("window.__e2eDownloads.length === 2", 5000);
    check("The second doesn't say it again", (await s.exec(told)) === 1);
    await s.shot("05-downloaded");

    // --- dropping files ---
    const drop = (file, url) => `
      (async () => {
        const dt = new DataTransfer();
        dt.items.add(new File([await (await fetch('${url}')).arrayBuffer()], '${file}'));
        const fire = type => document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
        fire('dragenter');
        window.__e2eOverlay = document.querySelector('.ps-drop-overlay').classList.contains('ps-visible');
        fire('dragover');
        fire('drop');
      })().then(() => done(window.__e2eOverlay), e => done(String(e)));`;
    await s.exec("window.__strandivo.showHome()");
    const overlay = await s.execAsync(drop("dropped.gb", "/testdata/e2e/pUC19-annotated.gb"));
    check("A file dragged over the window shows where it will go", overlay === true, String(overlay));
    check("A file dropped on Home opens in a tab", await s.waitFor("window.__strandivo.tabs().includes('dropped.gb') && window.__strandivo.store", 15000));
    await s.execAsync(drop("sage-sample.ab1", "/testdata/sanger/sage-sample.ab1"));
    check("A trace dropped on a file is added to its reads", await s.waitFor("document.querySelectorAll('.sv-read-card').length === 1 && !document.querySelector('.sv-reads.sv-busy')", 20000));
    await s.execAsync(drop("x reads.svcheck", "/testdata/e2e/bla-check.fasta"));
    check(
      "A read check dropped in a browser says where it opens",
      await s.waitFor("Array.from(document.querySelectorAll('.ps-toast')).some(t => /Read checks open only in the desktop app/.test(t.textContent))", 3000)
    );
    await s.shot("06-dropped");
  } catch (e) {
    check("The browser check ran to the end", false, e?.stack || e);
    await s?.shot("99-crash").catch(() => {});
  } finally {
    await s?.end();
    driver.kill();
    server.close();
  }

  writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ checks, date: new Date().toISOString() }, null, 2));
  const failed = checks.filter(c => !c.ok);
  const lines = checks.map(c => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  writeFileSync(path.join(outDir, "report.md"), `# Browser version report\n\n${lines.join("\n")}\n`);
  const enc = t => t.replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
  console.log(`::${failed.length ? "error" : "notice"} title=Browser version: ${checks.length - failed.length}/${checks.length} checks passed::${enc(lines.join("\n"))}`);
  process.exit(failed.length ? 1 : 0);
}

// Last, so everything above is defined when it runs.
const args = process.argv.slice(2);
if (!existsSync(path.join(dist, "index.html"))) {
  console.error("No web build in dist-web: run `npm run build:web` first.");
  process.exit(2);
}
if (args[0] === "--serve") {
  const port = Number(args[1] ?? 4173);
  await serve(port);
  console.log(`Serving the web build at http://127.0.0.1:${port}/ (a file: ?open=/testdata/e2e/pUC19-annotated.gb)`);
} else {
  await main(args[0] ?? path.join("e2e-out", "web"));
}
