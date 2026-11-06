// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The website's generator. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, changesBody, fill, inline, markdown } from "./build-site.mjs";
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

test("every page has the bar and the footer, and no script", () => {
  const pages = build(root);
  assert.deepEqual(Object.keys(pages).sort(), ["404.html", "changes/index.html", "download/index.html", "index.html", "privacy/index.html"]);
  for (const [path, html] of Object.entries(pages)) {
    assert.match(html, /<nav class="bar-links"/, path);
    assert.match(html, /<!--email_off-->[\s\S]*<!--\/email_off-->/, path);
    // The Content Security Policy (site/_headers) would block one anyway.
    assert.doesNotMatch(html, /<script|\son[a-z]+=|javascript:/i, path);
    assert.doesNotMatch(html, /\{\{/, path);
  }
  // Each released version has its section, so the app's link lands on it.
  assert.match(pages["changes/index.html"], /id="v0\.2\.0"/);
  assert.match(pages["privacy/index.html"], /<h2 id="checking-for-updates">/);
});
