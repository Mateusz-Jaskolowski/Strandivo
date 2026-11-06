// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Simulate cloning dialog. The open file is the vector; inserts come from the other
// open files or files chosen here. Restriction and ligation, Gibson, In-Fusion or Golden
// Gate, with the product shown as the choices change and opened in a new tab.

import { h, toast } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { fmt } from "../ui/format.ts";
import { openDialog } from "../ui/modal.ts";
import { track } from "../usage.ts";
import type { DocContext } from "../doc/context.ts";
import { parseSequenceFile } from "../doc/fileio.ts";
import { fromParsed } from "../doc/convert.ts";
import { pickFiles } from "../platform.ts";
import { SEQUENCE_EXTENSIONS } from "../lib/files.ts";
import { scanSites } from "../lib/enzymes.ts";
import {
  digest,
  endLabel,
  fragmentLength,
  fragmentWith,
  GIBSON,
  GOLDEN_GATE_ENZYMES,
  goldenGate,
  IN_FUSION,
  largest,
  ligateInsert,
  planAssembly,
  selfLigates,
  wholeFragment,
  type AssemblyInput,
  type AssemblyPrimer,
  type Fragment,
  type Layout
} from "../lib/cloning.ts";
import { rangeLength, type Range, type SeqData } from "../lib/seqdata.ts";
import { copyText } from "./inspector.ts";
import { field, plural, rerender } from "./primerDialogs.ts";

type Method = "restriction" | "gibson" | "infusion" | "goldengate";

const METHODS: { id: Method; label: string; note: string }[] = [
  { id: "restriction", label: "Restriction & ligation", note: "Cut the vector and the insert, then ligate the matching ends." },
  { id: "gibson", label: "Gibson", note: "Pieces join on 20 bp overlaps; primers add any that are missing, half on each side." },
  { id: "infusion", label: "In-Fusion", note: "The insert's primers carry 15 bases of each vector end." },
  { id: "goldengate", label: "Golden Gate", note: "A Type IIS enzyme cuts every part; their overhangs set the order." }
];

interface Source {
  title: string;
  data: SeqData;
  selection: Range | null;
}

interface InsertRow {
  /** Index into the sources, or -1 for none yet. */
  source: number;
  /** "all", "sel" or "f:<feature id>". */
  region: string;
  pcr: boolean;
  /** The insert's enzymes; null uses the vector's. */
  enzymes: [string, string] | null;
  /** Which digest fragment (restriction); null picks one. */
  fragment: number | null;
}

/** Kept between openings in this window. */
const memory = { method: "restriction" as Method, goldenGate: "BsaI" };

const counts = new WeakMap<SeqData, Map<string, number>>();
/** How many times each enzyme in the list cuts a sequence. */
function cutCountsOf(d: SeqData): Map<string, number> {
  let m = counts.get(d);
  if (!m) {
    m = new Map();
    for (const hit of scanSites(d.sequence, d.circular)) m.set(hit.enzyme, (m.get(hit.enzyme) ?? 0) + 1);
    counts.set(d, m);
  }
  return m;
}

const cutText = (k: number) => (k ? plural(k, "cut") : "doesn't cut");

/** A fragment as "1,201–2,686 · 2,617 bp · AmpR, ori". */
function fragmentText(f: Fragment, n: number): string {
  const end = (f.source.start + f.source.length - 1) % n;
  const names = [...new Set(f.data.features.map(x => x.name))];
  return `${fmt(f.source.start + 1)}–${fmt(end + 1)} · ${fmt(fragmentLength(f))} bp${names.length ? ` · ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}` : ""}`;
}

const PIECE_COLORS = ["var(--backbone)", "var(--accent)", "var(--ok)", "var(--diff)", "var(--warn)"];

