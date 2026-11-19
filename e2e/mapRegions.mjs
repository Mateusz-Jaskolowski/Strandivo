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
  // A region's stripe along its CDS: a group of the stripe drawn and a wider one to point at.
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
          getComputedStyle(el.previousElementSibling).fill === getComputedStyle(document.querySelector(arguments[1]).querySelector('.sv-map-stripe')).fill &&
          el.previousElementSibling.matches('.sv-map-swatch[data-region="0"]') &&
          Array.from(document.querySelectorAll('.sv-map-label-feature')).every(e => getComputedStyle(e).fontWeight === '600') &&
          el.querySelector('title').textContent === 'Shared domain · Domain, predicted · 15–190 · region of Protein A' &&
          document.querySelector(arguments[1]).querySelector('title').textContent === el.querySelector('title').textContent;
      `, label(), band());
      check(`${name} map region labels are quiet, readable and name their owning protein`, styles);
      // Inside the CDS, where cut sites' ticks and leaders never cover them.
      check(`${name} region stripes lie within their CDS`, await s.exec(`
        const stripes = Array.from(document.querySelectorAll('.sv-map-region .sv-map-stripe'));
        return stripes.length > 2 && stripes.every(st => {
          const b = st.getBBox(), id = st.closest('.sv-map-region').dataset.id;
          return Array.from(document.querySelectorAll('.sv-map-feature[data-id="' + id + '"]')).some(p => {
            const c = p.getBBox();
            return b.x >= c.x - 0.5 && b.y >= c.y - 0.5 && b.x + b.width <= c.x + c.width + 0.5 && b.y + b.height <= c.y + c.height + 0.5;
          });
        });
      `));
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
      check(`${name} selected region leaders keep their stronger accent stroke`, await s.exec(`
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
        // Right-clicks and drags are dispatched in the page, as elsewhere in the suite: after
        // a WebDriver right-click on the map, WebKitWebDriver's mouse no longer reached the
        // page, so every later hover and click in the desktop run failed.
        const at = await move(label());
        await s.exec(`
          const [x, y] = arguments[1], el = document.querySelector(arguments[0]);
          const init = { bubbles: true, cancelable: true, composed: true, button: 2, clientX: x, clientY: y };
          el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 2 }));
          el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('contextmenu', { ...init, buttons: 0 }));
        `, label(), at);
        check(`${name} right-clicking a region keeps its own actions`, await s.waitFor(`
          window.__strandivo.store.selection.focus?.region === 0 &&
          window.__mapRegionTest.entries?.some(e => e.label === 'Edit region…')
        `, 3000));
        await s.exec("window.__strandivoMenu = window.__mapRegionTest.menu; window.__strandivo.store.select({ range: null }, 'e2e');");
        const from = await move(label());
        // The capture is stubbed, as this pointer isn't real.
        const dragged = await s.exec(`
          const [x, y] = arguments[1], el = document.querySelector(arguments[0]);
          const host = document.querySelector('.sv-map-svg'), store = window.__strandivo.store;
          host.setPointerCapture = host.releasePointerCapture = () => {};
          const at = (type, dx, buttons) => el.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
            button: type === 'pointermove' ? -1 : 0, buttons, clientX: x - dx, clientY: y + dx }));
          try {
            at('pointerdown', 0, 1);
            at('pointermove', 8, 1);
            at('pointermove', 15, 1);
            const quiet = ${noHover};
            at('pointerup', 15, 0);
            return quiet && !!store.selection.range && !store.selection.focus;
          } finally {
            delete host.setPointerCapture;
            delete host.releasePointerCapture;
          }
        `, label(), from);
        check(`${name} dragging suppresses region hover`, dragged);
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
    await checkCrowdedLinearMap(s, check, control, move);
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

