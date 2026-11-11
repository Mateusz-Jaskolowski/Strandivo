# Distinguish protein regions on the map

Implementation and local validation complete on 11 November 2026. Desktop and browser
end-to-end checks await CI.

## Summary

Make protein-region labels visually secondary to feature labels, and show which CDS owns
a region when hovered. Apply the behaviour to circular and linear maps. Keep existing
band geometry, saved colours, visibility controls and label-priority rules.

## Visual behaviour

| Element | Default | While its region is hovered |
|---|---|---|
| Region label | No background; current font size; weight 400; `--text-3` | `--text`; weight stays 400 |
| Circular region leader | Solid, 1 px, `--leader` | `--text-3` |
| Region bands | Existing colours and opacity | All pieces of that region become fully opaque |
| Owning CDS | Existing appearance | Outline becomes `--text-2`, 1.25 px |

- Hovering a region band or label highlights that region and its owning CDS, including
  when the region is nested inside another region.
- Selected region labels use `--accent-text` at weight 400. Selected region leaders use
  `--accent`, 1.25 px. Keep existing selected-band styling.
- Selection takes precedence over hover; a selected CDS keeps its stronger accent outline.
- Feature labels keep their backgrounds and semibold text. Region colours stay on bands.

## Implementation

Rendering and interaction live in `src/views/mapView.ts`, with map-specific styles in
`src/doc/document.css`.

- Identify regions through `region !== undefined`, including index zero. Preserve feature
  IDs, region indices and `data-kind="feature"` for selection and context menus.
- Share a region-label class between map modes. Remove circular region chips and their
  padding. Measure region-label widths at weight 400 in both modes.
- Give circular region leaders a separate class and register them with the existing
  region shape group for hover and selection styling.
- Override generic label rules that colour hovered regions with the accent or make
  selected text bold. Interaction never changes text size or weight.
- Track hover locally in MapView by feature ID and region index. Delegate pointer
  tracking through the SVG host and update classes only when the region changes. Use
  existing CDS paths for the parent outline; hover never writes to the store or rebuilds
  the SVG.
- Clear hover on leave, cancellation, pointer-down, redraw and hiding the map. Suppress
  it during dragging, and resume on the next pointer movement without a button pressed.
- Append “ · region of <CDS name>” to both band and label tooltips, keeping kind,
  prediction status and residue range. Build SVG text nodes; keep this wording local
  to the map.

No public API, document-model, persistence or file-format changes.

## Verification

Extend desktop protein-region e2e checks and add a browser smoke check:

- Verify label styles in both modes, including region zero, and existing feature styles.
- Use real pointer actions on bands and labels. Cover nested regions, overlapping CDSs,
  identical region names under different CDSs, and every piece of a split region.
- Check cleanup after leaving, dragging, hiding regions, switching views and redrawing.
- Check unchanged selection, undo history and edited state on hover; verify region
  clicks, context menus and selection precedence.
- Check ownership tooltips retain existing region details.
- Visually inspect crowded circular and linear maps, long labels, reverse-strand and
  origin-crossing regions at small, default and large label sizes. Capture default and
  hovered states.

`npm run check` passed on the branch rebased onto `origin/main`. Both map modes were
reviewed in a preview fixture at label sizes 3, 8 and 16, with overlapping CDSs, a nested
region and a reverse CDS that crosses the origin. The preview included hover and selected
states. The desktop and browser scripts cover actual pointer actions in CI.

## Branch, attribution and delivery

1. Use a clean worktree on `feat/map-region-display` from freshly fetched `origin/main`.
   Leave the personal-enzyme checkout and its uncommitted changes untouched.
2. Save this plan first, run `npm run check:quick`, and commit as
   `docs(map): record region display plan`.
3. Implement and validate, update the root map-label conventions and protein-display
   guide, and add an Unreleased changelog bullet. Mark this plan complete after the
   implementation and required checks pass. Commit as
   `feat(map): distinguish protein regions on the map`.
4. Preserve the configured Mateusz Jaskolowski author and committer identity, GitHub
   noreply email and commit signing. Use Conventional Commits with short bodies, keep
   one logical change per commit, and never rewrite pushed commits.
5. Any later PR uses `feat(map): distinguish protein regions on the map` as its title,
   follows the repository template and reports actual validation results. Create it
   through the existing authenticated GitHub account.
