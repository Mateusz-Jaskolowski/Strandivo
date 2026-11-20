# Enzyme data: plan

Status: phase 1 done (16 November 2026), the Enzyme details dialog of phase 4 with what
REBASE gives, and Dam and Dcm methylation warnings (November 2026); phases 2 and 3 and
the rest of 4 to come.

## What we want

Details on each restriction enzyme, searchable and a double-click away: who sells it and
in which forms (HF, FastDigest), its buffers and its activity in each, incubation and heat
inactivation, and whether Dam, Dcm or CpG methylation blocks it.

## Phases

1. **REBASE import** (done). `tools/build-enzymes.mjs` writes `src/lib/rebaseEnzymes.ts`
   from REBASE's `withrefm` file: every enzyme REBASE lists as sold by at least one
   company (588 in version 611, October 2026), its cut as REBASE writes it and its
   suppliers' codes. It replaced TeselaGen's list of 3,700 names, most of them sold by
   nobody and about 2,300 given a cut of 1/1 that REBASE doesn't know. That list lacked
   25 enzymes on sale (PaqCI, I-SceI) and had MluCI's cut and TaqII's site wrong, and
   it found TspRI's and TscAI's sites twice each, with too short an overhang. TeselaGen's
   site search is still used.
2. **Suppliers' permission.** Mateusz asks NEB, Thermo Fisher and other suppliers for
   permission to use their product data, or for a machine-readable export of it.
3. **Products.** A curated list of products: HF and other versions, catalogue numbers,
   buffers and activity in each, incubation and heat inactivation. It starts with a small
   sample entered by hand; bulk supplier data goes in only with permission.
4. **Features.** An enzyme details dialog (started: `src/views/enzymeDialog.ts` shows the
   cut on both strands, suppliers, isoschizomers and neoschizomers, the enzyme's sites
   and fragments in the open sequence, what methylation does to it and the lab's stock of
   it; products and buffers join it with phase 3), a buffer for a double digest, and
   warnings on sites that Dam or Dcm methylation blocks (done, see Methylation below).

## Sources and their terms

| Source | Gives | Terms | How we keep to them |
|--------|-------|-------|---------------------|
| [REBASE](http://rebase.neb.com) | Names, sites and cuts, who sells each enzyme, what Dam, Dcm and CpG methylation do to each | "An open database… Adaptation or distribution of information from REBASE should also remain open and accessible to the public" (its home page) | Strandivo is GPL. The generated file's header cites Roberts et al. (2023), and `tools/build-enzymes.test.mjs` fails if it is removed. `README.md` credits it |
| Suppliers' product pages and charts (NEB's performance chart, Thermo's FastDigest tables, Promega's methylation chart) | Versions, buffers, activity, heat inactivation (and methylation sensitivity, which REBASE gives openly) | Copyrighted; in the UK and EU the database right also protects such compilations | Not copied in bulk without permission (phase 2) |

