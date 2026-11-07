# Protein regions and UniProt: guide for coding agents

Read this before changing a CDS's regions (transmembrane helices, domains, signal
peptides) or how they are fetched from UniProt (`src/lib/regions.ts`,
`src/lib/uniprot.ts`).

**Keep this guide true** (and `AGENTS.md`'s rules apply here too): a change that makes
something here wrong updates it in the same commit. Paths are from the repository's root,
and CI checks that they exist.

## Conventions

- **Regions of a protein** (`src/lib/regions.ts`): transmembrane helices, topological domains
  and signal peptides stay inside their CDS, in its `/strandivo_regions` qualifier, instead
  of being features: a membrane protein should stay one feature. So they are
  not `locations`, which say what the feature is made of and would be all that gets
  translated. They are numbered in residues of the CDS, so rotating, turning round and
  cloning need no code; only what changes the CDS's length or first base does (`carryRegions`):
  edits (from `mapAnnotations`), moving an end or turning it round in the inspector, and a
  fragment that opens a circle inside it (`unwrap` in `src/lib/cloning.ts`). Ends round to the nearest
  codon, not down: replacing a base is a deletion and an insertion, and rounding down would
  creep everything downstream a residue per base typed over. A replacement across a region's
  edge can still move that edge, as it clips a feature's own end. Each also keeps the
  entry's numbers, which is what the interface shows, as a fusion's differ. "Add as feature"
  makes a real one for files going to other software.
- **UniProt** (`src/lib/uniprot.ts`) is one of the two things the page fetches from the
  internet, and only when asked to (`fetchUniprotEntry` in `src/platform.ts`, the page's
  own `fetch`; the API allows any origin); the other is a feedback report the user sends
  (`docs/agents/updates-and-reports.md`). `connect-src` in the Content Security Policy names both, so the page can reach
  nothing else. The update check is the shell's, not the page's. A construct's protein is rarely the entry's (both mRNAs Q9UKG4
  cites differ from it, one in length), so residues are never taken at face value: the
  CDS's translation is aligned locally with gaps, and regions are carried across. Under
  `MIN_IDENTITY` nothing is placed, since a wrong accession would otherwise mark the wrong
  bases. The entry goes in `/db_xref` as `UniProtKB/Swiss-Prot:…`, as ENA's records have it,
  so those files fill the field in themselves.
