#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Writes the website's pages into site/:
//
//   npm run site            write them
//   npm run site -- --check fail if any is out of date (the quick checks run this)
//
// The site stays plain files with no build step on Cloudflare, so what
// would change with each release is made here and committed: What's new from
// CHANGELOG.md, Privacy from docs/privacy.md, and every page's header and footer from one
// place. Home, Download and the 404 page are written in tools/site/. The Download page's
// links need no change per release (DOWNLOADS in .github/scripts/release.mjs).
//
// Runs with --experimental-strip-types, as it reads the changelog with the app's own code.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog } from "../src/lib/changelog.ts";
import { DOWNLOADS } from "../.github/scripts/release.mjs";

export const SITE = "https://strandivo.com";
export const REPO = "https://github.com/Mateusz-Jaskolowski/Strandivo";

export const escapeHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A link the site may carry: its own pages, https and mail. Anything else is a mistake. */
function safeUrl(url) {
  if (!/^(https:\/\/|mailto:|\/|#)/.test(url)) throw new Error(`The site doesn't link to "${url}": use https://, mailto: or a path from /.`);
  return url;
}

/** Plain text with **bold**, and addresses such as hello@strandivo.com made links. */
function rich(s, { mail = true } = {}) {
  const html = escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return mail ? html.replace(/\b[a-z0-9.-]+@strandivo\.com\b/g, m => `<a href="mailto:${m}">${m}</a>`) : html;
}

/** Inline Markdown: `code`, **bold** and [text](url). */
export function inline(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) => {
      if (i % 2) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      let out = "";
      let last = 0;
      for (const m of part.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
        out += rich(part.slice(last, m.index)) + `<a href="${escapeHtml(safeUrl(m[2]))}">${rich(m[1], { mail: false })}</a>`;
        last = m.index + m[0].length;
      }
      return out + rich(part.slice(last));
    })
    .join("");
}

