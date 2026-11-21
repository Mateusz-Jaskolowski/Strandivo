#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Builds the app's restriction enzymes from REBASE.
//
//   node tools/build-enzymes.mjs [--file <withrefm>] [--pages <folder>] [--out <file>]
//
// A maintainer runs this; the app never does. The result is committed, so builds and CI
// need no network. It keeps the enzymes REBASE lists as sold by at least one company,
// with their cuts as REBASE writes them, worked out here into cut positions the site
// search uses, and the companies' REBASE codes. With them, how Dam, Dcm and CpG
// methylation affect each (tools/rebase-methylation.mjs), from about 40 of REBASE's pages
// and a few more for enzymes those leave out; `--pages` keeps the pages in a folder and
// reads them from there when run again.
//
// REBASE's files are read over plain HTTP: its HTTPS certificate doesn't verify in Node
// (an incomplete chain). Check the regenerated file's diff before committing it. Terms
// and the reasons for what is left out are in docs/enzyme-data-plan.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readMethylation } from "./rebase-methylation.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(root, "src/lib/rebaseEnzymes.ts");
/** Always REBASE's current withrefm file, which has suppliers and cuts in one. */
const SOURCE = "http://rebase.neb.com/rebase/link_withrefm";

const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A", R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K", B: "V", V: "B", D: "H", H: "D", N: "N" };
/** Bits of information in each IUPAC code: how specific a site is. */
const BITS = { A: 2, C: 2, G: 2, T: 2, R: 1, Y: 1, S: 1, W: 1, K: 1, M: 1, B: 0.415, D: 0.415, H: 0.415, V: 0.415, N: 0 };
/**
 * Below a three-base site's information: MspJI's CNNR and SgeI's CNNG(9/13)-like sites.
 * Such enzymes cut only methylated DNA, and on a plasmid map their sites would fall every
 * few bases.
 */
const MIN_BITS = 6;

export const reverseComplement = site => [...site].reverse().map(c => COMPLEMENT[c]).join("");
export const bits = site => [...site].reduce((sum, c) => sum + BITS[c], 0);

/**
 * Where an enzyme cuts, from REBASE's notation: the site to search for and its cuts as
 * boundaries counted from the site's first base, the top strand's then the bottom
 * strand's, both on top-strand coordinates (G^AATTC is 1 and 5). `bothSides` is set for
 * an enzyme that also cuts before its site, as BcgI's (10/12)CGANNNNNNTGC(12/10), of
 * which the search keeps only the cut after it, where digests use both. Returns null for
 * a site with no cut marked.
 *
 * A ^ in a palindromic site marks both strands' cuts. REBASE writes a few enzymes that
 * cut outside a palindromic core as the core, Ns and a ^ (TspRI's CASTGNN^): their
 * bottom strand is cut as far before the core, so the site is searched with as many Ns
 * in front, which makes it a palindrome again (NNCASTGNN).
 */
export function parseCut(notation) {
  const m = /^(?:\((-?\d+)\/(-?\d+)\))?([ACGTRYSWKMBDHVN^]+)(?:\((-?\d+)\/(-?\d+)\))?$/.exec(notation);
  if (!m) throw new Error(`Can't read the site "${notation}".`);
  const [, upTop, , written, downTop, downBottom] = m;
  const caret = written.indexOf("^");
  if (caret !== written.lastIndexOf("^")) throw new Error(`"${notation}" marks more than one cut.`);
  const site = written.replace("^", "");
  const bothSides = upTop !== undefined;
  if (caret >= 0) {
    if (downTop !== undefined || bothSides) throw new Error(`"${notation}" marks its cut both ways.`);
    if (site === reverseComplement(site)) return { site, top: caret, bottom: site.length - caret, bothSides };
    const pad = /N*$/.exec(site)[0].length;
    const padded = "N".repeat(pad) + site;
    if (padded !== reverseComplement(padded)) throw new Error(`"${notation}" marks one strand's cut in a site that isn't a palindrome.`);
    return { site: padded, top: caret + pad, bottom: padded.length - caret - pad, bothSides };
  }
  if (downTop === undefined) {
    if (bothSides) throw new Error(`"${notation}" gives a cut before its site only.`);
    return null;
  }
  return { site, top: site.length + Number(downTop), bottom: site.length + Number(downBottom), bothSides };
}

/** REBASE's version, its date and its supplier codes, from the file's header. */
export function parseHeader(text) {
  const version = /REBASE version (\d+)/.exec(text)?.[1];
  if (!version) throw new Error("No REBASE version in the file's header.");
  const date = /\b([A-Z][a-z]{2} \d{1,2} \d{4})\b/.exec(text.slice(0, text.indexOf("<ENZYME NAME>")))?.[1] ?? "";
  const table = text.slice(text.indexOf("REBASE codes for commercial sources of enzymes"), text.indexOf("\n<1>"));
  const suppliers = {};
  for (const [, code, name] of table.matchAll(/^ +([A-Z]) +(.+?)(?: \(\d+\/\d+\))?$/gm)) suppliers[code] = name.trim();
  if (!Object.keys(suppliers).length) throw new Error("No supplier codes in the file's header.");
  return { version, date, suppliers };
}

/** The file's records, each as its numbered fields (1 name, 3 site, 7 suppliers). */
export function parseRecords(text) {
  return text.split("\n<1>").slice(1).map(block => {
    const fields = {};
    for (const line of `<1>${block}`.split("\n")) {
      const m = /^<(\d)>(.*)$/.exec(line);
      if (m) fields[m[1]] = m[2].trim();
    }
    return fields;
  });
}

