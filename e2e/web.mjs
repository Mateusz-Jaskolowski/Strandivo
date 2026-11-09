// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// End-to-end check of the browser version in Chrome: that alignment and detection work
// through the core compiled to WebAssembly, in its worker, with no test hooks standing in;
// opening, saving and dropping files, with and without the browser's file pickers; and
// Home's folders, remembered reads and read checks, which last between visits only where
// the browser gives handles.
//
// Serves dist-web (`npm run build:web`) and testdata/ (under /testdata/) with Node's
// http, with the headers Cloudflare Pages sends (dist-web/_headers, from public-web/), and
// drives headless Chrome through ChromeDriver over plain WebDriver, as e2e/run.mjs drives
// the desktop app. Anything the Content Security Policy blocks fails the run, so a change
// that would break in the deployed page breaks here first. Screenshots and a report go to
// the output folder.
//
//   node e2e/web.mjs [output folder]     (default e2e-out/web)
//   node e2e/web.mjs --serve [port]      (only serves it, to try by hand; default 4173)
//
// ChromeDriver is found through CHROMEWEBDRIVER, which GitHub's runners set, or on the PATH.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

/**
 * `_headers` as Cloudflare Pages reads it: a path (`*` for anything) on a line of its own,
 * then its headers, indented. Read when the server starts, so it is the build's own.
 */
