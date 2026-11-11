# Personal enzyme selection: plan

Status: implemented (11 November 2026). Tracked in
[issue #58](https://github.com/Mateusz-Jaskolowski/Strandivo/issues/58).

## What we want

One saved **My enzymes** list, independent of lab stock. Choose Common, Lab or My enzymes
separately from how often those enzymes cut, and use the lists throughout the app.

The first version includes a searchable editor and cut-site context-menu actions.
Multiple named sets, personal-list import/export, document-specific counts in the editor
and an “In lab only” filter are deferred.

## Interface decisions

- Replace the combined menu with **Enzymes** (Common enzymes, Lab enzymes, My enzymes)
  and **Show** (Unique 6+ cutters, Unique cutters, Unique and dual cutters, Every site).
  Map and the outline have synchronised controls; Sequence follows the same choices.
  Stack controls where space requires.
- Default to Common enzymes and Unique 6+ cutters. Switching sources retains the filter;
  neither control changes drawing visibility. The existing Cut sites toggle affects Map
  and Sequence; the outline remains available to browse the chosen list.
- Give the Enzyme Library Lab stock and My enzymes sections. Stock products, locations,
  notes and import/export stay in Lab stock. My enzymes is a searchable checklist with
  names, recognition sites, an In lab indicator and Selected only. Selected names come
  first, alphabetically within each group; render only visible rows.
- Start My enzymes empty. Edit My enzymes… opens its section whether the library is new
  or already open, on desktop and in the browser. Distinguish an empty personal list,
  enzymes that do not cut and results excluded by the cut-site filter. Never silently
  substitute the common list.
- A cut site's menu offers Add to My enzymes or Remove from My enzymes. The action
  preserves the active source and filter. Membership saves immediately and does not
  modify a sequence file or enter its undo history.
- Removing stock updates the In lab indicator without changing personal membership.
- Digest and restriction cloning offer the three sources, initially using the document's
  source. Dialog choices do not change the map. Keep selected reaction enzymes visible
  through source, search and cut-count changes. Retain each method's restrictions;
  Golden Gate continues to offer its supported Type IIS enzymes.

## Implementation decisions

- Replace the combined setting with EnzymeSource (common, lab, personal) and EnzymeFilter
  (unique6, unique, unique2, all). Document options carry both lists' known names.
- Resolve membership separately from cut frequency. Count sites across the complete
  sequence before filtering, and apply the existing 6+ specificity rule to non-common
  enzymes too. Preserve incremental rescanning and stable site IDs; cache membership
  and filters and prune unavailable enzyme picks when either changes.
- Preserve exact recognised names and cutting behaviour: Acc65I is not KpnI, and Esp3I
  should not introduce a BsmBI label. Explicitly choosing both names keeps both.
- Save a separate versioned name list under the personal-enzymes app-data key. Reuse the
  existing shell storage mechanism, with browser storage on the web. Name arrays stay
  stable until membership changes.
- Serialise writes, read current saved contents before editing, and publish only after
  successful saving. Preserve saved names unknown to the running version, show them as
  unrecognised in the editor and omit them from scanning. An unreadable file blocks
  writes until recovery preserves it beside a new list.
- Notify documents and editors after membership changes, including those in another
  window or browser tab; unsubscribe when their owner closes. Library section requests
  must survive window startup and work when the library is already open.
- Translate old choices: unique6/unique/unique2 become Common with the same filter;
  lab1/lab2/lab become Lab with unique/unique2/all. None becomes Common + unique6 with
  drawing off. Persist the new choices and visibility across reopening.
- Deliver the feature in one PR, with an agent-guide update and an Unreleased changelog
  bullet. Follow Conventional Commits, keep commits logical and never rewrite pushed
  commits.

## Verification and acceptance

- Unit-test all sources and filters with one-, two- and three-cut enzymes, empty lists,
  non-common 6+ enzymes, exact names, circular-origin and reverse-strand sites, and
  incremental rescanning against a complete scan.
- Test duplicate normalisation, unknown-name preservation, successful and failed saves,
  reopening, notifications, recovery, every old preference and reaction selections
  retained outside the active list.
- Extend desktop and web e2e coverage for checklist and context-menu edits, matching Map,
  Sequence and outline results, source and cut filters, reaction pickers, live updates
  and persistence. Verify keyboard focus and narrow layouts.
- Run npm run check before pushing the implementation; CI runs desktop and web e2e.
  Documentation-only changes use npm run check:quick.

Acceptance example: My enzymes contains EcoRI and Acc65I. Every site shows all their sites;
Unique cutters shows only enzymes cutting once. KpnI does not appear automatically, and
removing Acc65I from stock leaves the personal list intact.
