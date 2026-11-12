// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Shared map checks: real pointers in both WebKitGTK (desktop) and Chrome (web).

/** Overlapping proteins, a reverse CDS across the origin, an intron and nested regions. */
export function mapRegionFixture(n) {
  const region = (name, kind, start, end, extra) =>
    `${name}|${kind}|${start}-${end}|P00001:${start + 10}-${end + 10}|predicted|${encodeURIComponent(JSON.stringify(extra))}`;
  return [
    { id: "map-region-a", name: "Protein A", type: "CDS", start: n - 300, end: 299, strand: -1,
      locations: [{ start: n - 300, end: n - 121 }, { start: n - 90, end: 299 }], color: "#6e9eac", raw: {},
      notes: { strandivo_regions: [
        region("Shared domain", "Domain", 5, 180, { id: "domain", color: "#ad737d" }),
        region("A nested region with a longer name", "CDR", 40, 65, { id: "child", parentId: "domain", color: "#9ca768" })
      ] } },
    { id: "map-region-b", name: "Protein B", type: "CDS", start: n - 180, end: 239, strand: 1,
      color: "#d49d65", raw: {}, notes: { strandivo_regions: [
        region("Shared domain", "Domain", 10, 100, { color: "#a984b2" })
      ] } }
  ];
}

