# GC content along the sequence

Planned and built 12 November 2026; merged with its end-to-end checks passing in CI.

## Summary

When placing a primer, people look for a stretch around 40–60% GC. Today the app shows GC
only for what is already chosen: a selection (status bar, inspector) or a primer (Primers
tab readout, table and checks). Nothing shows where along the sequence the good and the
difficult stretches are before a primer is drawn.

Add a thin GC strip to the rows of bases, coloured only where GC leaves the 40–60% band,
and a matching band along the Sequence tab's overview strip for the whole sequence. It is
a layer, switched on with a "GC" chip, not a sixth view.

## What it shows

### The row strip

- **Window**: 21 bases centred on each base. An odd width centres exactly; 18–25 nt covers
  almost every primer; a centred window means the same for a forward and a reverse primer,
  where a "primer starting here" window would depend on the strand. It is fixed, not a
  setting, so a base has the same colour on every screen.
- **Bases counted**: G, C and S count as GC; A, T, U and W as AT; any other ambiguity code
  or N is left out of both, so a run of Ns doesn't read as AT-rich. A window with no
  countable base is not coloured. On a circular sequence the window wraps across the
  origin; on a linear one it is cut short at the ends.
- **Colour scale**, matching the primer checks in `src/lib/primers.ts` (which warn below
  35% and above 65% and say to aim for 40–60%):

  | GC | Drawn as |
  |---|---|
  | below 35% | AT colour, full |
  | 35% to below 40% | AT colour, light |
  | 40–60% | neutral, barely visible |
  | above 60% to 65% | GC colour, light |
  | above 65% | GC colour, full |

  Most of a typical plasmid is in the band, so the strip stays quiet and the stretches to
  avoid stand out. AT-rich and GC-rich get different colours because they need different
  fixes (a longer primer, or a shorter one or another site).
- **Colours**: teal for AT-rich, orange for GC-rich. Not blue, as the selection is the
  accent blue and a selected AT-rich stretch would be hard to read. Teal and orange stay
  apart for the common kinds of colour blindness. Both are design tokens in
  `src/styles.css`, with dark values.
- **Hover**: the strip is drawn as runs of one colour; each run's tooltip gives its GC
  and bases, as "GC 68–76% around 1,240–1,251" (the lowest and highest window in the
  run).
  A tooltip per base would need an element per base.
- **No click action**: dragging across rows already selects bases, and the strip passes
  clicks through to that.

### Where it goes

- **Sequence tab**: under the strands, after any reverse primers and before ORFs and
  features, so primers stay next to the strand they pair with. Off by default; the "GC"
  chip sits with the other chips.
- **Primers tab, sequence panel**: in the same place in each row. On by default, as the
  panel is there to place primers. It has its own "GC" chip and its own setting, unlike
  Regions, which the two share: the defaults differ, so one setting can't serve both.
- **Overview strip** (the Sequence tab's click-to-jump bar): a band about 3 px tall along
  its bottom edge, under the feature bars, shown with the Sequence tab's "GC" chip. Its
  window grows with the sequence: the larger of 101 bases and about a hundredth of the
  length (made odd), so about 100 bp on a 5 kb plasmid and 500 bp on a 50 kb one. This
  scale is where GC causes trouble beyond one primer: a GC-rich promoter that won't
  amplify, an AT-rich stretch where reads fail. Same colours and thresholds, so one
  legend reads both.

Both chips are remembered like the others (`VIEW_KEY` in `src/doc/document.ts`).

## Implementation

- `src/lib/gc.ts`: the profile (GC fraction for every base for a given window, from
  running counts, so any window costs the same), the level for a value, and the runs of
  one level between two positions. Pure, unit-tested in `src/lib/gc.test.ts`.
- `src/doc/analysis.ts` caches a profile per sequence and window, like ORFs and cut sites,
  so drawing rows on scroll doesn't count again.
- `src/views/gcStrip.ts` draws the runs; `src/views/sequenceView.ts` and
  `src/views/primerContext.ts` make room for the strip in each row and place it; the overview band is drawn with the overview strip. Views draw only the
  rows on screen, and a row has a handful of runs, not an element per base.
- The options are `sequenceGc` (off) and `primerGc` (on) in `ViewOptions`.

## Alternatives considered

**Only mark the good stretches** (a green mark where GC is 40–60%, nothing elsewhere).
Shows directly where a primer can go, but can't tell AT-rich from GC-rich, and in a
typical plasmid it marks most of the sequence, so it is busy where nothing is wrong.
Verdict: the diverging scale, which is quiet where nothing is wrong.

**A small line plot with the 40–60% band shaded.** Shows exact values and how steeply GC
changes, but needs about 20 px a row against 5 px, and is hard to read one base at a
time. Verdict: better on a map, where there is room and no per-base reading; not here.

**A GC ring on the map.** The usual picture of a whole plasmid's GC, but the map is for
features and is already layered; the overview band gives the same overall picture in the
tab where primers are placed. Verdict: not now; reconsider if people ask for it on the map.

**Letting "Design primers…" move the ends.** `designPairs` in `src/lib/design.ts` put the
forward primer exactly at the selection's start and the reverse exactly at its end, so
in an AT-rich spot it could only make the primer longer. Letting the ends move a set
distance lets it find a balanced stretch on its own. This answers "design primers for
me" better than any strip, while the strip answers "where should I put this one".
Verdict: complementary, and done as its own change (PR 73): the dialog's "Move ends"
distance (`moveEnds` in `DesignOptions`, 0 by default) lets each end move outward.

**Marking where a good primer can start** (Tm in the window, a 3′ clamp, one binding
site). Answers the real question more directly than GC, which is a proxy, but costs a Tm
and a binding search per base and is harder to explain than a colour. Verdict: not now;
GC first, and add this only if people ask.
