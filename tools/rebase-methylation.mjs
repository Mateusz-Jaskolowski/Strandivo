// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// How Dam, Dcm and CpG methylation affect the enzymes on sale, read from REBASE for
// tools/build-enzymes.mjs, which writes it into src/lib/rebaseEnzymes.ts.
//
// REBASE's "damlist" pages give, for one company's enzymes and one methylase, each way the
// methylase's site can overlap an enzyme's: the enzyme's site with the methylated bases
// marked, and what the reports say (cut, impaired, blocked), each with its ms# and ref#. A
// marker such as "m6" sits above the top strand or below the bottom strand, its digit in
// the column of the base it methylates. Lower-case letters narrow a site's ambiguity codes
// to the bases the entry is about (BsaWI's WCCGGW as WCCGGa). One page per company and
// methylase, merged, covers every enzyme on sale.
//
// A few enzymes REBASE has reports for are missing from those pages (BclI and DpnII, Nov
// 2026). For them, the enzyme's "msget" page lists every report on modified bases, so the
// ones whose marks Dam or Dcm could make are kept from it.

/** The methylases kept, by REBASE's name on the damlist pages and the mark it makes. */
export const METHYLASES = [
  { id: "dam", rebase: "M.EcoKDam", mark: "m6", base: "A" },
  { id: "dcm", rebase: "M.EcoKDcm", mark: "m5", base: "C" },
  { id: "cpg", rebase: "CG", mark: "m5", base: "C" }
];

/** What reports say, in the order lists give them. */
export const EFFECTS = ["cut", "impaired", "blocked"];

const decode = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * The bases and marks of a drawing of both strands: a line of marks, the top strand, the
 * bottom strand and a line of marks, each base one column apart. A mark's last character
 * stands over (or under) the base it is on: "m6", or "h" on msget pages. Positions count from the drawing's first base;
 * strand 0 is the top strand, 1 the bottom, on the top strand's positions.
 */
export function parseDrawing(pre) {
  const lines = decode(pre).split("\n").filter((l, i, all) => !(i === 0 && !l.trim() && all.length > 4));
  if (lines.length !== 4) throw new Error(`A drawing of ${lines.length} lines, not 4: ${JSON.stringify(pre)}`);
  const [above, top, bottom, below] = lines;
  const first = top.search(/\S/);
  const bases = top.slice(first).split(" ").join("");
  if (!/^[A-Za-z]+$/.test(bases) || top.slice(first).replace(/ /g, "").length !== bases.length) throw new Error(`Can't read the bases in ${JSON.stringify(top)}.`);
  const position = (col, line) => {
    const i = (col - first) / 2;
    if (!Number.isInteger(i) || i < 0 || i >= bases.length) throw new Error(`A mark off the bases in ${JSON.stringify(line)}.`);
    return i;
  };
  const marks = [];
  for (const [strand, line] of [[0, above], [1, below]])
    for (const m of line.matchAll(/\S+/g)) marks.push({ strand, pos: position(m.index + m[0].length - 1, line), type: m[0] });
  const lower = bottom.slice(first).split(" ").join("");
  if (lower.length !== bases.length) throw new Error(`The strands differ in length: ${JSON.stringify(pre)}.`);
  marks.sort((a, b) => a.strand - b.strand || a.pos - b.pos);
  return { bases, marks };
}

/**
 * One company's enzymes on one damlist page: each enzyme's site and entries, an entry being
 * a drawing and its reports. Entries with no report (MspJI's), or REBASE's "not tested", are left out.
 */
export function parseDamlist(html) {
  const out = [];
  const blocks = html.split(/<tr valign=top><td><A HREF=\/rebase\/enz\/[^>]*>/).slice(1);
  for (const block of blocks) {
    const head = /^([^<]+)<\/A><br><font size=2>([^<]*)<\/font>/.exec(block);
    if (!head) throw new Error(`Can't read an enzyme's heading: ${block.slice(0, 80)}`);
    const [, name, site] = head;
    const entries = [];
    for (const part of block.split(/<td width=30%><pre><font size=2>/).slice(1)) {
      const end = part.indexOf("</font></pre>");
      if (end < 0) throw new Error(`${name}: a drawing with no end.`);
      const { bases, marks } = parseDrawing(part.slice(0, end));
      const reports = [];
      // Each effect heads the rows of reports under it; a row without an ms# adds a reference.
      for (const group of part.slice(end).split(/<td width=16% bgcolor=[^>]*>/).slice(1)) {
        const effect = /^([^<]*)<\/td>/.exec(group)[1].trim();
        if (effect === "not tested") continue;
        if (!EFFECTS.includes(effect)) throw new Error(`${name}: an effect "${effect}" this doesn't know.`);
        const ms = [...group.matchAll(/msnget\?(\d+)>/g)].map(m => Number(m[1]));
        if (!ms.length) throw new Error(`${name}: "${effect}" with no ms#.`);
        for (const n of ms) reports.push({ effect, ms: n });
      }
      if (reports.length) entries.push({ bases, marks, reports });
    }
    out.push({ name: name.trim(), site: site.trim(), entries });
  }
  return out;
}

