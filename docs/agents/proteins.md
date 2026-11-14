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
  after the original qualifier fields holds stable ids, colour, a parent id, a library
  design and the user's note (lines joined by line breaks); keep reading the original
  four/five-field form. Keys this version doesn't know are kept in `more` and written
  back, so a field added later survives this version rewriting the CDS's regions. Versions
  up to 0.4.0 keep only what they know: they drop every note on a CDS when they rewrite
  its regions (an edit that changes its coding length or first base, adding, editing or
  removing a region, a UniProt import), though opening and saving keep them. Parent links describe nesting,
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
  Both map modes draw a region as a stripe in its colour along its CDS's outer edge (the
  linear map's bar's bottom edge), inside the band and cut to its shape, so the CDS keeps
  its colour and its name in the rest of the band. Filling the arrow with segments was
  tried and hid both; a tint where no region was made the CDS seem to change colour as
  regions were shown or hidden; brackets just outside the CDS sat where cut sites' ticks
  and primers are drawn, and on a busy map were covered by them. The first lane is a
  4 px stripe at the edge and each further lane (nesting, overlaps) a 2 px one inside it;
  the name stays inside while it fits what is left (`fitsAcross`), so with nesting it can
  move outside at a large label size, and under its bar on the linear map. A stripe is a
  group of the stripe drawn and a wider clear stroke the pointer finds. Region names are
  plain grey at regular weight after a square of the region's colour: beside the circular
  map on a light solid leader from the stripe, or in rows under the linear map's lane,
  packed across the CDSs in it so neighbours' names never collide. Hovering a stripe or
  name highlights every piece of that region and outlines its owning CDS, including for a
  nested region. This is local map state, cleared on redraw or hiding the view, never a
  store selection. Selection styling wins, and label weight stays fixed in every state
  to match its measured width. Map tooltips name the owning CDS as well as region details.
  The detail choice follows enzymes in the map controls and only appears when regions
  are visible and a valid parent link makes top-level/all show different annotations.
  Independent overlaps alone do not need that choice. In the outline, all feature rows
  share a disclosure gutter while any listed feature has regions, so names stay aligned.
  Sequence and the Primers tab's local sequence panel share a Regions toggle: solid bars
  and captions sit below their CDS, in separate tracks for overlaps, whether or not
  translation is shown. They use `src/views/regionTracks.ts` to pack and draw both the
  bars and captions, so names do not collide or widen the scroller. The primer's panel
  shows all regions in its visible template window, including neighbouring boundaries.
- **The protein figure** (in Protein details, `src/views/proteinDialog.ts`, opened by
  Details… in the inspector's Protein section) is laid out once, as shapes with
  concrete colours (`src/lib/proteinFigure.ts`), which `src/views/proteinFigure.ts` draws
  as SVG in the dialog, paints on a canvas for the PNG and writes as the SVG file, so all
  three match. Painting from the shapes, not loading the SVG as an image, keeps `data:`
  and `blob:` images out of the Content Security Policy, and lets Copy image make the PNG
  within the click, which Safari's clipboard requires. Regions with drawn parts are
  brackets under them; the rest are blocks, the longest on the protein's line and one
  inside another in a lane under it. A name goes straight over its block where it can
  without hiding a neighbour's leader, else on an elbow leader, a crowd of them rising to
  a peak (left half pointing left) so no leader crosses a name; a randomised test holds
  that no name overlaps a name, a block or a line. The PNG is three times the figure's
  size and says so (`pngWithDpi`), so a slide places it at the size it was drawn. The
  shell writes its bytes with `write_bytes`, which takes them as the request's body
  rather than JSON, with the path in a header.
- **Protein details** keeps the sequence in sight: the list of regions under the figure
  starts folded (the figure shows and picks them all). Edit region… there gives the
  dialog's place to the region editor, which brings Protein details back when it closes,
  saved or not (`onClose` of `openProteinRegionDialog`); opened from the inspector, the
  editor closes to the window. Stacking the editor over it was the alternative, but it
  would darken the window twice and leave numbers from before the edit showing beneath.
- **Regions from a selection** use `selectedProteinResidues` for both the inspector and
  right-click menu: coordinates follow the CDS's direction and splicing, partial codons
  expand to whole residues, and a terminal stop is excluded. When several CDSs contain
  the selection, ask which protein owns the region rather than silently choosing one.
  Right-clicking a drawn feature within a plain selection keeps that selection.
- **Features into regions** (`src/lib/foldRegions.ts`): files often mark a protein's
  domains, CDRs, linkers and tags as short features inside its CDS, and each can become a
  region of it, the feature deleted, in one `store.apply`. A feature is listed when every
  base is a coding base of the CDS (none in an intron, before `/codon_start`, past its
  ends or only in its stop) and its type is part of a protein: `misc_feature`, `variation`
  and other software's `region`, unless the name is DNA (MCS, lox, att, an operator…);
  GenBank's peptide types; other software's `domain`, `tag`, `linker`, `epitope` and
  `motif`; or a CDS read the same way in the same frame (a fused protein, or a framework
  annotated as a CDS, as `testdata/library/library-parent.gb` does). Residues take whole
  codons, as selections do. A row on the other strand, or already a region (same name and
  residues: an Export copy keeps its regions on the CDS too), starts unticked; a feature
  without a direction (Benchling's "none" too) is on either. Residues in pieces can't be
  one region, so that row can't be ticked. The kind comes from what `regionFeatureNotes`
  wrote (`parseRegionFeatureNote`), else the type, else the name (`kindFromName`), never a
  GenBank type. The feature's own colour carries over unless the app doesn't draw it or it
  is the CDS's, where the stripe wouldn't show; its other notes become the region's note
  and its library design the region's; other qualifiers are named as lost. A new region
  goes under the smallest larger region, new or old, that holds it, and regions there
  before are left as they were; a folded CDS's own regions come along under its region.
- **Library designs on regions** are optional and separate from their kind: a CDR or a
  variable domain does not automatically vary between clones. `variableProteinFeatures`
  projects only marked regions into the existing read-analysis model, as noncoding
  features inside the real CDS, so its frame and translation are counted once. It never
  adds document features. Ordinary feature-based library designs continue to work.
- **Portable export**: normal Save keeps regions attached. The Export dialog can include
  them as ordinary annotations in a GenBank copy (`proteinRegionFeatures`); this leaves
  the open document alone, and the copy keeps the regions on its CDS too. Importing that
  copy also imports those ordinary annotations. Their first /note says what the region
  is, `<kind>[, predicted]; <CDS>, residues a-b[; UniProtKB <entry> s-e]`, and the
  region's note follows, a value per line (`regionFeatureNotes`); Add as feature writes
  the same without the CDS and residues.
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
