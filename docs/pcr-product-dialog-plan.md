# PCR product dialog: remaining work

The dialog now has a product overview, a gel of the template and the product beside the
chosen digest, an editable line program, and a folding reaction mix, following the design
agreed on 16 November 2026. The program starts from sourced NEB conditions; custom values
keep the source they started from and Copy program uses the current values.

## Printable PCR plan (shipped)

The PCR product dialog includes **Print PCR plan…**, which captures one immutable snapshot of
the current effective plan (`src/lib/pcrPrint.ts`) and opens a preview dialog
(`src/views/pcrPrintDialog.ts`) without modifying the construct, saving settings, or closing
the PCR dialog.

- **Local preview fields & section choices**: experiment name (suggested from template and
  primer pair), optional experiment date (left blank unless filled in, distinct from the
  export date in the footer), multiline bench notes (with ruled writing lines when blank),
  and **Include** toggles for Primers, Product map, Simulated gel, Cycling program, Reaction
  mix, and Bench notes (remembered when printed or exported, untouched on Cancel).
- **PCR dialog controls**: the PCR product dialog splits Product map and Simulated gel into
  independent foldable sections alongside a foldable Cycling program and Reaction mix
  (`src/pcrDialogFolds.ts`), and adds **No digest (uncut only)** (`NO_DIGEST`) to the
  digest menu.
- **Bench-sheet contents**: template identity (without full sequence or file path), full
  5′→3′ primer sequences (non-binding 5′ tails lower-case), predicted product map and GC
  strip, selected digest (or uncut-only gel) and simulated agarose gel (reusing `gelLayout`
  in `src/lib/gel.ts`) with current ladder and lane key, polymerase and protocol source,
  edited cycling program (marked **Edited** with original source attribution and generated
  baselines), effective reaction mix even when collapsed (`effectivePcrMix`), and
  dialog/prediction warnings. Missing protocols or mixes explain why instead of printing
  empty tables.
- **Printing, PDF, Markdown & offline fallback**: **Print…** (labelled **Print / Save as
  PDF…** in browsers) invokes the native print sheet (`print_window` via
  `WebviewWindow::print()` on desktop and `window.print()` in browsers) over a dedicated
  light-paper print layout (`@media print`); desktop builds also offer direct **Save as
  PDF…** (`src-tauri/src/pdf.rs`, with A4 / US Letter paper selection) via each platform's
  native webview print-to-PDF API; **Copy Markdown** copies the selected sections for ELNs;
  and **Save HTML…** saves a self-contained offline HTML bench sheet with no scripts or
  external resources.

## Remaining work

- Saving and reopening editable PCR plan files, syncing plans back into the dialog, and
  optional ELN/PDF integrations remain out of scope for now.

