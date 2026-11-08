# Strandivo

**Plan, build and check your plasmids.**

A free, open-source plasmid editor for Mac, Windows and Linux: maps and sequence editing,
primers and cloning, and sequence verification with Sanger and whole-plasmid reads. [strandivo.com](https://strandivo.com)

- **Open your files**: SnapGene `.dna`, GenBank, FASTA, SBOL, GFF, Geneious and `.ab1` traces
- **Construct library**: Home lists every construct in your folders (and their subfolders)
  with its size, what it carries (read off its features, e.g. `EGFP · KanR · pBR322 ori`, or
  detected for a file with none) and a short note you can add; search by name, contents or note
- **Maps and editing**: each open file is a tab next to Home, with Map, Sequence, Primers,
  Reads and Info views (or map and sequence side by side). Circular and linear maps, an editable sequence view with
  both strands, features, primers, restriction sites and translations, an outline of
  everything in the file and an inspector for whatever is selected. Translations can be
  coloured by amino acid chemistry (Clustal X colours). Open reading frames show on the map
  and in the sequence (from ATG to a stop, 75 codons or longer by default; GTG/TTG starts
  in Settings) and one click adds one as a CDS. Right-click selected bases, a
  feature, a primer, an ORF or a cut site for what you can do with it, such as adding a forward or
  reverse primer over the selection or changing a feature's colour
- **Feature detection**: Tools → Detect Features… finds common parts in a sequence
  (resistance genes, origins, promoters, tags, recombination sites, fluorescent proteins,
  Cas9 and more) and lists them for you to review; the ones you tick are added in one undo
  step. Codon-optimized genes are found by the protein they encode. A file with few features
  offers it in a strip under the toolbar (Settings can turn that off). The catalog ships with
  the app, and every entry comes from a source whose terms allow it
- **Virtual digests**: choose enzymes and see the fragments (size, position, ends) and a
  simulated agarose gel next to a ladder, with other open files as more lanes; any fragment
  opens in a new tab
- **Lab enzymes**: keep your enzyme products, freezer locations and notes in the Enzyme
  library (the scissors button in the app bar, or Window → Enzyme Library), including
  isoschizomers such as Acc65I or Esp3I. Choose a *Lab enzymes* set in the map controls or
  outline to show where enzymes you have cut: once, at most twice, or everywhere. The stock
  list is saved locally for all plasmids; import a spreadsheet (tab-separated or CSV), and
  export or import to back it up or share it with colleagues. Product names are your
  records; reaction conditions aren't fetched from manufacturers
- **Protein regions**: give a CDS its UniProt accession and its transmembrane helices,
  topological domains and signal peptides are marked inside it, still as one feature. The
  CDS's protein is aligned to the entry first, so tags, fusions and truncations land right.
  The entry is fetched only when you ask; apart from the daily update check, it is the
  only time the app goes online.
- **Primers**: Tm (SantaLucia with primer3's conditions by default; Breslauer, Wallace or a
  basic formula, and your reaction conditions, in Settings), GC, 3′ clamp, runs and self-dimer checks,
  where each primer binds (tails allowed, with a warning when a tail binds elsewhere too), add one by pasting its sequence, or design a pair
  to amplify a feature, with restriction sites added at its ends (NdeI at a start codon
  reuses the ATG). The selected primer is shown among the bases it pairs with (tail and
  mismatches marked), and its ends can be dragged to extend or trim it; primers can be given a colour. Your lab's primer library has its own window (import a list, or start
  from common sequencing primers); each plasmid shows which of its primers bind and adds them
  in one click. Any two primers give a PCR product preview: size, Tm difference, side
  products, and the product as a new file. Mutagenesis primers change an amino acid of a CDS
  (with the codon that needs the fewest base changes) or substitute, insert or delete bases,
  as a back-to-back pair (Q5 SDM) or an overlapping one (QuikChange), each 3′ arm sized to
  your Tm and checked like any primer
- **Primer list**: the Primers tab lists a file's primers in sortable columns, with their
  notes, and a filter by name, note or sequence. Pick several to copy them for ordering,
  save them to the library or delete them. *Pairs* shows every forward and reverse primer
  that amplify something together, with the product's size, how far apart their Tms are and
  any cross-dimer, and opens one as a PCR product. *Export list…* saves the list as a
  tab-separated file
- **Cloning simulation**: restriction and ligation, Gibson, In-Fusion and Golden Gate, with
  the open file as the vector and inserts from other open files. The product is shown as you
  choose enzymes and pieces (its size, where the pieces join, which way an insert can go,
  and what could go wrong) and opens in a new tab with every piece's features. For Gibson
  and In-Fusion, primers with the overlap tails are designed for each insert you amplify
