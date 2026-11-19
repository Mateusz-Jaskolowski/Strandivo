// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The enzyme list's generator. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCut, render, selectEnzymes } from "./build-enzymes.mjs";
import { damlistUrl, msgetUrl, overlaps, parseDamlist, parseDrawing, parseMsget, readMethylation, reportsFor, entriesOf } from "./rebase-methylation.mjs";

test("REBASE's notation becomes the cuts the site search takes", () => {
  assert.deepEqual(parseCut("G^AATTC"), { site: "GAATTC", top: 1, bottom: 5, bothSides: false });
  assert.deepEqual(parseCut("GGTAC^C"), { site: "GGTACC", top: 5, bottom: 1, bothSides: false });
  assert.deepEqual(parseCut("GGTCTC(1/5)"), { site: "GGTCTC", top: 7, bottom: 11, bothSides: false });
  // Inside a site that isn't a palindrome, counted back from its end.
  assert.deepEqual(parseCut("CCGC(-3/-1)"), { site: "CCGC", top: 1, bottom: 3, bothSides: false });
  // Only the cut after the site is searched for.
  assert.deepEqual(parseCut("(10/12)CGANNNNNNTGC(12/10)"), { site: "CGANNNNNNTGC", top: 24, bottom: 22, bothSides: true });
  // A palindromic core cut outside on both strands: searched with Ns in front too.
  assert.deepEqual(parseCut("CASTGNN^"), { site: "NNCASTGNN", top: 9, bottom: 0, bothSides: false });
  assert.equal(parseCut("GGTACC"), null);
  assert.throws(() => parseCut("GAAG^AC"), /isn't a palindrome/);
  assert.throws(() => parseCut("G^AAT^TC"), /more than one cut/);
  assert.throws(() => parseCut("GAATTC?"), /Can't read/);
});

const file = (...records) => `REBASE version 611                                              withrefm.611
Rich Roberts                                                    Oct 29 2026
<ENZYME NAME>   Restriction enzyme name.
REBASE codes for commercial sources of enzymes

                B        Thermo Fisher Scientific (5/23)
                N        New England Biolabs (8/24)

${records.map(([name, site, sold]) => `<1>${name}\n<2>\n<3>${site}\n<4>\n<5>\n<6>\n<7>${sold}\n<8>\n`).join("\n")}`;

test("only enzymes someone sells are kept, and those of no use on a map are named", () => {
  const r = selectEnzymes(file(["EcoRI", "G^AATTC", "BN"], ["BspJ106I", "GGTACC", ""], ["MspJI", "CNNR(9/13)", "N"], ["NoCutI", "GAAGAC", "N"]));
  assert.equal(r.version, "611");
  assert.equal(r.date, "Oct 29 2026");
  assert.deepEqual(r.suppliers, { B: "Thermo Fisher Scientific", N: "New England Biolabs" });
  assert.deepEqual(r.kept.map(e => e.name), ["EcoRI"]);
  assert.deepEqual(r.left, ["MspJI CNNR(9/13): too short a site", "NoCutI GAAGAC: its cut isn't known"]);
  assert.throws(() => selectEnzymes(file(["EcoRI", "G^AATTC", "BW"])), /"W", which the header doesn't list/);
  assert.throws(() => selectEnzymes(file(["EcoRI", "G^AATTC", "B"], ["ecoRI", "G^AATTC", "N"])), /listed twice/);
  assert.match(render(r), /^EcoRI\tG\^AATTC\tGAATTC\t1\t5\t0\tBN$/m);
});

test("a supplier's name can't break out of its string in the generated file", () => {
  // A backslash before the quote would swallow the escape added for it, and one at the end
  // would swallow the closing quote.
  const name = 'Evil\\"; globalThis.pwned = 1; // \\';
  const r = selectEnzymes(file(["EcoRI", "G^AATTC", "B"]).replace("Thermo Fisher Scientific", name));
  assert.equal(r.suppliers.B, name);
  const written = /^ {2}B: (.*?),?$/m.exec(render(r))[1];
  assert.equal(JSON.parse(written), name);
});

test("the committed list cites REBASE, as its terms ask", () => {
  const list = readFileSync(new URL("../src/lib/rebaseEnzymes.ts", import.meta.url), "utf8");
  assert.match(list, /REBASE, The Restriction Enzyme Database, http:\/\/rebase\.neb\.com, is an open database/);
  assert.match(list, /Roberts, R\.J\., Vincze, T\.,\n\/\/ Posfai, J\., Macelis, D\. \(2023\)/);
});

// Pages as REBASE writes them, cut down: a damlist page's enzyme is its name and site, then
// a drawing per way the methylase's site overlaps it, each with rows of reports under what
// they say.
const drawing = lines => `<td width=30%><pre><font size=2>${lines.join("\n")}</font></pre></td>\n<td align=left width=350><table width=350>`;
const said = (effect, ...ms) =>
  `<tr><td width=16% bgcolor=yellow>${effect}</td><td width=19% bgcolor=#DDFFDD align=right>ms#</td></tr>\n` +
  ms.map(n => `<tr valign=top><td colspan=2 align=right><A HREF=/cgi-bin/msnget?${n}>${n}</A></td><td align=right><A HREF=/cgi-bin/refget?1>1</A></td></tr>\n`).join("");
const enzyme = (name, site, ...entries) =>
  `<tr valign=top><td><A HREF=/rebase/enz/${name}.html>${name}</A><br><font size=2>${site}</font><br>\n<table width=100%>${entries.join("</table></td></tr></table>\n<table width=100%>")}</table></td></tr></table>\n`;
const damlist = (...enzymes) => `<html><font size=2>11/17/2026</font><table>${enzymes.join("")}</table></html>`;
const msget = (...reports) => reports.map(([ms, colour, lines]) => `<tr>\n<td><font size=2>${ms}</font></td>\n<td><font size=2><pre><b>\n<font color=${colour}>${lines.join("\n")}\n</font></b></pre>`).join("\n");

const XBAI = enzyme(
  "XbaI",
  "TCTAGA",
  drawing(["          m6", " T C T A G A", " A G A T C T", "            "]) + said("blocked", 770),
  drawing(["          m6", " T C T A G A", " A G A T C T", "m6          "]) + said("blocked", 770) + said("not tested")
);
const BSPHI = enzyme("BspHI", "TCATGA", drawing(["          m6", " T C A T G A", " A G T A C T", "            "]) + said("blocked", 770) + said("cut", 3517) + said("impaired", 3518));

test("a drawing's marks are read off the base under their last character", () => {
  assert.deepEqual(parseDrawing(["          m6", " T C T A G A", " A G A T C T", "m6          "].join("\n")), {
    bases: "TCTAGA",
    marks: [{ strand: 0, pos: 5, type: "m6" }, { strand: 1, pos: 0, type: "m6" }]
  });
  assert.throws(() => parseDrawing(" T C T A G A\n A G A T C T"), /2 lines/);
});

test("a damlist page gives each enzyme's entries and what their reports say, without untested ones", () => {
  const [xba, bsp] = parseDamlist(damlist(XBAI, BSPHI));
  assert.equal(xba.name, "XbaI");
  assert.equal(xba.site, "TCTAGA");
  assert.deepEqual(xba.entries.map(e => [e.marks.map(k => `${k.strand}:${k.pos}`).join(" "), e.reports.map(r => r.effect).join()]), [["0:5", "blocked"], ["0:5 1:0", "blocked"]]);
  assert.deepEqual(bsp.entries[0].reports, [{ effect: "blocked", ms: 770 }, { effect: "cut", ms: 3517 }, { effect: "impaired", ms: 3518 }]);
  assert.throws(() => parseDamlist(damlist(enzyme("OddI", "GATC", drawing(["  m6", " G A T C", " C T A G", "        "]) + said("sometimes", 1)))), /"sometimes"/);
});

test("an msget page's reports are kept only where Dam could have made their marks, on DNA", () => {
  const reports = parseMsget(
    msget(
      ["1447", "#DD7700", ["     h     h", " U G A U C A", " A C U A G U", "     h     h"]],
      ["2001", "#C90000", ["    m6", " T G A T C A", " A C T A G T", "      m6"]],
      ["2002", "#DD7700", ["    m6", " T G A T C A", " A C T A G T", "            "]],
      ["2003", "#008000", ["m6", " T G A T C A", " A C T A G T", "            "]]
    )
  );
  assert.equal(reports.length, 4);
  // Phage DNA with uracil, and an A no GATC could methylate, are left out.
  const kept = entriesOf(reportsFor("dam", reports));
  assert.deepEqual(kept.map(e => [e.marks.map(k => `${k.strand}:${k.pos}`).join(" "), e.reports.map(r => r.effect).join()]), [["0:2 1:3", "blocked"], ["0:2", "impaired"]]);
});

test("a methylase overlaps a site where its own can reach a base, Ns aside", () => {
  assert.equal(overlaps("dam", "TCTAGA"), true);
  assert.equal(overlaps("dam", "GAATTC"), false);
  assert.equal(overlaps("dam", "CAGNNNCTG"), false);
  assert.equal(overlaps("dcm", "AGGCCT"), true);
});

test("methylation is read from every supplier's pages, filled in from msget, and written with the enzymes", async () => {
  const kept = [
    { name: "XbaI", notation: "T^CTAGA", site: "TCTAGA", top: 1, bottom: 5, bothSides: false, suppliers: "N" },
    { name: "BclI", notation: "T^GATCA", site: "TGATCA", top: 1, bottom: 5, bothSides: false, suppliers: "N" }
  ];
  const pages = new Map([
    [damlistUrl("dam", "N"), damlist(XBAI)],
    [msgetUrl("BclI"), msget(["2001", "#C90000", ["    m6", " T G A T C A", " A C T A G T", "      m6"]])]
  ]);
  const asked = [];
  const get = async url => (asked.push(url), pages.get(url) ?? damlist());
  const { lines } = await readMethylation(kept, ["N"], get);
  assert.ok(asked.every(url => url.startsWith("http://rebase.neb.com/cgi-bin/")));
  assert.deepEqual(lines, [
    { name: "XbaI", methylase: "dam", bases: "", marks: "t5", effects: "blocked" },
    { name: "XbaI", methylase: "dam", bases: "", marks: "t5 b0", effects: "blocked" },
    { name: "BclI", methylase: "dam", bases: "", marks: "t2 b3", effects: "blocked" }
  ]);
  const out = render({ version: "611", date: "Oct 29 2026", suppliers: { N: "New England Biolabs" }, kept: [...kept, { name: "DpnI", notation: "GA^TC", site: "GATC", top: 2, bottom: 2, bothSides: false, suppliers: "N" }], methylation: { lines, date: "11/17/2026" } });
  assert.match(out, /^XbaI\tdam\t\tt5 b0\tblocked$/m);
  assert.match(out, /DpnI: "dam"/);
  assert.match(out, /REBASE, The Restriction Enzyme Database, http:\/\/rebase\.neb\.com, is an open database/);
});
