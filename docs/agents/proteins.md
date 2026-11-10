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
- **Manual regions** use the same storage as imported ones. Optional URL-encoded JSON
  after the original qualifier fields holds stable ids, colour, a parent id and a library
  design; keep reading the original four/five-field form. Parent links describe nesting,
  never reading order or splicing. The region dialog requires a parent to contain its
  children; overlapping annotations can also be independent. Removing a parent promotes
  its children. Plain manual regions show the CDS's own residue numbers.
  Kind is descriptive, except signal/transit peptides keep their GenBank types on export;
  it never changes translation or marks a region as varying. Its native dropdown offers
  common categories and a custom value; preserve kinds imported from older files.
  Region names and custom kinds turn off spelling correction and capitalisation.
- **New region colours** follow a coordinated palette within each CDS, starting with the
  colour nearest its displayed feature colour (`nextRegionColor`). Assign and save the
  colour when a region is added, including a UniProt batch; editing or renaming must not
  pick a new one. Skip colours already in use before repeating the palette. Reimporting
  keeps existing colours, and old annotations without a saved colour keep their original
  name-based fallback (`regionColor`), so opening a file never recolours it.
- **Protein display**: the inspector's diagram and the outline show all regions; the map's
  Regions toggle hides or shows them without changing its top-level/all detail choice.
  Visibility and detail are remembered separately. Nested
  or overlapping regions occupy separate lanes. Region actions act on the region, not the
  whole CDS. The editor is in `src/views/proteinRegionDialog.ts`.
  The detail choice follows enzymes in the map controls and only appears when regions
  are visible and a valid parent link makes top-level/all show different annotations.
  Independent overlaps alone do not need that choice. In the outline, all feature rows
  share a disclosure gutter while any listed feature has regions, so names stay aligned.
  Sequence and the Primers tab's local sequence panel share a Regions toggle: solid bars
  and captions sit below their CDS, in separate tracks for overlaps, whether or not
  translation is shown. They use `src/views/regionTracks.ts` to pack and draw both the
  bars and captions, so names do not collide or widen the scroller. The primer's panel
  shows all regions in its visible template window, including neighbouring boundaries.
- **Regions from a selection** use `selectedProteinResidues` for both the inspector and
  right-click menu: coordinates follow the CDS's direction and splicing, partial codons
  expand to whole residues, and a terminal stop is excluded. When several CDSs contain
  the selection, ask which protein owns the region rather than silently choosing one.
  Right-clicking a drawn feature within a plain selection keeps that selection.
- **Library designs on regions** are optional and separate from their kind: a CDR or a
  variable domain does not automatically vary between clones. `variableProteinFeatures`
  projects only marked regions into the existing read-analysis model, as noncoding
  features inside the real CDS, so its frame and translation are counted once. It never
  adds document features. Ordinary feature-based library designs continue to work.
- **Portable export**: normal Save keeps regions attached. The Export dialog can include
  them as ordinary annotations in a GenBank copy (`proteinRegionFeatures`); this leaves
  the open document alone. Importing that copy also imports those ordinary annotations.
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
  Domains, repeats, motifs and other bounded regions are offered too. Locally edited
  imported regions keep their source key and survive another import of that entry.
