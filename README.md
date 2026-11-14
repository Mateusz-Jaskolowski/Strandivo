# Strandivo

**Plan, build and check your plasmids.**

A free, open-source plasmid editor for Mac, Windows and Linux: maps and sequence editing,
primers and cloning, and sequence verification with Sanger and whole-plasmid reads. [strandivo.com](https://strandivo.com)

- **Open your files**: SnapGene `.dna`, GenBank, FASTA, SBOL, GFF, Geneious and `.ab1` traces
- **Construct library**: Home lists every construct in your folders and subfolders with its
  size, key features (e.g. `EGFP · KanR · pBR322 ori`, detected automatically for
  unannotated files) and notes; search by name, feature or note
- **Maps and editing**: circular and linear plasmid maps alongside an editable two-strand
  sequence view, feature/primer/cut-site outline and selection inspector. Colour translations
  by amino-acid chemistry (Clustal X), detect open reading frames on both strands, and
  convert any ORF into a CDS feature in one click
- **Feature detection**: Tools → Detect Features… scans unannotated sequences against a
  built-in catalog of common plasmid parts (resistance markers, origins, promoters, tags,
  recombination sites, fluorescent proteins, Cas9 and more), including codon-optimized
  variants matched at the protein level
- **Virtual digests**: simulate single or multi-enzyme digests across one or more constructs
  on an agarose gel next to a molecular weight ladder, and open any fragment as a new tab
- **Lab enzymes**: track your lab's restriction enzyme stock, suppliers and freezer locations
  (including specific isoschizomers such as Acc65I vs. KpnI or Esp3I vs. BsmBI), and filter
  maps to show only stocked enzymes
- **Protein regions**: map transmembrane helices, topological domains and signal peptides
  from UniProt onto a CDS feature via protein alignment, handling tags, fusions and
  truncations automatically
- **Primers & mutagenesis**: Primer3-compatible Tm calculations (SantaLucia 1998, Breslauer
  1986, Wallace rule or basic GC, with adjustable salt/Mg²⁺/dNTP/oligo concentrations),
  GC/3′-clamp/homopolymer/dimer checks, primer design with optional 5′ restriction tails,
  PCR product previews, and whole-plasmid site-directed mutagenesis primer design (Q5
  back-to-back or QuikChange overlapping)
- **Primer library & ordering**: maintain a lab primer library (or start with standard
  core-facility sequencing primers) to automatically see which primers bind any construct you
  open; filter, sort, export TSV lists or copy primers formatted for vendor order forms
- **Cloning simulation**: simulate restriction/ligation, Gibson, In-Fusion and Golden Gate
  assemblies from open constructs, automatically designing overlap primers for PCR-amplified
  fragments and opening assembled products in a new tab
- **Sanger & whole-plasmid verification**: drop `.ab1`, `.seq` or FASTQ reads onto a
  construct to quality-trim and align them on both strands (including across the origin),
  inspect chromatograms beneath the reference, and see every substitution, indel or
  frameshift with its amino-acid effect (e.g. `W163R in AmpR`)
- **Clone & library analysis**: group reads by clone into a consensus table, flag mixed
  colonies from double trace peaks, and mark CDRs or NNK libraries as variable regions so
  each clone's variant sequence is tabulated in its own column
- **Plasmid info**: length, GC content, molecular weight and detected markers, plus
  customizable lab record fields saved inside the GenBank file
- **Private & local**: your sequences and files never leave your computer. Network requests
  are limited to update checks, on-demand UniProt lookups, optional anonymous usage
  statistics and feedback you choose to send — see
  [strandivo.com/privacy](https://strandivo.com/privacy/) for the complete list

## Download

Download Strandivo for Mac (Apple silicon and Intel), Windows and Linux from
[strandivo.com/download](https://strandivo.com/download/) or
[GitHub Releases](https://github.com/Mateusz-Jaskolowski/Strandivo/releases). Release notes
are in [`CHANGELOG.md`](CHANGELOG.md) and on
[strandivo.com/changes](https://strandivo.com/changes/).

### First launch on a Mac

Strandivo isn't notarized by Apple yet, so macOS shows a security prompt the first time you
open it. Open the app once, click **Done**, then open **System Settings → Privacy &
Security**, scroll down and click **Open Anyway**. If macOS instead says the app "is
damaged", run this in Terminal once:

```sh
xattr -dr com.apple.quarantine "/Applications/Strandivo.app"
```

On Windows, if SmartScreen shows "Windows protected your PC", click **More info → Run
anyway**.

On Linux, install the `.deb` on Debian, Ubuntu and derivatives, or make the AppImage
executable (`chmod +x Strandivo_*.AppImage`) and run it. Strandivo requires WebKitGTK 4.1
(included in current Ubuntu, Debian and Fedora releases).

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

- Golden Gate primer design (adding sites and overhangs to PCR inserts)
- Export maps and sequences as PDF, SVG or PNG
- Signed and notarized installers
- Write SnapGene `.dna` files

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