What REBASE doesn't give: product versions, buffers, activity and heat inactivation. This
section used to say methylation sensitivity had to come from suppliers too, as the
`withrefm` file's methylation field is only where the enzyme's own methylase modifies its
site. That was wrong: REBASE's methylation sensitivity pages give it for every enzyme on
sale, under the same open terms ([REBASE's terms](http://rebase.neb.com/rebase/rebase.html)).
See Methylation below.

## Decisions

- **Only enzymes someone sells.** My enzymes and Lab stock offer what a lab can buy, not
  thousands of isoschizomers known from one paper. A saved list keeps any other name it
  holds, off the map, as it does for names a newer version knows.
- **Left out**: sites less specific than a three-base site, as MspJI's CNNR and SgeI's
  CNNG(9/13)-like site. These enzymes cut only methylated DNA, and on a plasmid map their
  sites would fall every few bases. The generator lists what it leaves out, and refuses
  a site it can't read rather than guess.
- **Cuts on both sides** (BcgI's (10/12)CGANNNNNNTGC(12/10)): the map labels the recognition
  site once. Digests use both sets of cut coordinates from REBASE.
- **A ^ at the cut, with Ns out to a cut past the site**, as it reads at a glance where
  REBASE's numbers have to be worked out: AciI is C^CGC (REBASE's CCGC(-3/-1)), BsaI
  GGTCTCN^NNNN (GGTCTC(1/5)), so the Ns after the ^ of a 5′ overhang are the overhang.
  Past five, Ns are counted as NEB writes them: FokI is GGATG(N)9^NNNN, MmeI
  TCCRAC(N)20^. A ^ marks only the top strand's cut; the ends beside it give the rest.
  Enzymes that cut both sides of their site keep REBASE's notation, as Ns on both sides
  would bury the site. The generated file keeps REBASE's own, and lists show it on hover.
- **Plain HTTP**: REBASE's HTTPS certificate doesn't verify in Node (an incomplete
  chain), so the generator downloads over HTTP. Check the regenerated file's diff before
  committing it.
- **A double-click opens a thing's dialog** (changed with phase 1, as phase 4 needs it):
  on the map or in the Sequence tab, a double-click on a CDS, one of its regions or an ORF
  opens Protein details, and on a cut site Enzyme details. Bases, and a CDS's amino acids, which are clicked to pick codons, keep what two
  clicks do. The rule used to be that dialogs never open on a double-click, from a worry
  about windows popping up unasked; a double-click on the thing itself is asking.

## Methylation

`tools/rebase-methylation.mjs` reads REBASE's methylation sensitivity pages for the
generator, which writes what they say into `src/lib/rebaseEnzymes.ts`:

- `damlist?m<methylase>+s<company>` (such as
  http://rebase.neb.com/cgi-bin/damlist?mM.EcoKDam+sN): for one company's enzymes, each
  way Dam's, Dcm's or CpG's site can overlap an enzyme's, drawn with the methylated bases
  marked, and what the reports say: cut, impaired or blocked, each with its ms# and
  reference. One page per company and methylase, merged. Overlaps REBASE marks "not
  tested" are left out.
- `msget?<enzyme>`: every report on modified bases for one enzyme. A few enzymes with
  reports are missing from the damlist pages (BclI and DpnII, November 2026); for those,
  the reports whose marks Dam or Dcm could make on dsDNA are taken from here (single-strand
  hemi-methylated tests whose other-strand partner lies inside the site are skipped, since
  E. coli Dam and Dcm methylate both strands).
- `laplist?s<company>` (http://rebase.neb.com/cgi-bin/laplist?sN) sums up coverage: "N/A
  = no overlap exists, + = all results documented, - = untested cases remain". The
  generator doesn't read it. It was used to check that `canOverlap` agrees with REBASE on
  which methylations can reach each of NEB's 219 enzymes (all agreed, 19 November 2026).
  A "+" means each overlap REBASE knows has a report, not that every flanking sequence was
  tested, so the app claims no more than the reports do.

How a site is predicted (`siteMethylation` in `src/lib/methylation.ts`):

- E. coli methylates the A of every GATC (Dam) and the second C of every CCWGG (Dcm), on
  both strands. The bases around a site decide which of its bases are methylated, and so
  which of REBASE's entries apply: of two XbaI sites, only one may run on into a GATC. A
  site at the origin of a circular sequence is read across it.
- Entries with exactly the site's methylated bases decide. Otherwise, if every report on
  fewer of them says blocked, it is blocked; if every report on more says cut, it cuts;
  anything else is untested.
- **Only a site every matching report calls blocked, on DNA known or assumed to be
  methylated, is predicted not to cut.** Impaired (cuts slowly), disagreeing and untested
  sites still count as cuts, with a note saying which: none of them justifies a definite
  "won't cut". Notes keep REBASE's categories apart.
- DpnI cuts only Dam-methylated DNA. REBASE calls it a "Type II Methyl-directed
  restriction enzyme (recognizes the sequence only when methylated)", which the generator
  enters by hand (`METHYL_DIRECTED`). It is never said to be blocked by methylation; on
  DNA without Dam methylation it won't cut.
- CpG methylation, which E. coli doesn't make, is shown only in the Enzyme details dialog.

Where the DNA comes from:

- The Info tab's Host / strain field, saved in the file, names the strain. It suggests
  common strains (`src/lib/strains.ts`), matched whatever the case or spacing, and other
  text still works. A blank field is assumed dam⁺ dcm⁺, as most cloning strains are, and
  notes say "assumed". A strain Strandivo doesn't know is unknown: notes say what would
  happen if the DNA is methylated, and nothing is predicted.
- A PCR product is unmethylated whatever its template was grown in. The PCR product
  dialog draws and digests it that way (DpnI cuts none of it), while its template's lanes
  follow the template file's strain.

Decisions (17–19 November 2026):

- **From REBASE, not suppliers.** It needs no permission (NEB, Thermo Fisher and Promega
  were asked in November 2026; none had agreed), and REBASE's terms are already kept.
- **A small superscript "m" after a blocked site's name**, in the label's own grey, with
  its tick dashed (and on outline chips). Left as it was, XbaI or ClaI can look like a clean unique cutter and
  then fail at the bench; left out, a site the user knows is there vanishes; struck
  through, it reads as removed and is hard to read at small sizes; faded, it looks like
  the grey that means "cuts more than once"; a coloured tag or symbol pulls more attention
  than the problem deserves. The m is how methylation is written (m6A, m5C). Only the few
  blocked sites get it, which is why AGENTS.md's rule against marks on enzymes allows it.
- **Filters count predicted cuts.** An enzyme with two sites, one blocked, is a unique
  cutter, and both sites are drawn. One that cuts nowhere passes a filter only if its
  sites alone would, so filters for useful enzymes don't fill with blocked four-cutters.
- **The strain decides methylation only, not amber suppression.** DH5α, XL1-Blue, JM109
  and TG1 are supE44 amber suppressors: anyone typing DH5α, which is most people, would
  have every translation, ORF and read difference read TAG as glutamine, which is wrong
  for ordinary cloning. The two answer different questions: methylation is about where
  the DNA was grown, amber suppression about where the protein is made (clone in DH5α,
  express in BL21(DE3)). A suppressor strain is mentioned beside the field, with a link to
  the setting.
- **The Digest and Simulate cloning dialogs ask only when a chosen enzyme is blocked** (or
  would be, for a strain it doesn't know). Each offers the strain and writes it to the
  named open file's field (or keeps it for that simulation when a cloning insert was
  picked from disk), redrawing every lane or fragment of that file. A question on every
  reaction gets clicked past. A search by name in Digest (and every enzyme with a site in
  Simulate cloning) still lists an enzyme that cuts nowhere, as "1 site · 0 predicted
  cuts", so the reason can be read.

Later: cloning products made from DNA of different origins; amber suppression per file
(`useAmberSuppression` is window-wide, and caches of codons key on it); a separate
expression-strain field, if one field proves too blunt; double-digest buffers, which need
supplier data.

## Rebuilding

`node tools/build-enzymes.mjs` downloads REBASE's current file, or reads one given with
`--file`, then about a hundred methylation pages; `--pages <folder>` keeps them there and
reads them from there next time. REBASE comes out monthly; there is no need to follow it,
but rebuild now and then before a release. An enzyme that disappears from the list stays in saved lists, off
the map.