- **Sanger verification**: drop `.ab1` files on a construct and get, for every read, where it
  aligns (either strand, across the origin), every difference with its base quality, and what
  it does to your features — e.g. `W163R in AmpR`, `frameshift at codon 40`, or fully covered
  with no differences. Each read's trace is shown under the reference, and one click
  corrects the sequence to match a read
- **Library clones**: reads of one clone are combined into a consensus, and a plate becomes a
  table of each clone's mutations, stops and frameshifts, with identical clones together.
  Mark CDRs, NNK sites or a part with a few known versions as variable, and each clone's
  contents there get a column of their own instead of a row of mutations. Double peaks in
  the traces tell a colony with two plasmids ("Mixed, about 30%") from a clean one, and
  calls made among them, such as a read's noisy end, are left out. A summary shows how
  many clones are different or broken, mutations per kb, mutations that recur along the
  sequence or a protein, and the codons seen at NNK sites against what chance would show
- **Plasmid info**: size, GC content and markers read off the features, plus lab fields
  (sequence verified, stored at, resistance, host, backbone, insert, codon optimization,
  source, notes, and your own) saved inside the GenBank file so they travel with it
- **Settings** in their own window (⌘,): map display, Tm method, read quality thresholds,
  lab fields
- **Updates** from inside the app: it checks once a day (a setting) and installs a new
  version only when you choose. A welcome window on first launch asks about it and helps
  you add your construct folders and a primer library
- **Feedback** from inside the app: Help → Send Feedback… sends a bug, an idea or a
  question, with no GitHub account needed, and shows everything that goes with it first