function readHeaders() {
  const file = path.join(dist, "_headers");
  const rules = [];
  if (!existsSync(file)) return rules;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      rules.push({ path: new RegExp(`^${pattern}$`), headers: {} });
    } else if (rules.length) {
      const i = line.indexOf(":");
      rules.at(-1).headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

/** What the page's Content Security Policy blocked, as Chrome reported it to the server. */
const violations = [];
const REPORTS = "/__csp-report";

/** The web build at /, test files at /testdata/; anything else is a 404. */
function serve(port) {
  const rules = readHeaders();
  const headersFor = pathname => {
    const out = {};
    for (const r of rules) if (r.path.test(pathname)) Object.assign(out, r.headers);
    // Chrome posts what the policy blocks here; the policy itself is the deployed one.
    if (out["content-security-policy"]) out["content-security-policy"] += `; report-uri ${REPORTS}`;
    return out;
  };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    if (req.method === "POST" && pathname === REPORTS) {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => {
        try {
          const r = JSON.parse(body)["csp-report"];
          violations.push(`${r["effective-directive"] ?? r["violated-directive"]} blocked ${r["blocked-uri"] || "inline code"}${r["source-file"] ? ` in ${r["source-file"]}` : ""}`);
        } catch {
          violations.push(body.slice(0, 200));
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }
    const [base, rel] = pathname.startsWith("/testdata/") ? [testdata, pathname.slice(10)] : [dist, pathname === "/" ? "index.html" : pathname.slice(1)];
    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { ...headersFor(pathname), "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
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
    const policy = (await fetch(`${base}/`)).headers.get("content-security-policy") ?? "";
    check(
      "The page comes with the Content Security Policy it is deployed with",
      /script-src 'self' 'wasm-unsafe-eval';/.test(policy) && /connect-src 'self' https:\/\/rest\.uniprot\.org/.test(policy) && /frame-ancestors 'none'/.test(policy),
      policy.slice(0, 160)
    );
    // A first visit shows the welcome window over the file: nothing about updates, which a
    // browser doesn't install, and statistics on, with a way to turn them off.
    const welcomed = await s.waitFor("/Welcome to Strandivo/.test(document.querySelector('.sv-dialog-title')?.textContent)", 5000);
    const parts = welcomed ? await s.exec("return Array.from(document.querySelectorAll('.sv-welcome-part h3')).map(e => e.textContent)") : [];
    check("A first visit's welcome window asks nothing about updates", welcomed && !parts.includes("Updates") && parts.includes("Usage statistics"), parts.join(", "));
    const turnOff = "//*[contains(@class,'sv-welcome-part')]//button[normalize-space()='Turn off']";
    check("It says statistics are on in a browser, and offers to turn them off", welcomed && (await s.exec("return Array.from(document.querySelectorAll('.sv-welcome-part button')).some(b => b.textContent === 'Turn off')")));
    if (welcomed) {
      await s.click(turnOff);
      check("Turn off says nothing is sent", await s.waitFor("/Turned off: nothing is sent/.test(document.querySelector('.sv-welcome')?.textContent)", 2000));
      await s.shot("00-welcome");
      await s.click("//*[contains(@class,'sv-dialog-foot')]//button[normalize-space()='Start using Strandivo']");
      await s.waitFor("!document.querySelector('.sv-dialog')", 3000);
    }
    check("Closing the window keeps them off", await s.exec("return JSON.parse(localStorage.getItem('strandivo.settings') || '{}').shareUsage === false"));

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

    // --- what Home and Settings say in a browser ---
    await s.exec("window.__strandivo.showHome()");
    const homeLine = await s.exec("const p = document.querySelector('.sv-home-web'); return p ? { text: p.textContent, href: p.querySelector('a')?.href ?? '' } : null");
    check(
      "Home says the files never leave the computer, and links to how",
      /^Runs in your browser\. Your files never leave this computer\./.test(homeLine?.text ?? "") && /\/privacy#the-browser-version$/.test(homeLine?.href ?? ""),
      JSON.stringify(homeLine)
    );
    await s.exec("window.__strandivo.menu('settings')");
    await s.waitFor("document.querySelector('.sv-panel-settings .ps-settings')", 5000);
    const settings = await s.exec(
      "const p = document.querySelector('.sv-panel-settings'); const box = Array.from(p?.querySelectorAll('label') ?? []).find(l => /Share anonymous usage statistics/.test(l.textContent))?.querySelector('input'); return { updates: /Check for updates/.test(p?.textContent ?? ''), shared: box ? box.checked : null }"
    );
    check("Settings offers no update checks in a browser, and statistics stay as turned off", settings.updates === false && settings.shared === false, JSON.stringify(settings));
    await s.shot("04-settings");
    await s.exec("window.__strandivo.menu('settings')");
    await s.waitFor("!document.querySelector('.sv-panel')", 3000);

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
    await s.shot("05-menu");
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

    // --- Home's folders and remembered reads (Chrome and Edge) ---
    // A folder in the page's private file system stands in for one the user picks; a read
    // outside it for one picked on its own. Their handles are real, and kept in IndexedDB.
    const made = await s.execAsync(`
      (async () => {
        const root = await navigator.storage.getDirectory();
        const put = async (dir, name, url) => {
          const out = await (await dir.getFileHandle(name, { create: true })).createWritable();
          await out.write(await (await fetch(url)).arrayBuffer());
          await out.close();
          return dir.getFileHandle(name);
        };
        const lab = await root.getDirectoryHandle('Lab', { create: true });
        await put(lab, 'pUC19.gb', '/testdata/e2e/pUC19-annotated.gb');
        await put(lab, '.hidden.gb', '/testdata/e2e/pUC19-annotated.gb');
        await put(await lab.getDirectoryHandle('plasmids', { create: true }), 'pIB2-SEC13-mEGFP.dna', '/testdata/snapgene/pIB2-SEC13-mEGFP.dna');
        const sage = await put(await lab.getDirectoryHandle('reads', { create: true }), 'sage-sample.ab1', '/testdata/sanger/sage-sample.ab1');
        const plate = await put(root, 'plate-bla.fasta', '/testdata/e2e/plate-bla.fasta');
        window.showDirectoryPicker = async () => lab;
        window.showOpenFilePicker = async () => [sage, plate];
        window.showSaveFilePicker = async () => (await lab.getDirectoryHandle('reads')).getFileHandle('pUC19 reads.svcheck', { create: true });
      })().then(() => done(true), e => done(String(e)));`);
    await s.click("(//button[normalize-space()='Add folder…'])[1]");
    const listed = (await s.waitFor("window.__strandivo.libraryNames().includes('pIB2-SEC13-mEGFP.dna')", 20000)) ? await s.exec("return window.__strandivo.libraryNames()") : [];
    check("Add folder… lists the sequence files in a folder and its subfolders", made === true && listed.includes("pUC19.gb") && !listed.includes(".hidden.gb"), `${made}: ${listed.join(", ")}`);
    check("Home shows the folder by its name, never its key", await s.exec("return document.querySelector('.sv-home-folder-name')?.textContent === 'Lab' && !document.querySelector('.sv-home').innerHTML.includes('web:')"));
    await s.shot("06-folder");
    const openFromHome = async name => {
      await s.exec("window.__strandivo.showHome()");
      await s.click(`//button[contains(@class,'sv-home-open') and normalize-space()='${name}']`);
      return s.waitFor(`window.__strandivo.tabs().includes('${name}') && window.__strandivo.store`, 15000);
    };
    await openFromHome("pUC19.gb");
    await s.exec("window.__strandivo.command('add-reads')");
    check("Reads picked in the browser's picker are added", await s.waitFor(readsReady(7), 60000));
    await s.exec("window.__strandivo.closeTab()");
    await openFromHome("pUC19.gb");
    await s.exec("window.__strandivo.setView('reads')");
    check("They are remembered, and come back when the file opens again", await s.waitFor(readsReady(7), 60000));
    await s.click("//button[normalize-space()='Save check…']");
    const inLab = "return (async () => { let d = await navigator.storage.getDirectory(); const parts = arguments[0].split('/'); for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p); return (await (await d.getFileHandle(parts.at(-1))).getFile()).text(); })()";
    const savedCheck = (await s.waitFor("Array.from(document.querySelectorAll('.ps-toast')).some(t => /Saved pUC19 reads.svcheck/.test(t.textContent))", 5000))
      ? JSON.parse(await s.exec(inLab, "Lab/reads/pUC19 reads.svcheck"))
      : null;
    check(
      "Save check… in the folder writes paths relative to it, and a read from elsewhere by name",
      savedCheck?.reference === "../pUC19.gb" && savedCheck.reads.some(r => r.path === "sage-sample.ab1") && savedCheck.reads.some(r => r.path === "plate-bla.fasta"),
      JSON.stringify(savedCheck)
    );

    // A later visit: the folder and the reads, through the handles kept in IndexedDB.
    await s.go(`${base}/`);
    check("After a reload, Home lists the folder again", await s.waitFor("window.__strandivo?.libraryNames().includes('pUC19.gb')", 20000));
    await openFromHome("pUC19.gb");
    await s.exec("window.__strandivo.setView('reads')");
    check("The file's reads come back too", await s.waitFor(readsReady(7), 60000));
    const checkOpened = await s.execAsync(`
      (async () => {
        const root = await navigator.storage.getDirectory();
        const reads = await (await root.getDirectoryHandle('Lab')).getDirectoryHandle('reads');
        window.showOpenFilePicker = async () => [await reads.getFileHandle('pUC19 reads.svcheck')];
        window.__strandivo.menu('open');
      })().then(() => done(true), e => done(String(e)));`);
    const askedForRead = "Array.from(document.querySelectorAll('.sv-reads-offer button')).some(b => /^Add the read this check lists/.test(b.textContent))";
    check("A check in the folder opens with its reads there, and asks for one from elsewhere", checkOpened === true && (await s.waitFor(askedForRead, 20000)), String(checkOpened));
    await s.execAsync("navigator.storage.getDirectory().then(r => r.getFileHandle('plate-bla.fasta')).then(f => { window.showOpenFilePicker = async () => [f]; done(true); }, e => done(String(e)));");
    await s.click("//*[contains(@class,'sv-reads-offer')]//button[starts-with(normalize-space(),'Add the read')]");
    const offerGone = "!document.querySelector('.sv-reads-offer:not([hidden])')";
    check("The read chosen is matched by name and added with the others", await s.waitFor(`${offerGone} && ${readsReady(7)}`, 60000));
    await s.shot("07-check-in-folder");

    // --- a browser without them (Safari and Firefox): a file input, and downloads ---
    await s.exec(`
      window.showOpenFilePicker = undefined;
      window.showSaveFilePicker = undefined;
      window.showDirectoryPicker = undefined;
      window.__e2eDownloads = [];
      // Each download's own contents: the page's policy lets nothing fetch a blob: address.
      const made = new Map();
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); made.set(url, blob); return url; };
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__e2eDownloads.push({ name: this.download, blob: made.get(this.href) }); };
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
      ? await s.execAsync("const d = window.__e2eDownloads[0]; d.blob.text().then(t => done({ name: d.name, text: t.slice(0, 12) }), e => done(String(e)));")
      : null;
    check("Save, which can't write over it, downloads a GenBank copy", downloaded?.name === "pIB2-SEC13-mEGFP.gb" && downloaded.text.startsWith("LOCUS"), JSON.stringify(downloaded));
    const told = "return Array.from(document.querySelectorAll('.ps-toast')).filter(t => /each save is a new download/.test(t.textContent)).length";
    check("The first download says why", (await s.exec(told)) === 1);
    await s.exec("window.__strandivo.command('save')");
    await s.waitFor("window.__e2eDownloads.length === 2", 5000);
    check("The second doesn't say it again", (await s.exec(told)) === 1);
    await s.shot("08-downloaded");
    await s.exec("window.__strandivo.showHome()");
    check(
      "Without folders, Home lists the files opened during the visit, and says why",
      await s.waitFor("/can't keep folders/.test(document.querySelector('.sv-home-note-line')?.textContent) && window.__strandivo.libraryNames().includes('pIB2-SEC13-mEGFP.dna') && document.querySelector('.sv-home-side section').hidden", 10000)
    );

    // --- dropping files ---
    // A file of that name, from a URL or with the text passed in.
    const drop = (file, url) => `
      (async () => {
        const dt = new DataTransfer();
        dt.items.add(new File([${url ? `await (await fetch('${url}')).arrayBuffer()` : "arguments[0]"}], '${file}'));
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
    check("A trace dropped on a file is added to its reads", await s.waitFor(readsReady(1), 20000));
    check("Held only for the visit, the reads aren't remembered, and the Reads tab says so", await s.exec("return /can't remember reads/.test(document.querySelector('.sv-reads-forgets')?.textContent)"));
    const downloads = await s.exec("return window.__e2eDownloads.length");
    await s.click("//button[normalize-space()='Save check…']");
    const checkText = (await s.waitFor(`window.__e2eDownloads.length === ${downloads + 1}`, 5000))
      ? await s.execAsync("window.__e2eDownloads.at(-1).blob.text().then(done, e => done(String(e)));")
      : "";
    const downloadedCheck = (() => {
      try {
        return JSON.parse(checkText);
      } catch {
        return null;
      }
    })();
    check("Save check… downloads a check naming the files beside it", downloadedCheck?.reference === "dropped.gb" && downloadedCheck.reads[0]?.path === "sage-sample.ab1", checkText.slice(0, 200));
    await s.shot("09-dropped");
    // Opened again, its sequence is the open tab of that name, and its read is asked for.
    const sage = path.join(testdata, "sanger", "sage-sample.ab1");
    await s.execAsync(drop("dropped reads.svcheck"), checkText);
    check("A check opened there finds its sequence among the open files, and asks for its reads", await s.waitFor(askedForRead, 10000));
    await s.click("//*[contains(@class,'sv-reads-offer')]//button[starts-with(normalize-space(),'Add the read')]");
    if (await s.waitFor("document.querySelector('input.sv-file-input')", 5000)) await s.keys("input.sv-file-input", sage);
    check("The read chosen is matched by name", await s.waitFor(`${offerGone} && ${readsReady(1)}`, 20000));
    // A check whose sequence isn't open asks for its files first.
    await s.exec("window.__strandivo.showHome()");
    await s.execAsync(drop("pUC19 reads.svcheck"), JSON.stringify({ strandivo: "read check", version: 1, reference: "pUC19-annotated.gb", reads: [{ path: "sage-sample.ab1", clone: null }] }));
    check("A check whose sequence isn't open asks for its files", await s.waitFor("/Choose pUC19-annotated.gb and the read this check lists/.test(document.querySelector('.ps-modal')?.textContent)", 10000));
    await s.shot("10-check-files");
    await s.click("//*[contains(@class,'ps-modal-buttons')]//button[normalize-space()='Choose files…']");
    if (await s.waitFor("document.querySelector('input.sv-file-input')", 5000)) await s.keys("input.sv-file-input", `${path.join(testdata, "e2e", "pUC19-annotated.gb")}\n${sage}`);
    check("They open matched by name, with the check's read", await s.waitFor(`window.__strandivo.tabs().includes('pUC19-annotated.gb') && window.__strandivo.store && ${readsReady(1)}`, 30000));

    // Reports arrive a moment after what they report.
    await sleep(1000);
    check("Nothing the page did broke its Content Security Policy", violations.length === 0, violations.slice(0, 5).join("; "));
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