/** Runs on an open circular document, then undoes its fixture and restores map controls. */
export async function checkMapRegionDisplay(s, check, { smoke = false } = {}) {
  const label = (id = "a", index = 0) => `.sv-map-region-label[data-id="map-region-${id}"][data-region="${index}"]`;
  const band = (id = "a", index = 0) => `.sv-map-region[data-id="map-region-${id}"][data-region="${index}"]`;
  const noHover = "!document.querySelector('.sv-map-region-hover, .sv-map-parent-hover')";
  const pointerTo = ([x, y]) => ({ type: "pointerMove", origin: "viewport", x, y });
  let lastPoint;
  const move = async selector => {
    // A curved SVG band's bounding-box centre may be empty: find a painted point.
    const point = await s.exec(`
      const el = document.querySelector(arguments[0]);
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const b = el.getBoundingClientRect();
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const px = Math.round(b.left + (x + .5) / 64 * b.width);
        const py = Math.round(b.top + (y + .5) / 64 * b.height);
        const hit = document.elementFromPoint(px, py);
        if (hit === el || el.contains(hit)) return [px, py];
      }
      throw new Error('No visible point in ' + arguments[0]);
    `, selector);
    // A click or redraw can clear hover while leaving the pointer at the same coordinates.
    if (lastPoint?.[0] === point[0] && lastPoint[1] === point[1]) await s.pointer([pointerTo([5, 5])]);
    await s.pointer([pointerTo(point)]);
    lastPoint = point;
    return point;
  };
  const control = (name, value) => s.exec(`
    const el = document.querySelector('[aria-label="' + arguments[0] + '"]');
    el.value = arguments[1];
    el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change', { bubbles: true }));
  `, name, value);
  const mode = linear => s.exec(`
    Array.from(document.querySelectorAll('.sv-map .sv-segmented button'))
      .find(b => b.textContent === arguments[0]).click();
  `, linear ? "Linear" : "Circular");
  const hoverIs = (id, index) => s.waitFor(`
    document.querySelectorAll('.sv-map-parent-hover').length > 0 &&
    Array.from(document.querySelectorAll('.sv-map-parent-hover')).every(e => e.dataset.id === 'map-region-${id}') &&
    document.querySelectorAll('.sv-map-region[data-id="map-region-${id}"][data-region="${index}"]').length > 0 &&
    Array.from(document.querySelectorAll('.sv-map-region[data-id="map-region-${id}"][data-region="${index}"]'))
      .every(e => e.classList.contains('sv-map-region-hover') && getComputedStyle(e).opacity === '1') &&
    document.querySelector('${label(id, index)}').classList.contains('sv-map-region-hover') &&
    Array.from(document.querySelectorAll('.sv-map-region-label.sv-map-region-hover')).length === 1
  `, 3000);

  await s.exec(`
    const hook = window.__strandivo, store = hook.store;
    hook.command('show-map');
    const chips = Array.from(document.querySelectorAll('.sv-map .sv-chip'));
    window.__mapRegionTest = {
      regions: chips.find(b => b.textContent.trim() === 'Regions').getAttribute('aria-pressed') === 'true',
      detail: document.querySelector('[aria-label="Protein region detail"]').value,
      linear: document.querySelector('.sv-map .sv-segmented button[aria-pressed="true"]').textContent === 'Linear',
      labelSize: document.querySelector('[aria-label="Label size"]').value,
      rotation: document.querySelector('[aria-label="Rotate"]').value
    };
    store.apply({ ...store.data, features: [...store.data.features, ...(${mapRegionFixture.toString()})(store.length)] }, 'Map region fixture');
    store.select({ range: null }, 'e2e');
    if (!window.__mapRegionTest.regions) chips.find(b => b.textContent.trim() === 'Regions').click();
  `);
  try {
    await control("Protein region detail", "all");
    await control("Rotate", "100");
    for (const linear of [false, true]) {
      await mode(linear);
      await s.waitFor(`document.querySelector('${label()}')`, 5000);
      const name = linear ? "Linear" : "Circular";
      const styles = await s.exec(`
        const el = document.querySelector(arguments[0]), cs = getComputedStyle(el);
        const feature = document.querySelector('.sv-map-label-feature, .sv-map-arctext');
        const probe = document.createElement('span'); probe.style.color = 'var(--text-3)';
        document.body.appendChild(probe); const muted = getComputedStyle(probe).color; probe.remove();
        return cs.fontWeight === '400' && cs.fill === muted && cs.fontSize === getComputedStyle(feature).fontSize &&
          !document.querySelector('.sv-map-chip[data-region]') &&
          Array.from(document.querySelectorAll('.sv-map-label-feature')).every(e => getComputedStyle(e).fontWeight === '600') &&
          el.querySelector('title').textContent === 'Shared domain · Domain, predicted · 15–190 · region of Protein A' &&
          document.querySelector(arguments[1]).querySelector('title').textContent === el.querySelector('title').textContent;
      `, label(), band());
      check(`${name} map region labels are quiet, readable and name their owning protein`, styles);
      await s.shot(`map-regions-${linear ? "linear" : "circular"}`);
      await s.exec(`
        const t = window.__mapRegionTest, store = window.__strandivo.store;
        t.data = store.data; t.selection = store.selection; t.dirty = store.dirty;
        t.undo = store.undoLabel; t.redo = store.redoLabel; t.svg = document.querySelector('.sv-map-svgel');
        t.width = document.querySelector(arguments[0]).getBoundingClientRect().width;
        t.changes = 0; t.off = store.subscribe(() => t.changes++);
      `, label());
      await move(label());
      check(`${name} region label highlights its bands and only its own CDS`, await hoverIs("a", 0));
      check(`${name} a split region highlights every piece`, await s.exec(`
        const pieces = document.querySelectorAll(arguments[0]);
        return pieces.length > 1 && Array.from(pieces).every(e => e.classList.contains('sv-map-region-hover'));
      `, band()));
      await s.shot(`map-regions-${linear ? "linear" : "circular"}-hover`);
      await move(band("b"));
      check(`${name} overlapping proteins with identical region names stay distinct`, await hoverIs("b", 0));
      await move(band("a", 1));
      check(`${name} nested region hover identifies the owning CDS`, await hoverIs("a", 1));
      await move(label());
      check(`${name} hover changes neither document state nor label width`, await s.exec(`
        const t = window.__mapRegionTest, store = window.__strandivo.store; t.off();
        return t.data === store.data && t.selection === store.selection && t.dirty === store.dirty &&
          t.undo === store.undoLabel && t.redo === store.redoLabel && t.changes === 0 &&
          t.svg === document.querySelector('.sv-map-svgel') && t.width === document.querySelector(arguments[0]).getBoundingClientRect().width;
      `, label()));
      await s.pointer([{ type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }], { release: true });
      check(`${name} clicking a region label selects region zero at the measured weight`, await s.exec(`
        const focus = window.__strandivo.store.selection.focus;
        const el = document.querySelector(arguments[0]);
        return focus?.id === 'map-region-a' && focus.region === 0 && el.classList.contains('sv-focused') &&
          getComputedStyle(el).fontWeight === '400' && el.getBoundingClientRect().width === window.__mapRegionTest.width;
      `, label()));
      if (!linear) check("Selected region leaders keep their stronger accent stroke", await s.exec(`
        const leader = document.querySelector('.sv-map-leader-region.sv-focused');
        return leader && getComputedStyle(leader).strokeWidth === '1.25px';
      `));
      await s.exec("window.__strandivo.store.select({ range: null }, 'e2e');");
      if (!smoke) {
        await s.exec(`
          const store = window.__strandivo.store, f = store.data.features.find(f => f.id === 'map-region-a');
          store.selectRange({ start: f.start, end: f.end }, { kind: 'feature', id: f.id }, 'e2e');
        `);
        await move(label());
        check(`${name} parent selection takes precedence over the hover outline`, await hoverIs("a", 0) && await s.exec(`
          return Array.from(document.querySelectorAll('.sv-map-parent-hover'))
            .every(e => e.classList.contains('sv-focused') && getComputedStyle(e).strokeWidth === '2px');
        `));
        await s.exec(`
          window.__strandivo.store.select({ range: null }, 'e2e');
          window.__mapRegionTest.menu = window.__strandivoMenu;
          window.__mapRegionTest.entries = null;
          window.__strandivoMenu = entries => { window.__mapRegionTest.entries = entries; };
        `);
        await move(label());
        await s.pointer([{ type: "pointerDown", button: 2 }, { type: "pointerUp", button: 2 }], { release: true });
        check(`${name} right-clicking a region keeps its own actions`, await s.waitFor(`
          window.__strandivo.store.selection.focus?.region === 0 &&
          window.__mapRegionTest.entries?.some(e => e.label === 'Edit region…')
        `, 3000));
        await s.exec("window.__strandivoMenu = window.__mapRegionTest.menu; window.__strandivo.store.select({ range: null }, 'e2e');");
        const from = await move(label());
        // One sequence, then released: WebKitWebDriver keeps a button pressed across a
        // release sent in a later call, which broke every click and hover after it.
        // The probe runs after the map's own handler and notes any hover while pressed.
        await s.exec(`
          const t = window.__mapRegionTest; t.dragMoves = 0; t.dragHover = false;
          t.dragProbe = e => { if (e.buttons) { t.dragMoves++; t.dragHover ||= !(${noHover}); } };
          document.addEventListener('pointermove', t.dragProbe);
        `);
        await s.pointer([{ type: "pointerDown", button: 0 }, { ...pointerTo([from[0] - 15, from[1] + 15]), duration: 100 }, { type: "pointerUp", button: 0 }], { release: true });
        check(`${name} dragging suppresses region hover`, await s.exec(`
          const t = window.__mapRegionTest; document.removeEventListener('pointermove', t.dragProbe);
          return t.dragMoves > 0 && !t.dragHover;
        `));
        await move(label());
        check(`${name} hover resumes after dragging`, await hoverIs("a", 0));
        await s.exec("document.querySelector('.sv-map-svg').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));");
        check(`${name} pointer cancellation clears hover`, await s.exec(`return ${noHover};`));
        await s.exec("window.__strandivo.store.select({ range: null }, 'e2e');");
        await move(label());
        const hoveredBeforeRedraw = await hoverIs("a", 0);
        await control("Label size", "10");
        check(`${name} redraw clears hover`, hoveredBeforeRedraw && await s.exec(`return ${noHover};`));
        await move(label());
        const hoveredBeforeHide = await hoverIs("a", 0);
        await s.exec("window.__strandivo.command('show-sequence');");
        check(`${name} hiding the map clears hover`, hoveredBeforeHide && await s.exec(`return ${noHover};`));
        await s.exec("window.__strandivo.command('show-map');");
        await move(label());
        const hoveredBeforeToggle = await hoverIs("a", 0);
        await s.exec("Array.from(document.querySelectorAll('.sv-map .sv-chip')).find(b => b.textContent.trim() === 'Regions').click();");
        check(`${name} hiding regions clears hover and preserves CDSs`, hoveredBeforeToggle && await s.exec(`return ${noHover} && document.querySelectorAll('.sv-map-feature').length > 0;`));
        await s.exec("Array.from(document.querySelectorAll('.sv-map .sv-chip')).find(b => b.textContent.trim() === 'Regions').click();");
        await control("Label size", "8");
      }
      await move(label());
      const hoveredBeforeLeave = await hoverIs("a", 0);
      await s.pointer([pointerTo([5, 5])]);
      check(`${name} leaving the map clears hover`, hoveredBeforeLeave && await s.exec(`return ${noHover};`));
    }
  } finally {
    await s.exec("window.__mapRegionTest.off?.(); if ('menu' in window.__mapRegionTest) window.__strandivoMenu = window.__mapRegionTest.menu; window.__strandivo.store.undo();");
    const saved = await s.exec("const t = window.__mapRegionTest; return { regions: t.regions, detail: t.detail, linear: t.linear, labelSize: t.labelSize, rotation: t.rotation };");
    await control("Label size", saved.labelSize);
    await control("Rotate", saved.rotation);
    await control("Protein region detail", saved.detail);
    await mode(saved.linear);
    if (!saved.regions) await s.exec("Array.from(document.querySelectorAll('.sv-map .sv-chip')).find(b => b.textContent.trim() === 'Regions').click();");
    await s.exec("delete window.__mapRegionTest;");
  }
}