/** The product as a line, its pieces coloured and the joins marked. */
function productBar(n: number, layout: Layout): HTMLElement {
  const pct = (p: number) => `${(p / n) * 100}%`;
  const spans: Node[] = [];
  layout.pieces.forEach((p, i) => {
    const color = PIECE_COLORS[i % PIECE_COLORS.length];
    const end = Math.min(p.start + p.length, n + p.start);
    const parts = end <= n ? [[p.start, end]] : [[p.start, n], [0, end - n]];
    for (const [a, b] of parts) spans.push(h("div", { class: "sv-pcr-bar-span", style: { left: pct(a), width: pct(Math.min(b, n) - a), background: color }, title: p.name }));
  });
  const ticks = layout.joins.map(j => h("div", { class: "sv-clone-join", style: { left: pct(j.at) } }));
  return h("div", { class: "sv-pcr-bar sv-clone-bar", "aria-hidden": "true" }, h("div", { class: "sv-pcr-bar-line" }), ...spans, ...ticks, h("div", { class: "sv-pcr-bar-ends sv-mono" }, h("span", null, "1"), h("span", null, fmt(n))));
}

/** "acgt…ACGT…": the tail dimmed. */
const primerBases = (bases: string) => {
  const tail = bases.match(/^[a-z]*/)?.[0] ?? "";
  return h("span", { class: "sv-mono sv-design-bases" }, tail ? h("span", { class: "sv-dim" }, tail) : "", bases.slice(tail.length));
};

/** What a product is called: the vector and inserts joined, as labs name constructs. */
const productName = (names: string[]) => names.map(x => x.replace(/\.(gbk?|dna|fasta|fa)$/i, "").replace(/\s+/g, "-")).join("-");

