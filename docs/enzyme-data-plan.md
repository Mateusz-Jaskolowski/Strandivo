# Enzyme data: plan

Status: phase 1 done (16 November 2026), and the Enzyme details dialog of phase 4 with
what REBASE gives; phases 2 and 3 and the rest of 4 to come.

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
   buffers and activity in each, incubation and heat inactivation, methylation
   sensitivity. It starts with a small sample entered by hand; bulk supplier data goes in
   only with permission.
4. **Features.** An enzyme details dialog (started: `src/views/enzymeDialog.ts` shows the
   cut on both strands, suppliers, isoschizomers and neoschizomers, the enzyme's sites
   and fragments in the open sequence and the lab's stock of it; products, buffers and
   methylation join it with phase 3), a buffer for a double digest, and warnings on
   sites that Dam or Dcm methylation blocks.

## Sources and their terms

| Source | Gives | Terms | How we keep to them |
|--------|-------|-------|---------------------|
| [REBASE](http://rebase.neb.com) | Names, sites and cuts, who sells each enzyme | "An open database… Adaptation or distribution of information from REBASE should also remain open and accessible to the public" (its home page) | Strandivo is GPL. The generated file's header cites Roberts et al. (2023), and `tools/build-enzymes.test.mjs` fails if it is removed. `README.md` credits it |
| Suppliers' product pages and charts (NEB's performance chart, Thermo's FastDigest tables, Promega's methylation chart) | Versions, buffers, activity, heat inactivation, methylation sensitivity | Copyrighted; in the UK and EU the database right also protects such compilations | Not copied in bulk without permission (phase 2) |

What REBASE doesn't give: its methylation field is where the enzyme's own methylase
modifies the site, not whether Dam or Dcm blocks the enzyme, and its sensitivity data is
per-enzyme literature, not a file. So methylation sensitivity comes with the products.

## Decisions

- **Only enzymes someone sells.** My enzymes and Lab stock offer what a lab can buy, not
  thousands of isoschizomers known from one paper. A saved list keeps any other name it
  holds, off the map, as it does for names a newer version knows.
- **Left out**: sites less specific than a three-base site, as MspJI's CNNR and SgeI's
  CNNG(9/13)-like site. These enzymes cut only methylated DNA, and on a plasmid map their
  sites would fall every few bases. The generator lists what it leaves out, and refuses
  a site it can't read rather than guess.
- **Cuts on both sides** (BcgI's (10/12)CGANNNNNNTGC(12/10)): only the cut after the site
  is searched for, as before; lists say "Cuts both sides".
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

## Rebuilding

`node tools/build-enzymes.mjs` downloads REBASE's current file, or reads one given with
`--file`. REBASE comes out monthly; there is no need to follow it, but rebuild now and
then before a release. An enzyme that disappears from the list stays in saved lists, off
the map.