- **Private**: everything runs on your computer and your files never leave it. The app
  goes online only to check for updates, to look up a UniProt entry you ask for and to
  send feedback you write;
  [strandivo.com/privacy](https://strandivo.com/privacy/) lists exactly what each sends

## Download

Download Strandivo for Mac (Apple Silicon and Intel), Windows and Linux from
[strandivo.com/download](https://strandivo.com/download/); every version is also on the
[Releases page](https://github.com/Mateusz-Jaskolowski/Strandivo/releases). Each release's
notes are in [`CHANGELOG.md`](CHANGELOG.md), and
[strandivo.com/privacy](https://strandivo.com/privacy/) lists everything the app sends. A maintainer makes one by writing its
notes there and pushing a version tag such as `v0.2.0`, which builds every platform and
drafts a release; *Actions* → *Build installers* → *Run workflow* builds one platform for
testing.

Every push runs the *Checks* workflow on Linux: all tests, plus a build of the Linux app that
is clicked through automatically on a virtual display (screenshots go to the `e2e-results`
branch).

### First launch on a Mac

The app isn't notarized by Apple yet, so macOS blocks it the first time. Open it once, click
**Done**, then go to **System Settings → Privacy & Security**, scroll down and click
**Open Anyway**. If macOS instead says the app "is damaged", run this in Terminal once:

```sh
xattr -dr com.apple.quarantine "/Applications/Strandivo.app"
```

On Windows, SmartScreen may show "Windows protected your PC" → **More info → Run anyway**.

On Linux, install the `.deb` (Debian, Ubuntu and their relatives), or make the AppImage
executable (`chmod +x Strandivo_*.AppImage`) and run it. Strandivo needs WebKitGTK 4.1, which
current Ubuntu, Debian and Fedora releases include.

## Using it

- **Open** a file from Home, with File → Open, or by double-clicking a `.dna`/`.gb` file once
  the app is installed. Each file opens in a tab; ⌘W/Ctrl+W closes it and Ctrl+Tab (or
  Ctrl+Page Down/Up) moves between tabs. Add your plasmid folders on Home to see all your
  constructs there.
- **Edit**: click in the Sequence tab and type, delete, cut, copy and paste; ⌘Z/Ctrl+Z undoes.
  Drag across the map or the sequence to select, then add a feature or primer for the
  selection from the toolbar.
- **Simulate cloning**: open the vector, then Tools → Simulate Cloning… (or the toolbar
  button). Pick the method, the enzymes or how the vector is opened, and the inserts from
  your other open files; **Open product** opens the result as a new, unsaved tab.
- **Check sequencing reads**: with your construct open, drag `.ab1` files onto the window (or
  Tools → Align Sequencing Reads…). The *Reads* tab lists each read, shows the traces aligned
  under the reference, and lists every difference; step through them with the arrows, or
  click a read for its details. Right-click a read or a clone for what you can do with it;
  hold ⌘ or Ctrl to pick several and remove or group them; drag reads to reorder them, onto
  another to group them, or out of a clone. The *Translation* chip translates each read in
  the frame of your CDS, and stops at a frameshift. A whole-plasmid result (Plasmidsaurus and the like, as FASTQ,
  FASTA or GenBank through **Add reads…**) is lined up with your sequence wherever it
  starts, and shows size differences; small indels in runs of one base, the usual nanopore
  error, are marked as uncertain.
- **Save**: GenBank and FASTA are written directly. SnapGene `.dna` files are opened but saved
  as GenBank (`.gb`), which SnapGene opens too.

## How the read checking works

1. Low-quality read ends are trimmed with the modified Mott algorithm (cutoff 0.05). Files
   without quality scores get estimates from their trace peaks.
2. k-mer seeds find where the read maps (both strands; circular references are searched
   across the origin), then a Smith-Waterman-Gotoh local alignment with affine gaps runs in
   that window. This stays fast on whole bacterial genomes.
3. Each substitution, insertion and deletion is reported with the quality of the read bases
   behind it; below the *Min. quality* setting (default Q20) it's marked uncertain.
4. Differences inside CDS features are translated into amino-acid changes.

The alignment core is a dependency-free Rust crate in [`crates/seqcore`](crates/seqcore), tested
against real trace files in [`testdata`](testdata).

## Building from source

Requirements: [Node.js 22+](https://nodejs.org), [Rust](https://rustup.rs), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run app:dev     # run the app with live reload
npm run app:build   # build an installer for this computer (unsigned, without update files)
```

Tests:

```sh
npm test                                   # interface logic
(cd crates/seqcore && cargo test --release) # alignment core
(cd crates/seqcore-json && cargo test --release) # what the interface sees of it
```

The browser version, not published yet, needs Rust's WebAssembly target
(`rustup target add wasm32-unknown-unknown`):

```sh
npm run dev:web     # run it with live reload
npm run build:web   # build it into dist-web
```

## Project layout

Conventions, decisions and how to check changes are in [`AGENTS.md`](AGENTS.md), written for
coding agents but useful to anyone working on the code. [`CONTRIBUTING.md`](CONTRIBUTING.md)
says how to take part.

| Path | What |
| --- | --- |
| `src/` | Interface (TypeScript): the main window with Home and its tabs, other windows, file handling |
| `src/doc/` | An open document: its store (undo, selection), file conversion, layout |
| `src/views/` | Map, sequence, primers, reads (canvas trace view), outline, inspector, search |
| `src/lib/` | Pure logic with unit tests: sequence edits, primers and Tm, primer design, mutagenesis and PCR products, enzymes, ORFs, digests and gels, cloning simulation, alignment layout, codon effects, construct summaries |
| `src-tauri/` | Desktop shell (Rust/Tauri): windows, menus, file associations, folder listing, commands |
| `crates/seqcore/` | Trimming, alignment, difference calling, and the parts catalog and its search for feature detection (Rust, no dependencies) |
| `crates/seqcore-json/` | The core's requests and responses as the interface sees them (JSON) |
| `crates/seqcore-wasm/` | The core as WebAssembly, for the browser version, where it runs in a worker (`src/core/`) |
| `tools/` | Scripts run by hand: the parts catalog and its curated sources, the app icon, `npm run version`, and the website's pages (`npm run site`, from `tools/site/`) |
| `services/updates/` | The Cloudflare Worker behind `updates.strandivo.com` |
| `services/feedback/` | The Cloudflare Worker behind `feedback.strandivo.com`, which files reports as issues |
| `site/` | The website, `strandivo.com`: plain files on Cloudflare Pages, most of them written by `npm run site` |
| `CHANGELOG.md` | Each release's notes; their first paragraph is what the app shows in What's new |
| `docs/` | Plans and notes: the parts catalog's sources and terms, clone checking, feature detection, updates and feedback |
| `testdata/` | Real `.ab1`/`.dna` files used by the tests, with their sources |

## Roadmap

- Anonymous usage statistics, with a choice at first launch and a setting
- Golden Gate primer design (adding sites and overhangs to PCR inserts)
- Export maps and sequences as PDF, SVG or PNG
- Signed and notarized installers
- Write SnapGene `.dna` files
- Dark mode setting

## Licence

    Strandivo: a free, open-source plasmid editor with sequence verification.
    Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors

    This program is free software: you can redistribute it and/or modify it under the
    terms of the GNU General Public License as published by the Free Software
    Foundation, either version 3 of the License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful, but WITHOUT ANY
    WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
    PARTICULAR PURPOSE. See the GNU General Public License for more details.

    You should have received a copy of the GNU General Public License along with this
    program. If not, see <https://www.gnu.org/licenses/>.

The full licence is in [`LICENSE`](LICENSE). Contact: hello@strandivo.com.

Strandivo uses TeselaGen's bio-parsers and sequence-utils (MIT) and
[Tauri](https://tauri.app) (MIT/Apache-2.0).

### Trademarks

SnapGene is a registered trademark of GSL Biotech LLC, and other product names belong to
their owners. They are named here only to say which files Strandivo reads and writes.
Strandivo is an independent project, not affiliated with or endorsed by any of them.