export function openCloningDialog(ctx: DocContext) {
  const vector = ctx.store.data;
  const vectorSel = ctx.store.selection;
  const nV = vector.sequence.length;
  const sources: Source[] = ctx.otherSequences().map(s => ({ title: s.data.name || s.title, data: s.data, selection: s.selection }));
  const dlg = openDialog({ title: "Simulate cloning", note: `${vector.name || "This sequence"} is the vector. Inserts come from your other open files, or choose one here.`, width: 820 });

  let method: Method = memory.method;
  let vectorEnzymes: [string, string] = ["", ""];
  let keep: number | null = null;
  let openByPcr = false;
  let direction = 0;
  const newRow = (): InsertRow => ({ source: sources.length ? 0 : -1, region: "all", pcr: true, enzymes: null, fragment: null });
  const enzymesOf = (row: InsertRow) => row.enzymes ?? vectorEnzymes;
  const setEnzyme = (row: InsertRow, i: 0 | 1, v: string) => {
    const next: [string, string] = [...enzymesOf(row)];
    next[i] = v;
    row.enzymes = next;
    row.fragment = null;
    update();
  };
  const setVectorEnzyme = (i: 0 | 1, v: string) => {
    vectorEnzymes[i] = v;
    keep = null;
    for (const r of rows) if (!r.enzymes) r.fragment = null;
    update();
  };
  const rows: InsertRow[] = [newRow()];
  // In the first row, start from the source's selection if it has one.
  if (sources[0]?.selection) rows[0].region = "sel";

  const update = () => rerender(dlg, render);

  const enzymeSelect = (d: SeqData, value: string, label: string, onChange: (v: string) => void, names?: string[]) => {
    const cuts = cutCountsOf(d);
    const list = (names ?? [...cuts.keys()].sort((a, b) => a.localeCompare(b))).filter(x => names || (cuts.get(x) ?? 0) > 0);
    if (value && !list.includes(value)) list.unshift(value);
    const el = h(
      "select",
      { class: "sv-input", "aria-label": label },
      names ? "" : h("option", { value: "" }, "None"),
      ...list.map(x => h("option", { value: x, selected: x === value }, `${x} · ${cutText(cuts.get(x) ?? 0)}`))
    ) as HTMLSelectElement;
    el.addEventListener("change", () => onChange(el.value));
    return el;
  };

  const choose = (label: string, value: string, options: [string, string][], onChange: (v: string) => void) => {
    const el = h("select", { class: "sv-input", "aria-label": label }, ...options.map(([v, text]) => h("option", { value: v, selected: v === value }, text))) as HTMLSelectElement;
    el.addEventListener("change", () => onChange(el.value));
    return el;
  };

  const segmented = (label: string, options: [string, string][], value: string, onChange: (v: string) => void) =>
    h(
      "div",
      { class: "sv-segmented", role: "group", "aria-label": label },
      ...options.map(([v, text]) => h("button", { type: "button", "aria-pressed": String(v === value), onclick: () => onChange(v) }, text))
    );

  async function addFiles(row: InsertRow) {
    const picked = await pickFiles("Sequence files", SEQUENCE_EXTENSIONS);
    for (const p of picked) {
      try {
        const parsed = await parseSequenceFile(p.bytes, p.path ?? p.name);
        const data = fromParsed(parsed.sequences[0]).data;
        sources.push({ title: data.name || p.name, data: { ...data, name: data.name || p.name }, selection: null });
        row.source = sources.length - 1;
        row.region = "all";
        row.fragment = null;
      } catch (e) {
        toast(`Couldn't read ${p.name}: ${e instanceof Error ? e.message : e}`, "error", 6000);
      }
    }
    update();
  }

  const sourceSelect = (row: InsertRow, label: string) => {
    const el = choose(
      label,
      row.source < 0 ? "" : String(row.source),
      [...(row.source < 0 ? [["", "Choose…"] as [string, string]] : []), ...sources.map((s, i): [string, string] => [String(i), `${s.title} · ${fmt(s.data.sequence.length)} bp`]), ["pick", "Choose a file…"]],
      v => {
        if (v === "pick") {
          void addFiles(row);
          return;
        }
        row.source = Number(v);
        row.region = sources[row.source].selection ? "sel" : "all";
        row.fragment = null;
        update();
      }
    );
    return el;
  };

  const regionOf = (row: InsertRow): Range | null => {
    const s = sources[row.source];
    if (!s) return null;
    const n = s.data.sequence.length;
    if (row.region === "sel" && s.selection) return s.selection;
    const f = row.region.startsWith("f:") ? s.data.features.find(x => `f:${x.id}` === row.region) : undefined;
    return f ? { start: f.start, end: f.end } : { start: 0, end: n - 1 };
  };

  const regionSelect = (row: InsertRow) => {
    const s = sources[row.source];
    const n = s.data.sequence.length;
    const options: [string, string][] = [["all", `Whole sequence · ${fmt(n)} bp`]];
    if (s.selection) options.push(["sel", `Selection · ${fmt(s.selection.start + 1)}–${fmt(s.selection.end + 1)} · ${fmt(rangeLength(s.selection, n))} bp`]);
    for (const f of [...s.data.features].sort((a, b) => a.start - b.start)) options.push([`f:${f.id}`, `${f.name} · ${fmt(rangeLength(f, n))} bp`]);
    return choose("Part of the insert", row.region, options, v => {
      row.region = v;
      update();
    });
  };

  /** The opened vector for restriction cloning and enzyme-opened assemblies. */
  const vectorPieces = () => {
    const enzymes = vectorEnzymes.filter(Boolean);
    return enzymes.length ? digest(vector, enzymes) : [];
  };
  const backboneOf = (pieces: Fragment[]) => (keep !== null && pieces[keep] ? pieces[keep] : largest(pieces));

  // ---------- sections ----------

  function vectorSection(): Node {
    const parts: Node[] = [];
    const enzymeRow = () => {
      const pieces = vectorPieces();
      const row: Node[] = [
        field("Enzyme", enzymeSelect(vector, vectorEnzymes[0], "First vector enzyme", v => setVectorEnzyme(0, v))),
        field("Second enzyme", enzymeSelect(vector, vectorEnzymes[1], "Second vector enzyme", v => setVectorEnzyme(1, v)))
      ];
      if (pieces.length > 1) {
        const bb = backboneOf(pieces)!;
        row.push(
          field(
            "Keep",
            choose("Vector fragment to keep", String(pieces.indexOf(bb)), pieces.map((f, i): [string, string] => [String(i), fragmentText(f, nV)]), v => {
              keep = Number(v);
              update();
            })
          )
        );
      }
      return h("div", { class: "sv-clone-fields" }, ...row);
    };
    if (method === "goldengate") {
      parts.push(
        h(
          "div",
          { class: "sv-clone-fields" },
          field(
            "Enzyme",
            enzymeSelect(
              vector,
              memory.goldenGate,
              "Golden Gate enzyme",
              v => {
                memory.goldenGate = v;
                update();
              },
              GOLDEN_GATE_ENZYMES
            )
          )
        )
      );
    } else if (method === "restriction") {
      parts.push(enzymeRow());
    } else {
      parts.push(
        segmented("How the vector is opened", [["enzymes", "Cut with enzymes"], ["pcr", "Amplify by PCR"]], openByPcr ? "pcr" : "enzymes", v => {
          openByPcr = v === "pcr";
          update();
        })
      );
      if (openByPcr) {
        const r = vectorSel.range;
        parts.push(
          h(
            "p",
            { class: "sv-small sv-dim" },
            r
              ? `Primers amplify everything except the selection (${fmt(r.start + 1)}–${fmt(r.end + 1)}), which the inserts replace.`
              : `Primers amplify the whole vector from the cursor (base ${fmt(vectorSel.caret + 1)}), where the inserts go. Select bases first to replace them instead.`
          )
        );
      } else parts.push(enzymeRow());
    }
    return h("section", { class: "sv-clone-section" }, h("h3", { class: "sv-clone-head" }, "Vector", h("span", { class: "sv-pane-note" }, `${vector.name} · ${fmt(nV)} bp · ${vector.circular ? "circular" : "linear"}`)), ...parts);
  }

  function insertsSection(): Node {
    const many = method !== "restriction";
    const noun = method === "goldengate" ? "Part" : "Insert";
    const list = (many ? rows : rows.slice(0, 1)).map((row, i) => {
      const s = sources[row.source];
      const fields: Node[] = [field(many && rows.length > 1 ? `${noun} ${i + 1}` : noun, sourceSelect(row, `${noun} ${i + 1}`))];
      if (s && method === "restriction") {
        fields.push(field("Enzyme", enzymeSelect(s.data, enzymesOf(row)[0], "First insert enzyme", v => setEnzyme(row, 0, v))));
        fields.push(field("Second enzyme", enzymeSelect(s.data, enzymesOf(row)[1], "Second insert enzyme", v => setEnzyme(row, 1, v))));
        const pieces = insertPieces(row);
        if (pieces.length > 1) {
          const chosen = insertFragment(row, pieces);
          const options = pieces.map((f, k): [string, string] => [String(k), fragmentText(f, s.data.sequence.length)]);
          fields.push(
            field(
              "Fragment",
              choose("Insert fragment", String(chosen ? pieces.indexOf(chosen) : 0), options, v => {
                row.fragment = Number(v);
                update();
              })
            )
          );
        }
      } else if (s && (method === "gibson" || method === "infusion")) {
        fields.push(field("Part of it", regionSelect(row)));
        fields.push(
          field(
            "Made by",
            segmented("How the insert is made", [["pcr", "PCR"], ["asis", "As it is"]], row.pcr ? "pcr" : "asis", v => {
              row.pcr = v === "pcr";
              update();
            })
          )
        );
      }
      const remove =
        many && rows.length > 1
          ? h("button", { type: "button", class: "sv-icon-btn sv-clone-remove", "aria-label": `Remove ${noun.toLowerCase()} ${i + 1}`, title: "Remove", onclick: () => { rows.splice(i, 1); update(); } }, iconSvg("x", 14))
          : "";
      return h("div", { class: "sv-clone-insert" }, h("div", { class: "sv-clone-fields" }, ...fields), remove);
    });
    const empty = !sources.length
      ? h("p", { class: "sv-small sv-dim" }, `Open the ${noun.toLowerCase()}'s file in another tab, or choose a file.`)
      : "";
    const add = many ? h("button", { type: "button", class: "sv-btn sv-clone-add", onclick: () => { rows.push(newRow()); update(); } }, iconSvg("plus", 14), `Add ${noun.toLowerCase()}`) : "";
    return h("section", { class: "sv-clone-section" }, h("h3", { class: "sv-clone-head" }, method === "goldengate" ? "Parts" : many ? "Inserts" : "Insert", method === "goldengate" ? h("span", { class: "sv-pane-note" }, "Their overhangs decide the order") : ""), empty, ...list, add);
  }

  const insertPieces = (row: InsertRow): Fragment[] => {
    const s = sources[row.source];
    const enzymes = enzymesOf(row).filter(Boolean);
    return s && enzymes.length ? digest(s.data, enzymes) : [];
  };
  const insertFragment = (row: InsertRow, pieces: Fragment[]): Fragment | null => {
    if (row.fragment !== null && pieces[row.fragment]) return pieces[row.fragment];
    const s = sources[row.source];
    if (s?.selection) return fragmentWith(pieces, s.selection, s.data.sequence.length);
    // Otherwise the smallest piece that fits the vector (an insert cut out of its plasmid).
    const bb = backboneOf(vectorPieces());
    const fits = bb ? pieces.filter(f => ligateInsert(bb, f).length) : [];
    const pool = fits.length ? fits : pieces;
    return pool.reduce<Fragment | null>((a, f) => (!a || fragmentLength(f) < fragmentLength(a) ? f : a), null);
  };

  // ---------- the product ----------

  interface Outcome {
    product: SeqData | null;
    layout: Layout | null;
    facts: [string, Node | string][];
    problems: string[];
    notes: string[];
    primers: AssemblyPrimer[];
    choice?: Node;
    /** What's missing before there is anything to show. */
    waiting?: string;
  }

  function simulate(): Outcome {
    const out: Outcome = { product: null, layout: null, facts: [], problems: [], notes: [], primers: [] };
    const chosen = (method === "restriction" ? rows.slice(0, 1) : rows).filter(r => sources[r.source]);
    if (method === "restriction") return restriction(out, chosen[0]);
    if (method === "goldengate") {
      if (!chosen.length) return { ...out, waiting: "Choose the parts to assemble." };
      const r = goldenGate([{ name: vector.name, data: vector }, ...chosen.map(x => ({ name: sources[x.source].title, data: sources[x.source].data }))], memory.goldenGate);
      out.problems = r.problems;
      if (r.product && r.layout) {
        out.product = { ...r.product, name: productName([vector.name, ...r.order.slice(1).map(f => f.source.name)]), description: `Golden Gate assembly with ${memory.goldenGate} of ${r.order.map(f => f.source.name).join(", ")}.` };
        out.layout = r.layout;
        out.facts.push(["Joins", h("span", { class: "sv-mono" }, r.order.map(f => f.right.bases).join(" · "))]);
      }
      return out;
    }
    // Gibson and In-Fusion
    if (!chosen.length) return { ...out, waiting: "Choose the inserts to assemble." };
    let first: AssemblyInput;
    let opened: string;
    if (openByPcr) {
      const r = vectorSel.range;
      const range = r ? { start: (r.end + 1) % nV, end: (r.start - 1 + nV) % nV } : { start: vectorSel.caret % nV, end: (vectorSel.caret - 1 + nV) % nV };
      if (!vector.circular) return { ...out, waiting: "Amplifying the vector by PCR needs a circular vector." };
      first = { name: vector.name, fragment: wholeFragment(vector, range), pcr: { template: vector, range } };
      opened = "amplified by PCR";
    } else {
      const pieces = vectorPieces();
      const bb = backboneOf(pieces);
      if (!vectorEnzymes.some(Boolean)) return { ...out, waiting: "Choose the enzymes that open the vector, or amplify it by PCR." };
      if (!bb) return { ...out, waiting: `${vectorEnzymes.filter(Boolean).join(" and ")} ${vectorEnzymes.filter(Boolean).length > 1 ? "don't" : "doesn't"} cut ${vector.name}.` };
      first = { name: vector.name, fragment: bb };
      opened = `opened with ${vectorEnzymes.filter(Boolean).join(" and ")}`;
    }
    const inputs: AssemblyInput[] = [first];
    for (const row of chosen) {
      const s = sources[row.source];
      const range = regionOf(row)!;
      const regionName = row.region.startsWith("f:") ? (s.data.features.find(x => `f:${x.id}` === row.region)?.name ?? s.title) : s.title;
      inputs.push({ name: regionName, fragment: wholeFragment(s.data, range), pcr: row.pcr ? { template: s.data, range } : undefined });
    }
    const plan = planAssembly(inputs, method === "gibson" ? GIBSON : IN_FUSION, true);
    out.problems = plan.problems;
    out.primers = plan.pieces.flatMap(p => p.primers);
    if (plan.product && plan.layout) {
      const label = method === "gibson" ? "Gibson assembly" : "In-Fusion cloning";
      out.product = { ...plan.product, name: productName(inputs.map(x => x.name)), description: `${label} of ${inputs[0].name} (${opened}) and ${inputs.slice(1).map(x => x.name).join(", ")}.` };
      out.layout = plan.layout;
    }
    out.facts.push([
      "Overlaps",
      h(
        "div",
        { class: "sv-clone-joins" },
        ...plan.joins.map((j, i) =>
          h(
            "span",
            null,
            `${inputs[i].name} → ${inputs[(i + 1) % inputs.length].name}: `,
            j.bases ? `${j.bases.length} bp${j.tm !== null ? `, Tm ${j.tm.toFixed(1)} °C` : ""}${j.designed ? ", from primer tails" : ", already there"}` : "none"
          )
        )
      )
    ]);
    return out;
  }

  function restriction(out: Outcome, row: InsertRow | undefined): Outcome {
    if (!vectorEnzymes.some(Boolean)) return { ...out, waiting: "Choose the enzymes that open the vector." };
    const pieces = vectorPieces();
    const bb = backboneOf(pieces);
    if (!bb) return { ...out, waiting: `${vectorEnzymes.filter(Boolean).join(" and ")} ${vectorEnzymes.filter(Boolean).length > 1 ? "don't" : "doesn't"} cut ${vector.name}.` };
    if (!row) return { ...out, waiting: "Choose the insert." };
    const s = sources[row.source];
    const enzymes = enzymesOf(row).filter(Boolean);
    if (!enzymes.length) return { ...out, waiting: "Choose the enzymes that cut the insert." };
    const ip = insertPieces(row);
    const insert = insertFragment(row, ip);
    if (!insert) return { ...out, waiting: `${enzymes.join(" and ")} ${enzymes.length > 1 ? "don't" : "doesn't"} cut ${s.title}.` };
    const named = { ...insert, source: { ...insert.source, name: s.title } };
    const results = ligateInsert({ ...bb, source: { ...bb.source, name: vector.name } }, named);
    out.facts.push(["Vector ends", `${endLabel(bb.left)} and ${endLabel(bb.right)}`], ["Insert ends", `${endLabel(insert.left)} and ${endLabel(insert.right)}`]);
    if (!results.length) {
      out.problems.push("The insert's ends don't match the vector's, so they can't be ligated. Pick enzymes with matching overhangs, or blunt ends on both.");
      return out;
    }
    if (direction >= results.length) direction = 0;
    const r = results[direction];
    if (results.length > 1) {
      const options = results.map((x, i): [string, string] => [String(i), x.flipped ? "Reversed" : "As in its file"]);
      out.choice = field(
        "Insert direction",
        segmented("Insert direction", options, String(direction), v => {
          direction = Number(v);
          update();
        })
      );
      out.notes.push("The insert's ends fit either way round, so colonies will have both directions: check them by sequencing or a digest.");
    }
    if (selfLigates(bb)) out.notes.push("The opened vector's ends match each other, so it can close without an insert. Dephosphorylating it helps.");
    out.product = { ...r.product, name: productName([vector.name, s.title]), description: `${vector.name} cut with ${vectorEnzymes.filter(Boolean).join(" and ")}, ligated with ${s.title} cut with ${enzymes.join(" and ")}${r.flipped ? " (reversed)" : ""}.` };
    out.layout = r.layout;
    return out;
  }

  // ---------- render ----------

  function render() {
    const methodBar = segmented(
      "Cloning method",
      METHODS.map(m => [m.id, m.label]),
      method,
      v => {
        method = v as Method;
        memory.method = method;
        direction = 0;
        update();
      }
    );
    methodBar.classList.add("sv-clone-methods");
    const o = simulate();
    const result: Node[] = [];
    if (o.waiting) result.push(h("p", { class: "sv-small sv-dim" }, o.waiting));
    if (o.product && o.layout) {
      const n = o.product.sequence.length;
      result.push(
        h("div", { class: "sv-clone-result-head" }, h("span", { class: "sv-strong" }, o.product.name), h("span", { class: "sv-pane-note" }, `${fmt(n)} bp · ${o.product.circular ? "circular" : "linear"} · ${plural(o.product.features.length, "feature")}`)),
        productBar(n, o.layout)
      );
      o.facts.unshift([
        "Pieces",
        h(
          "div",
          { class: "sv-clone-pieces" },
          ...o.layout.pieces.map((p, i) => h("span", null, h("span", { class: "sv-clone-swatch", style: { background: PIECE_COLORS[i % PIECE_COLORS.length] } }), `${p.name} · ${fmt(p.length)} bp${p.flipped ? " · reversed" : ""}`))
        )
      ]);
    }
    if (o.facts.length) result.push(h("dl", { class: "sv-facts sv-pcr-facts sv-clone-facts" }, ...o.facts.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])));
    if (o.choice) result.push(o.choice);
    if (o.primers.length) {
      result.push(
        h(
          "div",
          { class: "sv-design-result" },
          h("div", { class: "sv-design-result-head" }, h("span", { class: "sv-strong" }, "Primers"), h("span", { class: "sv-pane-note" }, "Tails in lower case; Tm of the part that binds")),
          h("div", { class: "sv-design-pair" }, ...o.primers.flatMap(p => [h("span", { class: "sv-strong" }, p.name), primerBases(p.bases), h("span", { class: "sv-num sv-dim" }, `${p.bases.length} nt · ${p.tm.toFixed(1)} °C`)]))
        )
      );
    }
    for (const p of o.problems) result.push(h("p", { class: "sv-small sv-text-warn" }, iconSvg("warn", 13), " ", p));
    for (const p of o.notes) result.push(h("p", { class: "sv-small sv-dim" }, p));

    dlg.body.replaceChildren(
      methodBar,
      h("p", { class: "sv-small sv-dim sv-clone-method-note" }, METHODS.find(m => m.id === method)!.note),
      vectorSection(),
      insertsSection(),
      h("section", { class: "sv-clone-section sv-pcr-result", "aria-live": "polite" }, h("h3", { class: "sv-clone-head" }, "Product"), ...result)
    );
    const foot: Node[] = [h("button", { type: "button", class: "sv-btn sv-foot-start", onclick: () => dlg.close() }, "Cancel")];
    if (o.primers.length) {
      const text = o.primers.map(p => `${p.name}\t${p.bases}`).join("\n");
      foot.push(h("button", { type: "button", class: "sv-btn", onclick: () => void copyText(text, plural(o.primers.length, "primer")) }, iconSvg("copy", 14), "Copy primers"));
    }
    const product = o.product;
    foot.push(
      h(
        "button",
        {
          type: "button",
          class: "sv-btn sv-btn-primary",
          disabled: !product,
          onclick: () => {
            if (!product) return;
            dlg.close();
            track("dialog_completed", { dialog: "cloning", method });
            ctx.openNew(product);
          }
        },
        "Open product"
      )
    );
    dlg.footer.replaceChildren(...foot);
  }

  render();
}