export const slug = text => text.toLowerCase().replace(/[`*]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The Markdown the changelog and the privacy page are written in: headings (with an id),
 * paragraphs and `-` lists whose items may run on over indented lines. Anything else
 * fails, rather than reaching the site as something it doesn't mean.
 */
export function markdown(text, { shift = 0 } = {}) {
  const html = [];
  let para = [];
  let list = null;
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(" "))}</p>`);
    if (list) html.push(`<ul>\n${list.map(i => `  <li>${inline(i)}</li>`).join("\n")}\n</ul>`);
    para = [];
    list = null;
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*(```|>|\d+[.)] |\|)/.test(line)) throw new Error(`tools/build-site.mjs can't show this yet: "${line.trim()}"`);
    const h = /^(#{1,6}) +(.+)$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(6, h[1].length + shift);
      html.push(`<h${level} id="${slug(h[2])}">${inline(h[2].trim())}</h${level}>`);
      continue;
    }
    const item = /^[-*] +(.*)$/.exec(line);
    if (item) {
      if (para.length) flush();
      (list ??= []).push(item[1].trim());
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return html.join("\n");
}

const NAV = [
  ["/download/", "Download"],
  ["/changes/", "What's new"],
  ["/privacy/", "Privacy"]
];

/** A whole page: the head, the bar with the site's links, the body and the footer. */
export function page({ path, title, description, body, source, noindex = false, script = false }) {
  const url = `${SITE}/${path}`;
  const nav = NAV.map(([href, label]) => `      <a class="bar-link"${href === `/${path}` ? ' aria-current="page"' : ""} href="${href}">${label}</a>`).join("\n");
  const meta = noindex
    ? `  <meta name="robots" content="noindex">`
    : [
        `  <meta name="description" content="${escapeHtml(description)}">`,
        `  <!-- strandivo.pages.dev serves the same page; this names the real address. -->`,
        `  <link rel="canonical" href="${url}">`,
        `  <meta property="og:type" content="website">`,
        `  <meta property="og:site_name" content="Strandivo">`,
        `  <meta property="og:title" content="${escapeHtml(title)}">`,
        `  <meta property="og:description" content="${escapeHtml(description)}">`,
        `  <meta property="og:image" content="${SITE}/map.png">`,
        `  <meta property="og:image:width" content="1360">`,
        `  <meta property="og:image:height" content="855">`,
        `  <meta property="og:image:alt" content="Strandivo showing a circular map of pUC19.">`,
        `  <meta property="og:url" content="${url}">`,
        `  <meta name="twitter:card" content="summary_large_image">`
      ].join("\n");
  return `<!doctype html>
<!-- Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
     SPDX-License-Identifier: GPL-3.0-or-later
     Written by tools/build-site.mjs from ${source}: edit that, then run npm run site. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
${meta}
  <meta name="theme-color" content="#eef0f3">
  <!-- Every link starts from the root: the 404 page is served at any address, and the
       others sit in folders. -->
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="apple-touch-icon" href="/icon.png">
  <link rel="stylesheet" href="/styles.css">${script ? `
  <!-- Puts the visitor's own system's download first; see the file. -->
  <script type="module" src="/download.js"></script>` : ""}
</head>
<body>
  <!-- Cloudflare's email obfuscation would turn the addresses below into a script that
       the Content Security Policy blocks, leaving "[email protected]": email_off keeps
       them as written. -->
  <!--email_off-->
  <header class="bar">
    <a class="brand" href="/">
      <img src="/icon.png" alt="" width="32" height="32">
      <span>Strandivo</span>
    </a>
    <nav class="bar-links" aria-label="Site">
${nav}
      <a class="bar-link" href="${REPO}">GitHub</a>
    </nav>
  </header>

${body.trim()}

  <footer class="foot">
    <p>Strandivo is free software under the GPL-3.0. This site has no cookies and no
    tracking; see <a href="/privacy/">Privacy</a> for what the app sends.</p>
    <p><a href="mailto:hello@strandivo.com">hello@strandivo.com</a> · Security issues:
    <a href="mailto:security@strandivo.com">security@strandivo.com</a></p>
  </footer>
  <!--/email_off-->
</body>
</html>
`;
}

/** What's new: every version in CHANGELOG.md, each with the id the app opens (#v0.2.1). */
export function changesBody(changelog) {
  const sections = parseChangelog(changelog).map(n => {
    const details = n.details ? `\n${markdown(n.details, { shift: 1 })}` : "";
    return `    <section class="release" id="v${escapeHtml(n.version)}">
      <h2><a href="#v${escapeHtml(n.version)}">${escapeHtml(n.version)}</a></h2>
      <p class="summary">${inline(n.summary)}</p>${details.replace(/\n/g, "\n      ")}
      <p class="release-link"><a href="${REPO}/releases/tag/v${escapeHtml(n.version)}">Release ${escapeHtml(n.version)} on GitHub</a></p>
    </section>`;
  });
  return `  <main class="prose">
    <h1>What's new in Strandivo</h1>
    <p class="lede">Every version, newest first. Strandivo shows the short notes of each when
    it offers the update; this page has the rest.</p>
${sections.join("\n")}
  </main>`;
}

/** Privacy: docs/privacy.md, whose first heading is the page's own. */
export function privacyBody(text) {
  return `  <main class="prose">
${markdown(text)
  .split("\n")
  .map(l => `    ${l}`)
  .join("\n")}
  </main>`;
}

const download = file => `${REPO}/releases/latest/download/${file}`;
const fileFor = (os, part) => DOWNLOADS.find(d => d.os === os && d.file.includes(part)).file;

/**
 * The download for the visitor's own system, one block per system, all hidden:
 * site/download.js shows the one that matches, so without it the page is unchanged.
 */
export function suggestedBlock() {
  return `      <div class="suggested" id="suggested" hidden>
        <div data-os="mac" hidden>
          <a class="button primary big" href="${download(fileFor("mac", "aarch64"))}">Download for Mac</a>
          <p class="note">For Macs with Apple silicon (M1 or later), which is nearly every Mac
          since 2020. Choose Apple menu → About This Mac: a “Processor” line instead of
          “Chip” means Intel. <a href="${download(fileFor("mac", "x64"))}">Download for a Mac with Intel</a></p>
        </div>
        <div data-os="windows" hidden>
          <a class="button primary big" href="${download(fileFor("windows", "setup"))}">Download for Windows</a>
          <p class="note">For 64-bit Windows 10 and 11. It installs for you alone, without an
          administrator.</p>
        </div>
        <div data-os="linux" hidden>
          <div class="actions">
            <a class="button primary big" href="${download(fileFor("linux", ".deb"))}">Download the .deb</a>
            <a class="button primary big" href="${download(fileFor("linux", "AppImage"))}">Download the AppImage</a>
          </div>
          <p class="note">The .deb is for Debian, Ubuntu and their relatives; the AppImage runs
          on other systems.</p>
        </div>
      </div>`;
}

/**
 * Home, Download and the 404 page: tools/site/<name>.html, with {{downloads}} (every
 * installer) and {{suggested}} (the visitor's own, see suggestedBlock) filled in.
 */
export function fill(template) {
  // The note at the top of each is for whoever edits it, not for the page.
  return template.replace(/^\s*<!--[\s\S]*?-->\s*\n/, "").replace(/\{\{suggested\}\}/g, suggestedBlock).replace(/\{\{downloads\}\}/g, () => {
    const groups = { mac: "Mac", windows: "Windows", linux: "Linux" };
    return Object.entries(groups)
      .map(([os, name]) => {
        const links = DOWNLOADS.filter(d => d.os === os)
          .map(d => `          <a class="button${os === "mac" && d.file.includes("aarch64") ? " primary" : ""}" href="${download(d.file)}">${escapeHtml(d.label)}</a>`)
          .join("\n");
        return `      <div class="download" id="${os}">
        <h2>${name}</h2>
        <div class="actions">
${links}
        </div>
      </div>`;
      })
      .join("\n");
  });
}

/** Every page the site has, as path → contents. */
export function build(root) {
  const read = p => readFileSync(join(root, p), "utf8");
  const pages = {
    "index.html": page({
      path: "",
      title: "Strandivo: plan, build and check your plasmids",
      description: "A free, open-source plasmid editor for Mac, Windows and Linux: maps and sequence editing, primers and cloning, and sequence verification with Sanger and whole-plasmid reads.",
      body: fill(read("tools/site/home.html")),
      source: "tools/site/home.html",
      script: true
    }),
    "download/index.html": page({
      path: "download/",
      title: "Download Strandivo",
      description: "Download Strandivo, the free plasmid editor, for Mac (Apple silicon and Intel), Windows and Linux.",
      body: fill(read("tools/site/download.html")),
      source: "tools/site/download.html",
      script: true
    }),
    "changes/index.html": page({
      path: "changes/",
      title: "What's new in Strandivo",
      description: "What changed in each version of Strandivo, the free plasmid editor.",
      body: changesBody(read("CHANGELOG.md")),
      source: "CHANGELOG.md"
    }),
    "privacy/index.html": page({
      path: "privacy/",
      title: "Privacy · Strandivo",
      description: "What the Strandivo app sends, and when: everything, listed in one place. Your files never leave your computer.",
      body: privacyBody(read("docs/privacy.md")),
      source: "docs/privacy.md"
    }),
    "404.html": page({
      path: "404.html",
      title: "Page not found · Strandivo",
      body: fill(read("tools/site/404.html")),
      source: "tools/site/404.html",
      noindex: true
    })
  };
  return pages;
}

function main(args) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const check = args.includes("--check");
  const stale = [];
  for (const [path, html] of Object.entries(build(root))) {
    const file = join(root, "site", path);
    let now = null;
    try {
      now = readFileSync(file, "utf8");
    } catch {}
    if (now === html) continue;
    if (check) stale.push(`site/${path}`);
    else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, html);
      console.log(`site/${path}`);
    }
  }
  if (stale.length) {
    console.error(`Out of date: ${stale.join(", ")}.\nRun npm run site and commit the result.`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
