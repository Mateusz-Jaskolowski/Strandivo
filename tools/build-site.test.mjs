// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The website's generator. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, changesBody, fill, inline, markdown } from "./build-site.mjs";
import { detectOs } from "../site/download.js";
import { DOWNLOADS } from "../.github/scripts/release.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("text from Markdown reaches the page only as text", () => {
  assert.equal(inline("a <b> & \"c\""), "a &lt;b&gt; &amp; &quot;c&quot;");
  assert.equal(inline("`<x>` and **bold**"), "<code>&lt;x&gt;</code> and <strong>bold</strong>");
  assert.equal(inline("[UniProt](https://www.uniprot.org/)"), '<a href="https://www.uniprot.org/">UniProt</a>');
  assert.equal(inline("Write to hello@strandivo.com."), 'Write to <a href="mailto:hello@strandivo.com">hello@strandivo.com</a>.');
  // Only addresses the site means to link to.
  assert.throws(() => inline("[x](javascript:alert(1))"), /doesn't link to/);
  assert.throws(() => inline("[x](http://example.com)"), /doesn't link to/);
});

test("headings, paragraphs and lists, with items that run on", () => {
  const html = markdown("# Title\n\nOne\nline.\n\n- First\n  continued.\n- Second\n\n## A part");
  assert.equal(html, '<h1 id="title">Title</h1>\n<p>One line.</p>\n<ul>\n  <li>First continued.</li>\n  <li>Second</li>\n</ul>\n<h2 id="a-part">A part</h2>');
  assert.match(markdown("## Sub", { shift: 1 }), /^<h3 id="sub">/);
  // What it can't show fails instead of reaching the site garbled.
  assert.throws(() => markdown("```\ncode\n```"), /can't show this yet/);
  assert.throws(() => markdown("1. one"), /can't show this yet/);
});

test("What's new has a section per version, with the id the app opens", () => {
  const html = changesBody("# What's new\n\nIntro for maintainers.\n\n## 0.3.0\n\nFaster.\n\n- More.\n\n## 0.2.0\n\nFirst.\n");
  assert.match(html, /<section class="release" id="v0\.3\.0">/);
  assert.match(html, /<section class="release" id="v0\.2\.0">/);
  assert.ok(html.indexOf("v0.3.0") < html.indexOf("v0.2.0"));
  assert.doesNotMatch(html, /Intro for maintainers/);
  assert.match(html, /<li>More\.<\/li>/);
});

test("the Download page links to every installer of the newest release", () => {
  const html = fill("{{downloads}}");
  for (const d of DOWNLOADS) assert.ok(html.includes(`/releases/latest/download/${d.file}"`), d.file);
});

test("the download script knows the systems Strandivo runs on, and nothing else", () => {
  const nav = (userAgent, extra = {}) => ({ userAgent, platform: "", maxTouchPoints: 0, ...extra });
  assert.equal(detectOs(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", { platform: "MacIntel" })), "mac");
  assert.equal(detectOs(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0", { userAgentData: { platform: "Windows" } })), "windows");
  assert.equal(detectOs(nav("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", { platform: "Linux x86_64" })), "linux");
  assert.equal(detectOs(nav("Mozilla/5.0 (X11; Ubuntu; Linux x86_64) Chrome/130.0", { userAgentData: { platform: "Linux" } })), "linux");
  // An iPad asking for the desktop page calls itself a Mac, but has touch.
  assert.equal(detectOs(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15", { platform: "MacIntel", maxTouchPoints: 5 })), null);
  assert.equal(detectOs(nav("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130.0 Mobile", { platform: "Linux armv81" })), null);
  assert.equal(detectOs(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148", { platform: "iPhone" })), null);
  assert.equal(detectOs(nav("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/130.0", { platform: "Linux x86_64" })), null);
  assert.equal(detectOs(nav("")), null);
});

test("each system's download is in the page, hidden until the script shows it", () => {
  const html = build(root)["download/index.html"];
  assert.match(html, /<div class="suggested" id="suggested" hidden>/);
  for (const os of ["mac", "windows", "linux"]) assert.match(html, new RegExp(`<div data-os="${os}" hidden>`), os);
  assert.match(html, /<h2 id="all-downloads-title" hidden>Other systems<\/h2>/);
  assert.match(build(root)["index.html"], /data-download-button>Download<\/a>/);
});

test("every page has the bar and the footer, and no script but the site's own file", () => {
  const pages = build(root);
  assert.deepEqual(Object.keys(pages).sort(), ["404.html", "changes/index.html", "download/index.html", "index.html", "privacy/index.html"]);
  for (const [path, html] of Object.entries(pages)) {
    assert.match(html, /<nav class="bar-links"/, path);
    assert.match(html, /<!--email_off-->[\s\S]*<!--\/email_off-->/, path);
    // The Content Security Policy (site/_headers) would block anything else anyway.
    // Every opening tag, in any case, must be the one allowed, closed at once (no inline code).
    const opening = html.match(/<script\b[^>]*>/gi) ?? [];
    const allowed = html.match(/<script type="module" src="\/download\.js"><\/script>/g) ?? [];
    assert.equal(opening.length, allowed.length, path);
    assert.equal(allowed.length, path === "index.html" || path.startsWith("download/") ? 1 : 0, path);
    assert.doesNotMatch(html, /\son[a-z]+=|javascript:/i, path);
    assert.doesNotMatch(html, /\{\{/, path);
  }
  // Each released version has its section, so the app's link lands on it.
  assert.match(pages["changes/index.html"], /id="v0\.2\.0"/);
  assert.match(pages["privacy/index.html"], /<h2 id="checking-for-updates">/);
});