/** A crowded CDS and neighbouring labels on pUC19, with its own restriction sites. */
async function checkCrowdedLinearMap(s, check, control, move) {
  const source = '[aria-label="Which map enzymes to show"] [data-value]';
  const filter = "Map cut-site filter";
  const saved = await s.exec(`
    const store = window.__strandivo.store;
    const buttons = Array.from(document.querySelectorAll('.sv-map .sv-chip'));
    const toggled = buttons.filter(b => ['Features', 'Primers', 'Cut sites'].includes(b.textContent.trim()) &&
      b.getAttribute('aria-pressed') === 'false').map(b => b.textContent.trim());
    const options = {
      toggled,
      source: document.querySelector(arguments[0] + '[aria-checked="true"]').dataset.value,
      filter: document.querySelector('[aria-label="Map cut-site filter"]').value,
      labelSize: document.querySelector('[aria-label="Label size"]').value,
      zoom: document.querySelector('[aria-label="Zoom"]').value
    };
    const annotations = ['CAP binding site', 'lac promoter', 'lac operator', 'RBS'].map((name, i) =>
      ({ id: 'short-' + i, name, type: 'misc_feature', start: 8 * i, end: 8 * i + 6, strand: 1, raw: {}, notes: {} }));
    const cds = { id: 'crowded-cds', name: 'Example CDS', type: 'CDS', start: 32, end: 600, strand: 1, raw: {},
      notes: { strandivo_regions: ['First region|Domain|12-19', 'Second region|Domain|21-26', 'Third region|Domain|28-37'] } };
    const primer = (id, name, start, end, strand) => {
      const seq = store.data.sequence;
      const site = start <= end ? seq.slice(start, end + 1) : seq.slice(start) + seq.slice(0, end + 1);
      const bases = strand === 1 ? site : [...site].reverse().map(b => ({ A: 'T', T: 'A', C: 'G', G: 'C' })[b] || b).join('');
      return { id, name, start, end, strand, bases, notes: {}, raw: {} };
    };
    const primers = [
      primer('crowded-f', 'Forward primer with a long name', 18, 40, 1),
      primer('crowded-r', 'Reverse primer with a long name', 53, 76, -1),
      primer('overlap', 'Overlapping primer', 25, 45, -1),
      primer('wrap-primer', 'Primer across the origin', store.length - 24, 3, 1)
    ];
    store.apply({ ...store.data, features: [...annotations, cds], primers }, 'Crowded linear map fixture');
    store.select({ range: null }, 'e2e');
    for (const name of toggled) buttons.find(b => b.textContent.trim() === name).click();
    document.querySelector(arguments[0] + '[data-value="common"]').click();
    return options;
  `, source);
  try {
    await control(filter, "unique6");
    await control("Zoom", "0");
    await control("Label size", "8");
    const drawn = await s.exec(`
      const line = (id, type) => document.querySelector('.sv-map-leader-' + type + '[data-id="' + id + '"]');
      const marks = (id, kind) => Array.from(document.querySelectorAll('[data-kind="' + kind + '"][data-id="' + id + '"]:is(path, line, g)'));
      const forward = marks('crowded-f', 'primer')[0].getBBox();
      const reverse = marks('crowded-r', 'primer')[0].getBBox();
      const overlap = marks('overlap', 'primer')[0].getBBox();
      const paths = marks('wrap-primer', 'primer');
      const wrap = line('wrap-primer', 'primer').points.getItem(0);
      const ticks = [...document.querySelectorAll('.sv-map-cut line[data-id]:not([data-cut-group])')];
      return {
        features: ['short-0', 'short-1', 'short-2', 'short-3'].every(id => line(id, 'feature')?.points.numberOfItems >= 3),
        regions: document.querySelectorAll('.sv-map-leader-region[data-id="crowded-cds"]').length === 3,
        arrows: forward.y === reverse.y && forward.y !== overlap.y &&
          paths.length === 2 && paths.some(p => {
            const b = p.getBBox(); return wrap.x >= b.x - .1 && wrap.x <= b.x + b.width + .1 && Math.abs(wrap.y - b.y) < .1;
          }),
        cuts: ticks.length >= 5 && ticks.every(tick => {
          const start = line(tick.dataset.id, 'cutsite').points.getItem(0);
          return Math.abs(start.x - tick.x1.baseVal.value) < .1 && Math.abs(start.y - tick.y1.baseVal.value) < .1;
        })
      };
    `);
    check("Crowded linear features and protein regions get anchored labels", drawn.features && drawn.regions, JSON.stringify(drawn));
    check("Linear primer arrows pack by binding overlap and draw both pieces across the origin", drawn.arrows);
    check("Linear enzyme leaders start at their own cut ticks", drawn.cuts);
    await s.shot("map-linear-crowded");
    for (const [size, zoom] of [["8", "0"], ["16", "20"]]) {
      await control("Label size", size);
      await control("Zoom", zoom);
      const collision = await s.exec(`
        const svg = document.querySelector('.sv-map-svgel');
        const bounds = svg.getBoundingClientRect();
        const boxes = [...svg.parentElement.querySelectorAll('.sv-map-linear-names > *, .sv-map-cut-group')].map(e =>
          ({ e, box: e.getBoundingClientRect() }));
        for (const [i, { e, box: a }] of boxes.entries()) {
          if (a.left < bounds.left || a.right > bounds.right)
            return { outside: e.dataset.id, x: a.x, width: a.width };
          const hit = boxes.slice(i + 1).find(({ e: other, box: b }) => {
            // A feature's chip is its background, so it deliberately contains its own text.
            if (e.dataset.id && e.dataset.id === other.dataset.id && e.dataset.region === other.dataset.region) return false;
            return a.x + a.width > b.x && b.x + b.width > a.x && a.y + a.height > b.y && b.y + b.height > a.y;
          });
          if (hit) return { ids: [e.dataset.id, hit.e.dataset.id], boxes: [a, hit.box].map(b => [b.x, b.y, b.width, b.height]) };
        }
        return null;
      `);
      check(`Crowded linear labels fit at label size ${size}`, !collision, JSON.stringify(collision));
    }
    await control("Label size", "8");
    await control("Zoom", "0");
    for (const [kind, id] of [["primer", "crowded-r"], ["feature", "short-0"], ["cutsite", null]]) {
      const selector = `.sv-map-linear-names text[data-kind="${kind}"]${id ? `[data-id="${id}"]` : ""}`;
      await move(selector);
      const width = await s.exec("return document.querySelector(arguments[0]).getBBox().width;", selector);
      await s.pointer([{ type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }], { release: true });
      check(`Clicking a displaced linear ${kind} label selects its mark`, await s.exec(`
        const label = document.querySelector(arguments[0]);
        const focus = window.__strandivo.store.selection.focus;
        return focus?.kind === label.dataset.kind && focus.id === label.dataset.id &&
          label.classList.contains('sv-focused') && label.getBBox().width === arguments[1];
      `, selector, width));
    }
    const group = await s.exec(`
      const key = document.querySelector('.sv-map-cut line[data-id="AvaI@411"]').dataset.cutGroup;
      const ticks = [...document.querySelectorAll('.sv-map-cut line[data-cut-group="' + key + '"]')];
      const xs = ticks.map(t => t.x1.baseVal.value);
      return {
        key, ids: ticks.map(t => t.dataset.id),
        close: Math.max(...xs) - Math.min(...xs) <= 1.01,
        separatedCut: !!document.querySelector('.sv-map-cut line[data-id="AccI@428"][data-cut-group]')
      };
    `);
    const count = `.sv-map-cut-group[data-cut-group="${group.key}"]`;
    const choice = '.sv-map-cut-site-choice';
    await s.exec("document.querySelector(arguments[0]).focus();", count);
    await s.press("\uE007"); // Enter on the count button.
    check("A linear cut-site count opens a keyboard-accessible list of its own ticks", group.close && await s.exec(`
      const rows = [...document.querySelectorAll(arguments[0])];
      return rows.length >= 3 && rows.map(b => b.dataset.site).join() === arguments[1].join() &&
        rows.some(b => b.dataset.site === 'XmaI@411' && b.textContent.includes('After base 412'));
    `, choice, group.ids));
    await move(`${choice}[data-site="XmaI@411"]`);
    await s.pointer([{ type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }], { release: true });
    check("Choosing a grouped site selects its enzyme and highlights the count", await s.exec(`
      const focus = window.__strandivo.store.selection.focus;
      return focus?.kind === 'cutsite' && focus.id === 'XmaI@411' &&
        !document.querySelector('.sv-map-cut-site-choice') &&
        document.querySelector(arguments[0]).classList.contains('sv-focused');
    `, count));
    await move(count);
    await s.pointer([{ type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }], { release: true });
    check("Picking from the cut-site list keeps both picked enzymes", await s.exec(`
      const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      document.querySelector('.sv-map-cut-site-choice[data-site="KpnI@407"]').dispatchEvent(
        new MouseEvent('click', { bubbles: true, [mac ? 'metaKey' : 'ctrlKey']: true }));
      return window.__strandivo.store.selection.enzymes?.slice().sort().join() === 'KpnI,XmaI';
    `));
    await control("Zoom", "100");
    check("Zooming in restores a name for a separated tick and keeps identical cuts grouped", group.separatedCut && await s.exec(`
      return !!document.querySelector('.sv-map-label-cut[data-id="AccI@428"]') &&
        !!document.querySelector('.sv-map-cut line[data-id="XmaI@411"][data-cut-group]');
    `));
  } finally {
    await s.exec(`
      window.__strandivo.store.undo();
      const buttons = Array.from(document.querySelectorAll('.sv-map .sv-chip'));
      for (const name of arguments[0]) buttons.find(b => b.textContent.trim() === name).click();
      document.querySelector(arguments[1] + '[data-value="' + arguments[2] + '"]').click();
    `, saved.toggled, source, saved.source);
    await control(filter, saved.filter);
    await control("Label size", saved.labelSize);
    await control("Zoom", saved.zoom);
  }
}
