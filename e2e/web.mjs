// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// End-to-end check of the browser version in Chrome: that alignment and detection work
// through the core compiled to WebAssembly, in its worker, with no test hooks standing in.
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