/** The enzymes to keep, and the sold ones left out with the reason. */
export function selectEnzymes(text) {
  const { version, date, suppliers } = parseHeader(text);
  const kept = [];
  const left = [];
  const seen = new Set();
  for (const r of parseRecords(text)) {
    const name = r["1"];
    const sold = r["7"] ?? "";
    if (!sold) continue;
    for (const code of sold) if (!suppliers[code]) throw new Error(`${name} is sold by "${code}", which the header doesn't list.`);
    if (seen.has(name.toLowerCase())) throw new Error(`${name} is listed twice.`);
    seen.add(name.toLowerCase());
    const cut = parseCut(r["3"]);
    if (!cut) left.push(`${name} ${r["3"]}: its cut isn't known`);
    else if (bits(cut.site) < MIN_BITS) left.push(`${name} ${r["3"]}: too short a site`);
    else kept.push({ name, notation: r["3"], ...cut, suppliers: sold });
  }
  return { version, date, suppliers, kept, left };
}

/**
 * Enzymes that cut only methylated DNA, and the methylation they need. REBASE's page for
 * DpnI calls it a "Type II Methyl-directed restriction enzyme (recognizes the sequence only
 * when methylated)"; its damlist entry says only that it cuts Dam-methylated GATC.
 */
const METHYL_DIRECTED = { DpnI: "dam" };

const escape = s => s.replace(/[\\`$]/g, c => `\\${c}`);

export function render({ version, date, suppliers, kept, methylation = { lines: [], date: "" } }) {
  const names = new Set(kept.map(e => e.name));
  return `// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Generated by tools/build-enzymes.mjs from REBASE version ${version}${date ? ` (${date})` : ""}. Don't edit it
// by hand: run the tool again.
//
// REBASE, The Restriction Enzyme Database, http://rebase.neb.com, is an open database;
// what is taken from it stays open, as its terms ask. Cite: Roberts, R.J., Vincze, T.,
// Posfai, J., Macelis, D. (2023) REBASE: a database for DNA restriction and modification:
// enzymes, genes and genomes. Nucleic Acids Res. 51, D629–D630.

export const REBASE_VERSION = "${version}";

/** REBASE's codes for the companies that sell restriction enzymes. */
export const SUPPLIERS: Readonly<Record<string, string>> = {
${Object.entries(suppliers).map(([code, name]) => `  ${code}: ${JSON.stringify(name)}`).join(",\n")}
};

/**
 * Every restriction enzyme REBASE lists as sold, one per line: name, cut as REBASE writes
 * it, site searched for, top- and bottom-strand cuts from the site's first base, 1 if it
 * also cuts before its site (the search finds it by the cut after it, and digests use both
 * cuts), and suppliers' codes.
 */
export const REBASE_ENZYMES = \`
${kept.map(e => [e.name, e.notation, e.site, e.top, e.bottom, e.bothSides ? 1 : 0, e.suppliers].map(String).map(escape).join("\t")).join("\n")}
\`;

/**
 * How Dam (dam), Dcm (dcm) and CpG (cpg) methylation affect the enzymes above, from
 * REBASE's methylation sensitivity pages${methylation.date ? ` of ${methylation.date}` : ""}. One line per way a methylase's site
 * can overlap an enzyme's: name, methylase, the site with codes narrowed to the bases meant
 * in lower case (empty when none are), the methylated bases (t5: the top strand's sixth
 * base of the site searched for; b0: the bottom strand's base paired with the first) and
 * what the reports say (cut, impaired, blocked). Untested overlaps aren't listed.
 */
export const REBASE_METHYLATION = \`
${methylation.lines.map(l => [l.name, l.methylase, l.bases, l.marks, l.effects].map(escape).join("\t")).join("\n")}
\`;

/** Enzymes that cut only DNA with this methylation (REBASE's "methyl-directed" enzymes). */
export const METHYL_DIRECTED: Readonly<Record<string, string>> = {
${Object.entries(METHYL_DIRECTED).filter(([name]) => names.has(name)).map(([name, m]) => `  ${name}: ${JSON.stringify(m)}`).join(",\n")}
};
`;
}

async function main(args) {
  const flag = name => {
    const i = args.indexOf(name);
    return i < 0 ? null : args[i + 1];
  };
  const file = flag("--file");
  const out = flag("--out") ?? DEFAULT_OUT;
  let text;
  if (file) text = readFileSync(file, "latin1");
  else {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`REBASE answered ${res.status} for ${SOURCE}.`);
    text = Buffer.from(await res.arrayBuffer()).toString("latin1");
  }
  const result = selectEnzymes(text);
  const pages = flag("--pages");
  if (pages) mkdirSync(pages, { recursive: true });
  let date = "";
  const get = async url => {
    const saved = pages && join(pages, `${url.slice(url.lastIndexOf("/") + 1).replace(/[^\w.+-]/g, "_")}.html`);
    let html;
    if (saved && existsSync(saved)) html = readFileSync(saved, "latin1");
    else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`REBASE answered ${res.status} for ${url}.`);
      html = Buffer.from(await res.arrayBuffer()).toString("latin1");
      if (saved) writeFileSync(saved, html, "latin1");
    }
    date ||= /<font size=2>(\d{1,2}\/\d{1,2}\/\d{4})<\/font>/.exec(html)?.[1] ?? "";
    return html;
  };
  const { lines, left } = await readMethylation(result.kept, Object.keys(result.suppliers), get);
  writeFileSync(out, render({ ...result, methylation: { lines, date } }));
  console.log(`REBASE version ${result.version}: ${result.kept.length} enzymes sold, ${lines.length} methylation entries, written to ${out}.`);
  for (const line of result.left) console.log(`  left out ${line}`);
  for (const line of left) console.log(`  left out ${line}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
