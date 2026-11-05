#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Builds the parts catalog from tools/catalog-sources.tsv.
//
//   node tools/build-catalog.mjs [--out <file>] [--cache <dir>] [--only <id,id>]
//
// A maintainer runs this; the app never does. The result is committed, so builds and CI
// need no network. Bases come from the record that first described the part: for a gene
// the coordinates are read out of the record's own feature table rather than typed here,
// and a hand-entered tag is checked against the peptide it should translate to.
//
// Sources and their terms are in docs/feature-catalog.md. Nothing goes in without one.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(root, "tools/catalog-sources.tsv");
const DEFAULT_OUT = join(root, "crates/seqcore/data/parts.tsv");
const AMR_CDS = "https://ftp.ncbi.nlm.nih.gov/pathogen/Antimicrobial_resistance/AMRFinderPlus/database/latest/AMR_CDS.fa";
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const CROSSREF = "https://api.crossref.org/works";
/** The shortest entry worth searching for: below this, chance matches take over. */
const MIN_BASES = 15;
/**
 * The same for a protein entry, which is searched in all six frames. Six residues is
 * about one in 64 million by chance, and it is what the commonest tags need: 6xHis,
 * ENLYFQG and PKKKRKV are all at or below seven.
 */
const MIN_RESIDUES = 6;
const RESIDUES = /^[ACDEFGHIKLMNPQRSTVWY]+$/;

const LICENCE = {
  ncbi: "ncbi-unrestricted",
  amrfinder: "usgov-public-domain",
  literal: "published-sequence",
  uniprot: "cc-by-4.0",
  fpbase: "fpbase-open",
  // Bases from a GenBank record, but an extent we decided ourselves because the record
  // marks the feature as a single base. Tagged separately so it is never mistaken for
  // the record's own annotation, and so the review dialog can say whose definition it is.
  defined: "defined-extent"
};

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};
const out = flag("--out") ?? DEFAULT_OUT;
const cacheDir = flag("--cache") ?? join(tmpdir(), "strandivo-catalog-cache");
const only = flag("--only")?.split(",").map(s => s.trim());

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- the manifest ----------

function readManifest() {
  const text = readFileSync(MANIFEST, "utf8");
  const rows = [];
  let columns = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const cells = line.split("\t");
    if (!columns) {
      columns = cells.map(c => c.trim());
      continue;
    }
    const row = {};
    columns.forEach((c, i) => (row[c] = (cells[i] ?? "").trim()));
    rows.push(row);
  }
  return rows;
}

// ---------- fetching ----------

