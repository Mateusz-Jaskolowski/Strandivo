# PCR product dialog: remaining work

The dialog now has a product overview and an editable line program, following the design
agreed on 16 November 2026. The program starts from sourced NEB conditions; custom values
keep the source they started from and Copy program uses the current values.

## Gel

Show the undigested linear product beside the chosen digest using the existing gel logic.
Fragment sizes remain top-strand lengths; the gel keeps its own colours in every theme.

## Reaction mix

A folding section will hold volume, reaction count, extra volume, primer stock concentration
and template volume. Water adjusts to fit. Source every recipe from the named NEB product;
keep unavailable values absent. Final primer concentration follows the polymerase's NEB Tm
settings. Warn about small pipetting volumes and suggest a working dilution where useful.
Remember volume, extra and stock concentration app-wide; reaction count lasts only while
the window stays open.

## Printable PCR plan

The user requested a printable note for bench use, planning and an informal experiment
record. Start with a printable page or PDF containing:

- Experiment name and date, template identity, primer names and sequences, and product size.
- Polymerase and protocol source, the current program and changes from its generated values.
- Product overview, chosen digest and expected bands, and the reaction mix when available.
- Free bench notes for changes during the run and observations.

Keep the experiment date separate from the export date. A saved plan can describe work to
do or record what was done; printing alone does not mark it performed. Saving and reopening
an editable plan, export format and layout will be discussed before that PR.