/** The colours an msget page gives each column of reports. */
const MSGET_EFFECTS = { "#008000": "cut", "#DD7700": "impaired", "#C90000": "blocked" };

/** Every report on an enzyme's msget page: its ms#, effect and drawing. */
export function parseMsget(html) {
  const out = [];
  for (const m of html.matchAll(/<tr>\s*<td><font size=2>(\d+)<\/font><\/td>\s*<td><font size=2><pre><b>\n<font color=(#[0-9A-Fa-f]{6})>([\s\S]*?)<\/font><\/b><\/pre>/g)) {
    const [, ms, colour, pre] = m;
    const effect = MSGET_EFFECTS[colour.toUpperCase()];
    if (!effect) throw new Error(`ms# ${ms}: a colour ${colour} this doesn't know.`);
    out.push({ ms: Number(ms), effect, ...parseDrawing(pre.replace(/\n$/, "")) });
  }
  return out;
}

const IUPAC = { A: "A", C: "C", G: "G", T: "T", U: "T", R: "AG", Y: "CT", S: "CG", W: "AT", K: "GT", M: "AC", B: "CGT", D: "AGT", H: "ACT", V: "ACG", N: "ACGT" };
/** Whether a base of a site (an ambiguity code) can be `base`. */
const canBe = (code, base) => (IUPAC[code.toUpperCase()] ?? "").includes(base);

/**
 * The methylases' own sites, with where they methylate: Dam GATC's A, Dcm CCWGG's second C,
 * and CpG's C, on both strands (on the bottom strand at the top strand's position).
 */
const OWN_SITES = {
  dam: { site: "GATC", marks: [[0, 1], [1, 2]] },
  dcm: { site: "CCWGG", marks: [[0, 1], [1, 3]] },
  cpg: { site: "CG", marks: [[0, 0], [1, 1]] }
};

/**
 * Whether a methylase's site could lie on `bases` (an enzyme's site, its codes narrowed by
 * an entry's lower-case letters) so as to methylate the base at `pos` on `strand`. Bases
 * beyond the site can be anything.
 */
export function couldMethylate(methylase, bases, strand, pos) {
  const own = OWN_SITES[methylase];
  return own.marks.some(([s, at]) => {
    if (s !== strand) return false;
    const start = pos - at;
    return [...own.site].every((code, i) => {
      const j = start + i;
      return j < 0 || j >= bases.length || [...IUPAC[code]].some(b => canBe(bases[j], b));
    });
  });
}

/**
 * Whether a methylase can methylate a base of a site, so its effect could matter. Bases an
 * N stands for don't count, as REBASE counts them: it calls AlwNI's CAGNNNCTG and Dam "no
 * overlap", though a GATC fits in its Ns.
 */
export function overlaps(methylase, site) {
  return [0, 1].some(strand => [...site].some((code, pos) => code.toUpperCase() !== "N" && couldMethylate(methylase, site, strand, pos)));
}

/**
 * Whether `k`'s partner on the other strand of the same methylase site also sits on a non-N
 * base of `bases`, and if so is marked too. In E. coli, Dam and Dcm methylate both strands
 * of every site they recognise, so a hemi-methylated report on an msget page (such as
 * BclI's single-strand t2) isn't what the methylase makes.
 */
function pairedIn(methylase, bases, marks, k) {
  const own = OWN_SITES[methylase];
  const [, at] = own.marks.find(([s]) => s === k.strand);
  const [other, otherAt] = own.marks.find(([s]) => s !== k.strand);
  const partner = k.pos - at + otherAt;
  if (partner < 0 || partner >= bases.length || bases[partner].toUpperCase() === "N") return true;
  return marks.some(m => m.strand === other && m.pos === partner);
}

/**
 * Of an msget page's reports, those whose marks the methylase could make on double-stranded
 * E. coli DNA: its mark on every marked base, each where its site could put it, with both
 * strands marked wherever both fall on concrete bases of the site.
 */
export function reportsFor(methylase, reports) {
  const mark = METHYLASES.find(m => m.id === methylase).mark;
  // Not DNA as a plasmid has it: uracil in place of thymine (phage PBS1's).
  const dna = r => [...r.bases].every(c => c.toUpperCase() !== "U" && IUPAC[c.toUpperCase()]);
  return reports.filter(r => dna(r) && r.marks.length && r.marks.every(k => k.type === mark && couldMethylate(methylase, r.bases, k.strand, k.pos) && pairedIn(methylase, r.bases, r.marks, k)));
}

/** Entries from reports: one per drawing (bases and marks), with every report on it. */
export function entriesOf(reports) {
  const byKey = new Map();
  for (const r of reports) {
    const key = `${r.bases}|${r.marks.map(k => `${k.strand}:${k.pos}`).join(",")}`;
    if (!byKey.has(key)) byKey.set(key, { bases: r.bases, marks: r.marks, reports: [] });
    byKey.get(key).reports.push({ effect: r.effect, ms: r.ms });
  }
  return [...byKey.values()];
}

/** Two lists of entries as one: an entry both have keeps every report once. */
function mergeEntries(into, entries) {
  for (const e of entries) {
    const same = into.find(x => x.bases === e.bases && sameMarks(x.marks, e.marks));
    if (!same) into.push({ bases: e.bases, marks: e.marks, reports: [...e.reports] });
    else for (const r of e.reports) if (!same.reports.some(x => x.ms === r.ms && x.effect === r.effect)) same.reports.push(r);
  }
  return into;
}
const sameMarks = (a, b) => a.length === b.length && a.every((k, i) => k.strand === b[i].strand && k.pos === b[i].pos);

const BASE = "http://rebase.neb.com/cgi-bin";
export const damlistUrl = (methylase, supplier) => `${BASE}/damlist?m${METHYLASES.find(m => m.id === methylase).rebase}+s${supplier}`;
export const msgetUrl = name => `${BASE}/msget?${encodeURIComponent(name)}`;

/**
 * What methylation does to each enzyme kept: every company's damlist page for each
 * methylase, merged, and for an enzyme Dam or Dcm could methylate that those pages leave
 * out, the reports on its msget page. `kept` is the enzymes (name and the site searched
 * for), `get` reads a page by its address. Entries are in the order REBASE gives them.
 */
export async function readMethylation(kept, suppliers, get) {
  const sites = new Map(kept.map(e => [e.name, e.site]));
  const out = { dam: new Map(), dcm: new Map(), cpg: new Map() };
  for (const m of METHYLASES)
    for (const code of suppliers)
      for (const { name, entries } of parseDamlist(await get(damlistUrl(m.id, code)))) {
        if (!sites.has(name) || !entries.length) continue;
        out[m.id].set(name, mergeEntries(out[m.id].get(name) ?? [], entries));
      }
  for (const e of kept) {
    const missing = ["dam", "dcm"].filter(m => !out[m].has(e.name) && overlaps(m, e.site));
    if (!missing.length) continue;
    const reports = parseMsget(await get(msgetUrl(e.name)));
    for (const m of missing) {
      const entries = entriesOf(reportsFor(m, reports));
      if (entries.length) out[m].set(e.name, entries);
    }
  }
  const lines = [];
  const left = [];
  for (const e of kept)
    for (const m of METHYLASES) {
      for (const entry of out[m.id].get(e.name) ?? []) {
        // Entries are drawn on the site REBASE writes; TspRI's is searched with Ns in front.
        const fits = (c, i) => (c === c.toUpperCase() ? c === e.site[i] : canBe(e.site[i], c.toUpperCase()));
        if (entry.bases.length !== e.site.length || ![...entry.bases].every(fits)) {
          left.push(`${e.name} ${m.id} ${entry.bases}: not drawn on the site searched for`);
          continue;
        }
        const effects = EFFECTS.filter(x => entry.reports.some(r => r.effect === x));
        const marks = entry.marks.map(k => `${"tb"[k.strand]}${k.pos}`).join(" ");
        lines.push({ name: e.name, methylase: m.id, bases: /[a-z]/.test(entry.bases) ? entry.bases : "", marks, effects: effects.join(",") });
      }
    }
  return { lines, left };
}