/** Fetches a URL, keeping a copy in the cache so re-runs don't hit the server again. */
async function cached(url, name) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  process.stderr.write(`  fetching ${name}\n`);
  const res = await fetch(url, { headers: { "User-Agent": "strandivo-build-catalog" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.includes("Error:") && text.length < 500) throw new Error(`${url}: ${text.trim()}`);
  writeFileSync(file, text);
  // NCBI asks for no more than three requests a second.
  await sleep(400);
  return text;
}

const record = acc => cached(`${EUTILS}?db=nuccore&id=${encodeURIComponent(acc)}&rettype=gb&retmode=text&tool=strandivo-build-catalog`, `${acc}.gb`);

// ---------- GenBank ----------

/** The record's bases, upper case. */
function genbankSequence(text) {
  const at = text.indexOf("\nORIGIN");
  if (at < 0) throw new Error("no ORIGIN block");
  const body = text.slice(at + 7);
  const end = body.indexOf("\n//");
  return (end < 0 ? body : body.slice(0, end)).replace(/[^A-Za-z]/g, "").toUpperCase();
}

/**
 * The record's feature table: type, location as written, and its qualifiers. Only what we
 * select on, so values are kept as single strings.
 */
function genbankFeatures(text) {
  const from = text.indexOf("\nFEATURES");
  const to = text.indexOf("\nORIGIN");
  if (from < 0 || to < 0) throw new Error("no FEATURES block");
  const features = [];
  let current = null;
  let qualifier = null;
  for (const line of text.slice(from + 1, to).split("\n").slice(1)) {
    const start = /^ {5}(\S+)\s+(.*)$/.exec(line);
    if (start) {
      current = { type: start[1], location: start[2].trim(), qualifiers: {} };
      features.push(current);
      qualifier = null;
      continue;
    }
    if (!current) continue;
    const continued = /^ {21}(.*)$/.exec(line);
    if (!continued) continue;
    const rest = continued[1];
    if (rest.startsWith("/")) {
      const q = /^\/([^=]+)(?:=(.*))?$/.exec(rest);
      if (!q) continue;
      qualifier = q[1];
      current.qualifiers[qualifier] = (q[2] ?? "").replace(/^"|"$/g, "");
    } else if (qualifier) {
      current.qualifiers[qualifier] += ` ${rest.replace(/"$/, "")}`;
    } else {
      // A location long enough to wrap.
      current.location += rest.trim();
    }
  }
  return features;
}

/**
 * The record's own primary reference: the first one carrying a PUBMED id. An `ncbi` row
 * takes its citation from here rather than from a hand-typed PMID, so the paper and the
 * bases come out of the same record and can't drift apart.
 */
function genbankReference(text) {
  const from = text.indexOf("\nREFERENCE");
  if (from < 0) return null;
  const to = text.indexOf("\nFEATURES");
  const block = text.slice(from + 1, to < 0 ? undefined : to);
  for (const part of block.split(/\nREFERENCE/)) {
    const fields = {};
    let current = null;
    for (const line of part.split("\n")) {
      const start = /^ {2,3}([A-Z]+) {2,}(.*)$/.exec(line);
      if (start) {
        current = start[1];
        fields[current] = start[2].trim();
      } else if (current && /^ {10,}\S/.test(line)) {
        fields[current] += ` ${line.trim()}`;
      }
    }
    if (!fields.PUBMED) continue;
    const surname = (fields.AUTHORS ?? "").split(",")[0].trim();
    const year = /\((\d{4})\)/.exec(fields.JOURNAL ?? "")?.[1] ?? "";
    const journal = (fields.JOURNAL ?? "").replace(/\s+\d.*$/, "").trim();
    return {
      reference: `PMID ${fields.PUBMED.trim()}`,
      citation: [surname, year, journal].filter(Boolean).join(" ")
    };
  }
  return null;
}

/** Bases of a GenBank location. Only the simple forms the catalog uses. */
function basesAt(sequence, location) {
  const complement = /^complement\((.*)\)$/.exec(location.replace(/\s+/g, ""));
  const plain = (complement ? complement[1] : location).replace(/\s+/g, "");
  if (/^(join|order)\(/.test(plain)) throw new Error(`location ${location} is in parts; give explicit coordinates instead`);
  const range = /^<?(\d+)(?:\.\.>?(\d+))?$/.exec(plain);
  if (!range) throw new Error(`can't read location ${location}`);
  const start = Number(range[1]);
  const end = range[2] ? Number(range[2]) : start;
  if (end < start || end > sequence.length) throw new Error(`location ${location} is outside the record`);
  const bases = sequence.slice(start - 1, end);
  return { bases: complement ? reverseComplement(bases) : bases, start, end, strand: complement ? -1 : 1 };
}

const COMPLEMENT = { A: "T", T: "A", G: "C", C: "G", N: "N" };
const reverseComplement = s => [...s].reverse().map(c => COMPLEMENT[c] ?? "N").join("");

// ---------- translation, to check the tags ----------

const CODONS = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M", GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  TGT: "C", TGC: "C", TGA: "*", TGG: "W", CGT: "R", CGC: "R", CGA: "R", CGG: "R",
  AGT: "S", AGC: "S", AGA: "R", AGG: "R", GGT: "G", GGC: "G", GGA: "G", GGG: "G"
};

function translate(bases) {
  let out = "";
  for (let i = 0; i + 2 < bases.length; i += 3) out += CODONS[bases.slice(i, i + 3)] ?? "X";
  return out;
}

// ---------- the sources ----------

async function fromNcbi(spec, row) {
  const [, acc, selector] = /^([^:]+):(.+)$/.exec(spec) ?? [];
  if (!acc) throw new Error(`can't read source ${row.from}`);
  const text = await record(acc);
  const version = /^VERSION\s+(\S+)/m.exec(text)?.[1] ?? acc;
  const sequence = genbankSequence(text);

  const byGene = /^gene=(.+)$/.exec(selector);
  const byType = /^([A-Za-z_]+)@(.+)$/.exec(selector);
  let found;
  if (byGene) {
    const features = genbankFeatures(text).filter(f => f.qualifiers.gene === byGene[1]);
    const feature = features.find(f => f.type === "CDS") ?? features[0];
    if (!feature) throw new Error(`${acc} has no feature with /gene="${byGene[1]}"`);
    found = basesAt(sequence, feature.location);
  } else if (byType) {
    const wanted = byType[2].replace(/\s+/g, "");
    const feature = genbankFeatures(text).find(f => f.type === byType[1] && f.location.replace(/\s+/g, "") === wanted);
    // Asserting the location means a re-run notices if the record is revised.
    if (!feature) throw new Error(`${acc} has no ${byType[1]} at ${byType[2]} any more — check the record`);
    found = basesAt(sequence, feature.location);
  } else {
    found = basesAt(sequence, selector);
  }
  const where = found.strand === -1 ? `${version}:${found.start}-${found.end}(-)` : `${version}:${found.start}-${found.end}`;
  return { bases: found.bases, source: "ncbi", accession: where, ...(genbankReference(text) ?? {}) };
}

/** A reviewed protein from Swiss-Prot, with the entry's own primary reference. */
async function fromUniProt(accession) {
  const text = await cached(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(accession)}.json`, `uniprot-${accession}.json`);
  const entry = JSON.parse(text);
  const residues = (entry.sequence?.value ?? "").toUpperCase();
  if (!residues) throw new Error(`UniProt has no sequence for ${accession}`);
  // The entry's first cited paper is the one that described the sequence.
  const pubmed = c => (c?.citationCrossReferences ?? []).find(x => x.database === "PubMed")?.id;
  const cited = (entry.references ?? []).map(r => r.citation).find(c => pubmed(c));
  return {
    bases: residues,
    source: "uniprot",
    accession,
    reference: cited ? `PMID ${pubmed(cited)}` : "",
    citation: [(cited?.authors?.[0] ?? "").split(" ")[0], (cited?.publicationDate ?? "").slice(0, 4), cited?.journal]
      .filter(Boolean)
      .join(" ")
  };
}

/** A fluorescent protein from FPbase, which holds amino acids and no DNA. */
async function fromFpbase(name) {
  const text = await cached(`https://www.fpbase.org/api/proteins/?name__iexact=${encodeURIComponent(name)}&format=json`, `fpbase-${name}.json`);
  const rows = JSON.parse(text);
  if (!rows.length) throw new Error(`FPbase has no protein called ${name}`);
  const row = rows[0];
  if (!row.seq) throw new Error(`FPbase gives no sequence for ${name}`);
  // FPbase asks that the original authors be credited; its `doi` is that paper.
  return {
    bases: String(row.seq).toUpperCase(),
    source: "fpbase",
    accession: `fpbase:${row.slug}`,
    reference: row.doi ? `DOI ${row.doi}` : ""
  };
}

let amrCds = null;
async function fromAmrFinder(symbol) {
  amrCds ??= await cached(AMR_CDS, "AMR_CDS.fa");
  const entries = [];
  let header = null;
  let bases = [];
  const push = () => header && entries.push({ header, bases: bases.join("") });
  for (const line of amrCds.split("\n")) {
    if (line.startsWith(">")) {
      push();
      header = line.slice(1);
      bases = [];
    } else if (header) bases.push(line.trim());
  }
  push();
  const hit = entries.find(e => {
    const fields = e.header.split("|");
    return fields[4] === symbol || fields[5] === symbol;
  });
  if (!hit) throw new Error(`AMR_CDS.fa has no gene ${symbol}`);
  const fields = hit.header.split("|");
  const region = /(\S+:\d+-\d+)\s*$/.exec(fields[6] ?? "")?.[1] ?? fields[1];
  return { bases: hit.bases.toUpperCase(), source: "amrfinder", accession: region };
}

// ---------- checking the citations ----------

/** First author, year and journal of a `PMID n` or `DOI x`, or null if it won't resolve. */
async function lookup(reference) {
  const pmid = /^PMID\s+(\d+)$/.exec(reference)?.[1];
  if (pmid) {
    const text = await cached(`${ESUMMARY}?db=pubmed&retmode=json&id=${pmid}&tool=strandivo-build-catalog`, `pubmed-${pmid}.json`);
    const r = JSON.parse(text).result?.[pmid];
    if (!r || r.error) return null;
    return {
      surname: (r.authors?.[0]?.name ?? "").split(" ")[0],
      year: (r.pubdate ?? "").slice(0, 4),
      journal: r.source ?? ""
    };
  }
  const doi = /^DOI\s+(\S+)$/.exec(reference)?.[1];
  if (doi) {
    const text = await cached(`${CROSSREF}/${encodeURIComponent(doi)}`, `doi-${doi.replace(/[^\w.-]/g, "_")}.json`);
    const m = JSON.parse(text).message;
    if (!m) return null;
    return {
      surname: m.author?.[0]?.family ?? "",
      year: String(m.issued?.["date-parts"]?.[0]?.[0] ?? ""),
      journal: m["container-title"]?.[0] ?? ""
    };
  }
  return null;
}

/**
 * Checks a hand-curated citation against the paper its PMID or DOI actually names.
 *
 * This is the guard the catalog most needs: bases fetched from a record are right by
 * construction, but a `literal` row's provenance is only as good as its citation, and a
 * reference that points at an unrelated paper looks exactly like one that doesn't. The
 * author and the year have to agree with what the id resolves to.
 */
async function verifyCitation(reference, citation) {
  const found = await lookup(reference);
  if (!found) throw new Error(`${reference} doesn't resolve; a reference must be a real PMID or DOI`);
  const said = citation.toLowerCase();
  const names = `${found.surname} ${found.year} ${found.journal}`.trim();
  if (found.surname && !said.includes(found.surname.toLowerCase())) {
    throw new Error(`${reference} is ${names}, which doesn't match the citation "${citation}"`);
  }
  if (found.year && !said.includes(found.year)) {
    throw new Error(`${reference} is from ${found.year} (${names}), but the citation says "${citation}"`);
  }
}

// ---------- build ----------

async function build() {
  const rows = readManifest().filter(r => !only || only.includes(r.id));
  const built = [];
  const problems = [];

  for (const row of rows) {
    try {
      if (!row.id || !row.name || !row.type) throw new Error("id, name and type are all needed");
      let got;
      if (row.from === "literal") {
        if (!row.sequence) throw new Error("a literal row needs a sequence");
        if (!row.reference) throw new Error("a literal row needs a reference");
        got = { bases: row.sequence.toUpperCase(), source: "literal", accession: "-" };
      } else if (row.from.startsWith("ncbi:")) {
        got = await fromNcbi(row.from.slice(5), row);
      } else if (row.from.startsWith("defined:")) {
        if (!row.reference) throw new Error("a defined extent needs the citation that justifies it");
        got = { ...(await fromNcbi(row.from.slice(8), row)), source: "defined" };
      } else if (row.from.startsWith("uniprot:")) {
        got = await fromUniProt(row.from.slice(8));
      } else if (row.from.startsWith("fpbase:")) {
        got = await fromFpbase(row.from.slice(7));
      } else if (row.from.startsWith("amrfinder:")) {
        got = await fromAmrFinder(row.from.slice(10));
      } else {
        throw new Error(`unknown source ${row.from}`);
      }

      const molecule = row.molecule || "dna";
      if (molecule !== "dna" && molecule !== "protein") throw new Error(`molecule must be dna or protein, not ${molecule}`);
      if (molecule === "dna") {
        if (!/^[ACGT]+$/.test(got.bases)) throw new Error("bases are not plain ACGT");
        if (got.bases.length < MIN_BASES) throw new Error(`only ${got.bases.length} bases; the floor is ${MIN_BASES}`);
        if (row.protein) {
          // A tag typed in by hand: check it really gives the peptide it claims to.
          const seen = translate(got.bases).replace(/\*$/, "");
          if (seen !== row.protein) throw new Error(`translates to ${seen}, not ${row.protein}`);
        }
      } else {
        if (!RESIDUES.test(got.bases)) throw new Error("not plain one-letter amino acids");
        if (got.bases.length < MIN_RESIDUES) throw new Error(`only ${got.bases.length} residues; the floor is ${MIN_RESIDUES}`);
      }
      // Where the reference comes from decides whether it needs checking. One the source
      // carries itself — a record's own paper, a UniProt entry's, FPbase's DOI — is right
      // by construction. A hand-typed one is looked up, and must name the paper it claims.
      const reference = row.reference || got.reference || "";
      if (!reference) throw new Error("no reference, and the source gives none");
      let citation = row.citation || "";
      if (row.reference) {
        if (!citation) throw new Error("a hand-curated reference needs a citation to check it against");
        await verifyCitation(reference, citation);
      } else if (!citation) {
        // Fill in who to credit, which is what FPbase asks of us.
        const found = await lookup(reference).catch(() => null);
        citation = found ? [found.surname, found.year, found.journal].filter(Boolean).join(" ") : "";
      }
      built.push({ ...row, ...got, reference, citation, molecule, licence: LICENCE[got.source] });
      process.stderr.write(`  ${row.id.padEnd(16)} ${String(got.bases.length).padStart(5)} ${molecule === "dna" ? "bp" : "aa"}  ${got.accession}\n`);
    } catch (e) {
      problems.push(`${row.id}: ${e.message}`);
      process.stderr.write(`  ${row.id.padEnd(16)}   FAILED  ${e.message}\n`);
    }
  }

  const seen = new Map();
  for (const p of built) {
    if (seen.has(p.bases)) problems.push(`${p.id}: the same bases as ${seen.get(p.bases)}`);
    seen.set(p.bases, p.id);
  }
  const ids = built.map(p => p.id);
  for (const id of ids) if (ids.indexOf(id) !== ids.lastIndexOf(id)) problems.push(`${id}: used twice`);

  if (problems.length) {
    process.stderr.write(`\n${problems.length} problem(s):\n${problems.map(p => `  ${p}`).join("\n")}\n`);
    process.exit(1);
  }

  built.sort((a, b) => a.id.localeCompare(b.id));
  const header = [
    "# The parts catalog: generated by tools/build-catalog.mjs from tools/catalog-sources.tsv.",
    "# Do not edit by hand. Sources, their terms and what each asks for: docs/feature-catalog.md.",
    "#",
    "# Resistance genes come from the NCBI AMRFinderPlus reference gene catalog, a United",
    "# States Government Work. Please cite Feldgarden et al. 2019 (PMID 31427293).",
    "# Other entries come from GenBank records, on which NCBI places no distribution",
    "# restrictions, or are published sequences cited in the `reference` column.",
    "#",
    "# Every `reference` is a PMID or DOI that resolves. Where a row's reference is typed",
    "# by hand rather than taken from the source, tools/catalog-sources.tsv also records",
    "# the paper's author, year and journal, and the generator refuses to build unless the",
    "# id resolves to that paper.",
    "#",
    "# A `defined` source means the bases are a record's, but the extent is ours: the",
    "# primary records mark a replication origin as a single base, so the region a map",
    "# shows has to be defined, and the `reference` column says on what basis.",
    "#",
    "# Protein entries come from UniProtKB/Swiss-Prot and FPbase.",
    "# UniProt: We have chosen to apply the Creative Commons Attribution 4.0 International",
    "# (CC BY 4.0) License (https://creativecommons.org/licenses/by/4.0/) to all",
    "# copyrightable parts of our databases. All databases and documents in the UniProt FTP",
    "# directory may be copied and redistributed freely, without advance permission,",
    "# provided that this copyright statement is reproduced with each copy.",
    "# FPbase data are free of copyright restrictions; the original authors of each protein",
    "# are credited by the paper in the `reference` column.",
    "#",
    `# ${built.length} entries, built ${new Date().toISOString().slice(0, 10)}.`,
    "id\tname\ttype\tmolecule\tsequence\tsource\taccession\tlicence\treference\tnote"
  ];
  const lines = built.map(p => [p.id, p.name, p.type, p.molecule, p.bases, p.source, p.accession, p.licence, p.reference, p.note].join("\t"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${[...header, ...lines].join("\n")}\n`);
  process.stderr.write(`\nWrote ${built.length} entries to ${out}\n`);
}

await build();
