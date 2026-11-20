// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Shared checks of the map as an image, in WebKitGTK (desktop) and Chrome (web): the whole
// map whatever the view's zoom, at its rotation, with nothing selected, in any theme, every
// label inside the picture, and a transparent background when asked; the PNG's pixels and
// resolution; a feature in parts with its introns cut out; and the Export image menu itself
// (its place in a narrow header, Escape, a choice shared by open tabs).

/** Opens the map's Export image menu, if it isn't open, and says whether it shows. */
export function openMapImageMenu(s) {
  return s.exec(`
    const b = Array.from(document.querySelectorAll('.sv-map .sv-pane-head button')).find(b => b.textContent.includes('Export image'));
    if (b.getAttribute('aria-expanded') !== 'true') b.click();
    const menu = document.querySelector('.sv-map-image')?.closest('.sv-chip-menu');
    return !!menu && !menu.hidden;
  `);
}

/**
 * Whether a saved SVG stands alone: every style its own, nothing only the page understood, and
 * its root declaring the SVG namespace, as another program needs to open it (in whatever order
 * the browser writes the root's attributes).
 */
export const standaloneSvg = svg => typeof svg === "string" && /^<\?xml[^>]*\?>\s*<svg\b[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg) && / viewBox="/.test(svg) && !/ class="| style="| data-|var\(|color-mix/.test(svg);

/**
 * A saved PNG with at least a hundredth of its pixels inked. A map is thin lines (about 6% of
 * pUC19's), so this is far below what is drawn, and a blank PNG of the right size has none.
 */
export const inked = png => !!png && png.ink >= 0.01 * png.width * png.height;

/** Opaque to its last pixel: a map on paper has no clear corner, last column or last row. */
export const opaqueToEdge = png => !!png && png.cornerAlpha === 255 && png.lastColumnOpaque === true && png.lastRowOpaque === true;

/**
 * Whether a PNG's resolution fits the SVG saved with it, which is the same figure: 96 dpi for
 * each pixel the SVG is wide, so 96 times the PNG's width over the SVG's. The PNG's width is
 * the figure's rounded to whole pixels, up to half a pixel off (48 / the SVG's width, in dpi),
 * and the file keeps whole pixels per metre (0.02 dpi covers that). run.mjs and web.mjs say
 * the same of the gel.
 */
export function resolutionFits(png, svg) {
  const svgWidth = Number(/<svg\b[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1]);
  const wanted = (96 * png?.width) / svgWidth;
  const within = 48 / svgWidth + 0.02;
  return {
    ok: typeof png?.dotsPerInch === "number" && Math.abs(png.dotsPerInch - wanted) <= within,
    detail: `${png?.dotsPerInch?.toFixed(2)} dpi in the file, ${wanted.toFixed(2)} from ${png?.width} px over the SVG's ${svgWidth}, within ${within.toFixed(2)}`
  };
}

/**
 * A forward gene of `n` bases in three parts with two introns of about a tenth of it, over
 * the large features of pUC19 (its origin and AmpR), where no small feature's leader crosses
 * its band. Run in the page too, so it uses nothing outside itself.
 */
export function splitFeature(n) {
  const at = fraction => Math.floor(fraction * n);
  const locations = [
    { start: at(0.28), end: at(0.4) - 1 },
    { start: at(0.5), end: at(0.62) - 1 },
    { start: at(0.7), end: at(0.84) - 1 }
  ];
  return { id: "e2e-split-gene", name: "Split gene", type: "gene", start: locations[0].start, end: locations[2].end, strand: 1, locations, color: "#7a2bd6", notes: {}, raw: {} };
}

/**
 * Where to look in a circular map's image for a feature in parts: three points along each
 * intron, which the clip path cuts out, and along each part, which stays, in the SVG's own
 * units. They lie 1.5 units inside the band's outer edge, clear of the name along its middle,
 * the thin line across an intron and the backbone. The clip path's holes fix them: the first
 * says where the map is turned, and `off` lists any hole that isn't where its intron is, or
 * a turn other than `rotation`, the one the map was set to. `d` is the clip path's data, as
 * the map draws it: two circles, then a hole for each intron.
 */
export function splitProbes({ d, feature, n, rotation: wanted }) {
  const shapes = String(d).split(/z/i).map(p => (p.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? []).map(Number)).filter(p => p.length);
  const parts = feature.locations;
  const gaps = parts.slice(0, -1).map((p, i) => ({ start: p.end + 1, end: parts[i + 1].start - 1 }));
  const holes = shapes.slice(2);
  if (holes.length !== gaps.length || holes.some(h => h.length !== 18)) return { why: `a clip path of ${shapes.length} shapes, its holes of ${holes.map(h => h.length).join("+") || "no"} numbers, for ${gaps.length} introns (two circles and a hole of 18 numbers each expected)` };
  const degrees = base => (base / n) * 360;
  const angle = (x, y) => ((((Math.atan2(x, -y) * 180) / Math.PI) % 360) + 360) % 360;
  const turn = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;
  const rotation = angle(holes[0][0], holes[0][1]) - degrees(gaps[0].start);
  const off = [];
  if (wanted !== undefined && Math.abs(turn(rotation, wanted)) > 0.15) off.push(`the first hole puts the map's turn at ${(((rotation % 360) + 360) % 360).toFixed(2)}°, not ${wanted}°`);
  holes.forEach((h, i) => {
    const start = angle(h[0], h[1]);
    const span = (((angle(h[7], h[8]) - start) % 360) + 360) % 360;
    const wantStart = rotation + degrees(gaps[i].start);
    const wantSpan = degrees(gaps[i].end + 1 - gaps[i].start);
    if (Math.abs(turn(start, wantStart)) > 0.15 || Math.abs(span - wantSpan) > 0.3) off.push(`hole ${i + 1} starts at ${start.toFixed(2)}° and spans ${span.toFixed(2)}°, its intron at ${(((wantStart % 360) + 360) % 360).toFixed(2)}° and ${wantSpan.toFixed(2)}°`);
  });
  const radius = holes[0][2] - 2;
  const point = base => {
    const a = ((rotation + degrees(base)) * Math.PI) / 180;
    return [radius * Math.sin(a), -radius * Math.cos(a)];
  };
  const along = ({ start, end }) => [0.3, 0.5, 0.7].map(f => point(start + (end + 1 - start) * f));
  return { rotation, radius, off, gaps: gaps.map(along), exons: parts.map(along) };
}

/**
 * Whether the pixels sampled at `probe`'s points (`sampled.at`, in the probe's order) show
 * its introns clear and its parts painted. Two of three at each is enough: a leader or a
 * name can cross one point.
 */
export function splitVerdict(probe, sampled) {
  const at = sampled?.at ?? [];
  let next = 0;
  const count = (groups, wanted) => groups.map(g => at.slice(next, (next += g.length)).filter(wanted).length);
  const clear = count(probe.gaps, m => m.max === 0);
  const painted = count(probe.exons, m => m.min >= 128);
  const enough = counts => counts.length > 0 && counts.every(c => c >= 2);
  return { clear, painted, ok: at.length === probe.gaps.flat().length + probe.exons.flat().length && enough(clear) && enough(painted) };
}

/**
 * Runs on an open circular document showing its map, and leaves the map, its tabs, the theme
 * and the file's data as it found them (the last check says so). It adds a feature and a second
 * tab and changes the theme on the way, each put back by the block that made the change.
 * `save(label)` clicks the open menu's button `label` and gives back what it saved: the
 * SVG's text, or the PNG as `{ png, width, height, dpi }` with what its pixels say
 * (`dotsPerInch`, `cornerAlpha`, `lastColumnOpaque`, `lastRowOpaque`, `ink`).
 */
export async function checkMapImage(s, check, save) {
  const control = (name, value) => s.exec(`
    const el = document.querySelector('[aria-label="' + arguments[0] + '"]');
    el.value = arguments[1];
    el.dispatchEvent(new Event('input', { bubbles: true }));
  `, name, value);
  const mode = linear => s.exec(`
    Array.from(document.querySelectorAll('.sv-map .sv-segmented button')).find(b => b.textContent === arguments[0]).click();
  `, linear ? "Linear" : "Circular");
  const transparent = on => s.exec(`
    const box = document.querySelector('.sv-map-image input[type="checkbox"]');
    if (box.checked !== arguments[0]) { box.checked = arguments[0]; box.dispatchEvent(new Event('change')); }
  `, on);
  const saveWith = async label => {
    await openMapImageMenu(s);
    return save(label);
  };
  const closeMenu = () => s.exec(`
    const b = Array.from(document.querySelectorAll('.sv-map .sv-pane-head button')).find(b => b.textContent.includes('Export image'));
    if (b && b.getAttribute('aria-expanded') === 'true') b.click();
  `);
  // Each block below puts back what it changed; one that throws fails by name and lets the rest run.
  const attempt = async (name, run) => {
    try {
      await run();
    } catch (e) {
      check(name, false, `threw: ${String(e?.message ?? e).slice(0, 300)}`);
    }
  };
  // Every text and line of the saved SVG measured where another program draws it.
  const outside = svg => s.exec(`
    const el = document.importNode(new DOMParser().parseFromString(arguments[0], 'image/svg+xml').documentElement, true);
    el.style.cssText = 'position:fixed;left:-30000px;top:0';
    document.body.appendChild(el);
    const vb = el.viewBox.baseVal;
    const geometry = n => { for (let p = n; p; p = p.parentElement) if (p.localName === 'defs' || p.localName === 'clipPath') return true; return false; };
    const out = [];
    for (const t of el.querySelectorAll('text, polyline, line, path, rect')) {
      if (geometry(t)) continue;
      const b = t.getBBox();
      if (b.x < vb.x - 0.5 || b.y < vb.y - 0.5 || b.x + b.width > vb.x + vb.width + 0.5 || b.y + b.height > vb.y + vb.height + 0.5) out.push(t.localName + ' ' + (t.textContent || '').slice(0, 20));
    }
    el.remove();
    return out;
  `, svg);
  // What the checks change and put back, read now and again at the end.
  const snapshot = () => s.exec(`
    return { zoom: document.querySelector('[aria-label="Zoom"]').value, rotate: document.querySelector('[aria-label="Rotate"]').value,
      linear: document.querySelector('.sv-map .sv-segmented button[aria-pressed="true"]').textContent === 'Linear',
      transparent: document.querySelector('.sv-map-image input[type="checkbox"]').checked,
      tabs: window.__strandivo.tabs().length, tab: window.__strandivo.activeTab(),
      features: window.__strandivo.store.data.features.length, theme: document.documentElement.dataset.theme };
  `);
  const saved = await snapshot();
  // The file's data, by identity: an edit made and undone leaves the very same object.
  await s.exec("window.__e2eMapImageData = window.__strandivo.store.data;");
  try {
    await mode(false);
    check("The map's Export image opens a menu with a transparent background, Copy image and the saves", (await openMapImageMenu(s)) && (await s.exec(`
      const menu = document.querySelector('.sv-map-image');
      return /Transparent background/.test(menu.textContent) && Array.from(menu.querySelectorAll('button')).map(b => b.textContent).join() === 'Copy image,Save as PNG…,Save as SVG…';
    `)));
    // Zoomed right in, turned, scrolled and with a feature selected: the image is still the
    // whole map at that angle, with nothing selected.
    await control("Zoom", "100");
    await control("Rotate", "100");
    const view = await s.exec(`
      const store = window.__strandivo.store;
      const f = store.data.features[0];
      store.selectRange({ start: f.start, end: f.end }, { kind: 'feature', id: f.id }, 'e2e');
      document.querySelector('.sv-map-area').scrollTo(400, 300);
      return {
        paths: Array.from(document.querySelectorAll('.sv-map .sv-map-feature')).map(p => p.getAttribute('d')),
        labels: Array.from(document.querySelectorAll('.sv-map .sv-map-label')).map(t => t.firstChild.textContent),
        focused: document.querySelectorAll('.sv-map .sv-focused').length
      };
    `);
    const svg = await saveWith("Save as SVG");
    const missing = [...view.paths.filter(d => !svg.includes(`d="${d}"`)), ...view.labels.filter(t => !svg.includes(`>${t}<`))];
    check(
      "Save as SVG… saves the whole circular map at its rotation, every feature and label in it",
      standaloneSvg(svg) && /<title>Circular map of /.test(svg) && view.paths.length > 0 && view.labels.length > 0 && !missing.length,
      `${missing.length} missing: ${missing.slice(0, 3).join(" | ").slice(0, 200)}`
    );
    check("Nothing selected on screen comes along", view.focused > 0 && !svg.includes("#3557d6"), `${view.focused} shapes selected on screen`);
    const out = await outside(svg);
    check("No label or leader of the circular map falls outside the image", !out.length, out.slice(0, 5).join(" | "));
    check("Its background is white unless asked otherwise", /<\/title><rect [^>]*fill="#ffffff"/.test(svg));
    const png = await saveWith("Save as PNG");
    check("Save as PNG… saves the map about 3,000 pixels across, with its resolution", png?.png && Math.max(png.width, png.height) >= 2500 && png.dpi, JSON.stringify(png));
    check("The map's PNG has the map drawn on it, not only the paper", inked(png), JSON.stringify(png));
    check("The map's PNG is opaque to its last column and row, as its paper covers all of it", opaqueToEdge(png), JSON.stringify(png));
    const fit = resolutionFits(png, svg);
    check("The map's PNG says the resolution that sets it at the SVG's size", fit.ok, fit.detail);
    await transparent(true);
    const clear = await saveWith("Save as SVG");
    check("With Transparent background ticked, the image has none", standaloneSvg(clear) && !/<\/title><rect [^>]*fill="#ffffff"/.test(clear));

    // A feature in parts has its introns cut out of its band, as a transparent image shows.
    // Copy image gives the pixels: what it puts on the clipboard is read back in the page.
    await attempt("Checking the map's image of a feature in parts finished without errors", async () => {
      const LABEL = "Gene in parts for the map image";
      const added = await s.exec(`
        const store = window.__strandivo.store;
        const n = store.data.sequence.length;
        const feature = (${splitFeature.toString()})(n);
        store.apply({ ...store.data, features: [...store.data.features, feature] }, '${LABEL}');
        return { n, feature, rotation: Number(document.querySelector('[aria-label="Rotate"]').value) };
      `);
      try {
        const found = await s.exec(`
          const doc = new DOMParser().parseFromString(arguments[0], 'image/svg+xml').documentElement;
          const box = (doc.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number);
          const clips = Array.from(doc.querySelectorAll('clipPath'))
            .filter(c => Array.from(c.children).some(p => p.getAttribute('clip-rule') === 'evenodd'))
            .map(c => ({ id: c.getAttribute('id'), d: Array.from(c.children).map(p => p.getAttribute('d') || '').join(' ') }));
          const users = Array.from(doc.querySelectorAll('[clip-path]'))
            .map(e => ({ clip: e.getAttribute('clip-path').replace(/^url\\(#(.*)\\)$/, '$1'), tag: e.localName }))
            .filter(u => clips.some(c => c.id === u.clip));
          return { box, clips, users };
        `, await saveWith("Save as SVG"));
        // The clip path whose holes are this gene's introns: another feature in parts would have its own.
        const tried = found.clips.map(c => ({ clip: c, probe: splitProbes({ d: c.d, feature: added.feature, n: added.n, rotation: added.rotation }) }));
        const chosen = tried.find(t => !t.probe.why && !t.probe.off.length) ?? tried.find(t => !t.probe.why) ?? tried[0];
        const clip = chosen?.clip;
        const probe = chosen?.probe ?? { why: "no clip path with clip-rule evenodd in the SVG" };
        const user = clip && found.users.find(u => u.clip === clip.id);
        const plural = found.clips.length === 1 ? "clip path" : "clip paths";
        check(
          "A feature in parts is saved with its introns cut out by a clip path, where they are",
          !!clip && !!user && !probe.why && !probe.off.length,
          probe.why ?? (probe.off.length ? probe.off.join(" | ") : user ? `${found.clips.length} ${plural} with clip-rule evenodd, the gene's used by a ${user.tag}; the map is turned ${(((probe.rotation % 360) + 360) % 360).toFixed(1)}°` : `${found.clips.length} ${plural} with clip-rule evenodd, but no shape uses the gene's`)
        );
        if (!clip || !user || probe.why) return;

        // Copy image, put on the clipboard within the click, as a browser lets a page copy only then.
        // The real clipboard is a getter on Navigator.prototype, so a property of our own shadows it until it is deleted.
        await openMapImageMenu(s);
        const copied = await s.exec(`window.__e2eMapCopied = null;
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: items => { window.__e2eMapCopied = Array.from(items); return Promise.resolve(); } } });
          const button = Array.from(document.querySelectorAll('.sv-map-image button')).find(b => b.textContent.includes('Copy image'));
          button?.click();
          const items = window.__e2eMapCopied;
          return { found: !!button, inClick: !!items, items: items ? items.length : 0, types: items ? items.map(i => Array.from(i.types)) : [] };`);
        check("Copy image puts the map on the clipboard as one PNG, within the click that asked", copied.found && copied.inClick && copied.items === 1 && copied.types[0].includes("image/png"), JSON.stringify(copied));
        const sampled = await s.execAsync(`
          const finish = arguments[arguments.length - 1];
          const box = arguments[0], points = arguments[1];
          const item = window.__e2eMapCopied && window.__e2eMapCopied[0];
          if (!item) return finish({ error: 'nothing was copied' });
          (async () => {
            const bytes = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
            const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const g = canvas.getContext('2d');
            g.drawImage(image, 0, 0);
            image.close();
            const out = { width: canvas.width, height: canvas.height, corner: g.getImageData(0, 0, 1, 1).data[3], signature: Array.from(bytes.slice(0, 8)), at: [] };
            for (const [x, y] of points) {
              const px = Math.round((x - box[0]) * canvas.width / box[2]);
              const py = Math.round((y - box[1]) * canvas.height / box[3]);
              const data = g.getImageData(px - 2, py - 2, 5, 5).data;
              let min = 255, max = 0;
              for (let i = 3; i < data.length; i += 4) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
              out.at.push({ px, py, min, max });
            }
            return out;
          })().then(finish, e => finish({ error: String(e) }));
        `, found.box, [...probe.gaps.flat(), ...probe.exons.flat()]);
        const verdict = splitVerdict(probe, sampled);
        check(
          "In a transparent PNG of the map, the introns of a feature in parts are clear and its parts painted",
          !sampled.error && JSON.stringify(sampled.signature) === "[137,80,78,71,13,10,26,10]" && sampled.corner === 0 && verdict.ok,
          sampled.error ?? `introns clear at ${verdict.clear.join("/")} of 3 points each, parts painted at ${verdict.painted.join("/")}, corner alpha ${sampled.corner}, ${sampled.width}×${sampled.height} px`
        );
      } finally {
        await s.exec(`delete navigator.clipboard; delete window.__e2eMapCopied;
          const store = window.__strandivo.store;
          if (store.undoLabel === arguments[0]) store.undo();`, LABEL);
      }
    });
    await transparent(false);

    // The linear map is drawn at a width of its own: the same image at any zoom.
    await mode(true);
    const wide = await saveWith("Save as SVG");
    await control("Zoom", "0");
    const fitted = await saveWith("Save as SVG");
    const same = a => a.replace(/sv-export-\d+-/g, "");
    check("Save as SVG… saves the whole linear map, the same at any zoom", standaloneSvg(fitted) && /<title>Linear map of /.test(fitted) && same(wide) === same(fitted), (/viewBox="[^"]*"/.exec(wide) ?? [""])[0] + " vs " + (/viewBox="[^"]*"/.exec(fitted) ?? [""])[0]);
    const outLinear = await outside(fitted);
    check("No label or leader of the linear map falls outside the image", !outLinear.length, outLinear.slice(0, 5).join(" | "));

    // Crowded cut sites share a count, drawn as a pill. A text takes its group's baseline in
    // Chrome but not in WebKit, so each pill's text has to say it in the saved SVG.
    await attempt("Checking the linear map's cut-count pills finished without errors", async () => {
      const pills = await s.exec(`
        const doc = new DOMParser().parseFromString(arguments[0], 'image/svg+xml').documentElement;
        return Array.from(doc.querySelectorAll('text'))
          .filter(t => /^[\\d,]+ sites$/.test(t.textContent.trim()))
          .map(t => ({
            text: t.textContent.trim(),
            pill: !!t.parentElement && t.parentElement.localName === 'g' && Array.from(t.parentElement.children).some(c => c.localName === 'rect'),
            baseline: t.getAttribute('dominant-baseline')
          }));
      `, fitted);
      const wrong = pills.filter(p => !p.pill || p.baseline !== "central");
      check(
        "A cut-count pill of the linear map is saved with its text centred on its box",
        pills.length > 0 && !wrong.length,
        pills.length
          ? `${pills.length} pills (${pills.slice(0, 4).map(p => p.text).join(", ")}), ${wrong.length} without dominant-baseline="central" on its text${wrong.length ? `: ${wrong.slice(0, 3).map(p => `${p.text} ${p.pill ? `has ${p.baseline ?? "none"}` : "is not in a group with a box"}`).join(" | ")}` : ""}`
          : "no cut-count pill in the linear SVG, so no two cut ticks fell within a pixel of each other and its baseline wasn't tested"
      );
    });

    // Selected on screen, a feature is still plain in the image, as in the circular map's.
    await attempt("Checking that a selection stays out of the linear map's image finished without errors", async () => {
      const focused = await s.exec(`
        const store = window.__strandivo.store;
        const f = store.data.features[0];
        store.selectRange({ start: f.start, end: f.end }, { kind: 'feature', id: f.id }, 'e2e');
        return document.querySelectorAll('.sv-map .sv-focused').length;
      `);
      const selectedSvg = await saveWith("Save as SVG");
      check("Nothing selected on screen comes along in the linear map either", focused > 0 && standaloneSvg(selectedSvg) && !selectedSvg.includes("#3557d6"), `${focused} shapes selected on screen`);
    });
    const pngLinear = await saveWith("Save as PNG");
    check("The linear map's PNG has the map drawn on it, not only the paper", inked(pngLinear), JSON.stringify(pngLinear));
    check("The linear map's PNG is opaque to its last column and row, as its paper covers all of it", opaqueToEdge(pngLinear), JSON.stringify(pngLinear));
    const fitLinear = resolutionFits(pngLinear, fitted);
    check("The linear map's PNG says the resolution that sets it at the SVG's size", fitLinear.ok, fitLinear.detail);
    await transparent(true);
    const clearLinear = await saveWith("Save as PNG");
    await transparent(false);
    check("With Transparent background ticked, the linear map's PNG has a clear corner and the map drawn on it", !!clearLinear && clearLinear.cornerAlpha === 0 && inked(clearLinear), JSON.stringify(clearLinear));

    // Whether the background is transparent is the app's choice, not a file's: whichever tab
    // sets it, another tab's menu shows it as it stands when opened, and its SVG follows.
    // Each tab is left unticked by a person's own click, so a menu that kept showing what it
    // last had would answer the wrong way.
    await attempt("Checking Transparent background across two tabs finished without errors", async () => {
      const start = await s.exec("return { tab: window.__strandivo.activeTab(), count: window.__strandivo.tabs().length };");
      const second = start.count;
      const show = async tab => {
        await s.exec("window.__strandivo.showTab(arguments[0]);", tab);
        if (!(await s.waitFor(`window.__strandivo.activeTab() === ${tab} && !!document.querySelector('.sv-map .sv-pane-head')`, 10000))) throw new Error(`tab ${tab} didn't show its map`);
      };
      // Opens this tab's menu and says what its box shows; a click makes it `want` if it isn't.
      const choose = async want => {
        await openMapImageMenu(s);
        return s.exec(`
          const box = document.querySelector('.sv-map-image input[type="checkbox"]');
          const shown = box.checked;
          if (shown !== arguments[0]) box.click();
          return { shown, now: box.checked };
        `, want);
      };
      const shownNow = async () => {
        await openMapImageMenu(s);
        return s.exec("return document.querySelector('.sv-map-image input[type=\"checkbox\"]').checked;");
      };
      const white = svg => standaloneSvg(svg) && /<\/title><rect [^>]*fill="#ffffff"/.test(svg);
      const word = on => (on ? "ticked" : "unticked");
      const said = (tab, r) => `${tab} showed ${word(r.shown)}${r.shown === r.now ? "" : `, then ${word(r.now)}`}`;
      try {
        await s.exec("window.__strandivo.openNew({ ...window.__strandivo.store.data });");
        const ready = await s.waitFor(`window.__strandivo.tabs().length === ${second + 1} && window.__strandivo.tabs()[${second}] !== null && window.__strandivo.activeTab() === ${second} && !!window.__strandivo.store`, 20000);
        if (!ready) throw new Error("the copy of the file didn't open in a second tab");
        await s.exec("window.__strandivo.setView('map');");

        // One tab ticks it, the other unticks it; back in the first, the menu and the SVG say unticked.
        await show(start.tab);
        const a1 = await choose(true);
        await show(second);
        const b1 = await choose(false);
        await show(start.tab);
        const back1 = await shownNow();
        const svg1 = await saveWith("Save as SVG");
        check(
          "Transparent background unticked in a second tab shows unticked in the first tab's menu, and its SVG has the white background",
          a1.now === true && b1.shown === true && b1.now === false && back1 === false && white(svg1),
          `${said("tab 1", a1)}; ${said("tab 2", b1)}; back in tab 1 it shows ${word(back1)} and its SVG ${white(svg1) ? "has" : "lacks"} the white background`
        );

        // And the other way: ticked in the second, unticked in the first.
        await show(second);
        const b2 = await choose(true);
        await show(start.tab);
        const a2 = await choose(false);
        await show(second);
        const b3 = await choose(true);
        await show(start.tab);
        const back2 = await shownNow();
        const svg2 = await saveWith("Save as SVG");
        check(
          "Transparent background ticked in a second tab shows ticked in the first tab's menu, and its SVG has none",
          b2.now === true && a2.shown === true && a2.now === false && b3.shown === false && b3.now === true && back2 === true && standaloneSvg(svg2) && !white(svg2),
          `${said("tab 2", b2)}; ${said("tab 1", a2)}; ${said("tab 2", b3)}; back in tab 1 it shows ${word(back2)} and its SVG ${white(svg2) ? "has" : "lacks"} the white background`
        );
      } finally {
        // The copy was never saved: close it without saving, and go back to the first tab's map.
        await closeMenu();
        if ((await s.exec("return window.__strandivo.tabs().length;")) > second) {
          await s.exec(`window.__strandivo.showTab(${second}); window.__strandivo.closeTab();`);
          await s.waitFor(`!!document.querySelector('.ps-modal') || window.__strandivo.tabs().length === ${second}`, 5000);
          await s.exec("Array.from(document.querySelectorAll('.ps-modal button')).find(b => /Don.t Save/.test(b.textContent))?.click();");
          await s.waitFor(`window.__strandivo.tabs().length === ${second}`, 5000);
        }
        await s.exec(`window.__strandivo.showTab(${start.tab});`);
        await s.waitFor(`window.__strandivo.activeTab() === ${start.tab}`, 5000);
        await s.exec("window.__strandivo.setView('map');");
        await s.waitFor("!!document.querySelector('.sv-map .sv-pane-head')", 5000);
        await openMapImageMenu(s);
        await transparent(saved.transparent);
        await closeMenu();
      }
    });

    // Export image's menu opens leftwards from its button's right edge, so wherever the header
    // wraps, the button has to stay at the right end of its row for the menu to stay in the pane.
    // The header's width is set from 300 px to the one it has with no row to wrap, and the menu
    // is shown (not clicked: opening it moves focus, and focus can scroll its surroundings)
    // and measured at each, all in one script, so nothing is painted or redrawn in between.
    await attempt("Checking Export image's menu at every header width finished without errors", async () => {
      await closeMenu();
      const headState = () => s.exec("return { style: document.querySelector('.sv-map .sv-pane-head').getAttribute('style'), menuHidden: document.querySelector('.sv-map-image').closest('.sv-chip-menu').hidden };");
      const headBefore = await headState();
      const sweep = await s.exec(`
        const head = document.querySelector('.sv-map .sv-pane-head');
        const menu = document.querySelector('.sv-map-image').closest('.sv-chip-menu');
        const style = head.getAttribute('style');
        const hidden = menu.hidden;
        const rows = [];
        let natural = 0;
        const put = () => { if (style === null) head.removeAttribute('style'); else head.setAttribute('style', style); };
        const at = () => {
          const h = head.getBoundingClientRect(), m = menu.getBoundingClientRect();
          rows.push({ width: Math.round(h.width), left: Math.round((m.left - h.left) * 10) / 10, right: Math.round((h.right - m.right) * 10) / 10 });
        };
        try {
          head.style.width = 'max-content';
          natural = Math.ceil(head.getBoundingClientRect().width);
          menu.hidden = false;
          for (let w = 300; w < natural; w += 10) { head.style.width = w + 'px'; at(); }
          head.style.width = natural + 'px';
          at();
          put();
          at();
        } finally {
          menu.hidden = hidden;
          put();
        }
        return { natural, rows };
      `);
      const room = r => Math.min(r.left, r.right);
      const bad = sweep.rows.filter(r => room(r) < -0.5);
      check(
        "Export image's menu stays inside the map's header at every width it can have",
        sweep.rows.length >= 3 && !bad.length,
        bad.length
          ? `at ${bad[0].width} px the menu is ${bad[0].left < -0.5 ? `${-bad[0].left} px left of the header` : `${-bad[0].right} px past its right edge`}; ${bad.length} of ${sweep.rows.length} widths fail`
          : sweep.rows.length < 3
            ? `only ${sweep.rows.length} widths measured: the header needs ${sweep.natural} px to hold its row`
            : `${sweep.rows.length} widths from ${sweep.rows[0].width} to ${sweep.natural} px and the pane's own, the menu at least ${Math.min(...sweep.rows.map(room))} px inside`
      );
      const headAfter = await headState();
      check("The header's width and the menu are put back after the sweep", JSON.stringify(headAfter) === JSON.stringify(headBefore), `${JSON.stringify(headBefore)} before, ${JSON.stringify(headAfter)} after`);
    });

    // Opening the menu takes the keyboard into it, so Escape, which the menu hears, closes it and
    // is not passed on: at the window it would also drop enzymes picked on the map. Done in one
    // script, with a listener on the window to see what gets that far, and taken off after.
    await attempt("Checking Escape in the Export image menu finished without errors", async () => {
      await closeMenu();
      const r = await s.exec(`
        const button = Array.from(document.querySelectorAll('.sv-map .sv-pane-head button')).find(b => b.textContent.includes('Export image'));
        const menu = document.querySelector('.sv-map-image').closest('.sv-chip-menu');
        const box = document.querySelector('.sv-map-image input[type="checkbox"]');
        const reached = [];
        const spy = e => reached.push(e.key);
        window.addEventListener('keydown', spy);
        try {
          button.focus();
          const focusedButton = document.activeElement === button;
          button.click();
          const opened = { shown: !menu.hidden, expanded: button.getAttribute('aria-expanded'), inside: menu.contains(document.activeElement), onBox: document.activeElement === box };
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
          return { focusedButton, opened, closed: { hidden: menu.hidden, expanded: button.getAttribute('aria-expanded'), onButton: document.activeElement === button }, reached };
        } finally {
          window.removeEventListener('keydown', spy);
        }
      `);
      check(
        "Opening Export image's menu from its button takes the keyboard onto its Transparent background box",
        r.focusedButton && r.opened.shown && r.opened.expanded === "true" && r.opened.inside && r.opened.onBox,
        JSON.stringify({ focusedButton: r.focusedButton, ...r.opened })
      );
      check(
        "Escape in Export image's menu closes it, gives the keyboard back to its button and goes no further",
        r.closed.hidden === true && r.closed.expanded === "false" && r.closed.onButton && r.reached.length === 0,
        JSON.stringify({ ...r.closed, reachedTheWindow: r.reached })
      );
      await closeMenu();
    });

    // What is saved doesn't depend on the window's theme: the figure is drawn anew in the light
    // theme. Two saves of the circular map, one in each theme, once the page has been seen to
    // change (a setting of another name is ignored without a word).
    await attempt("Checking the map's SVG in two themes finished without errors", async () => {
      await mode(false);
      const read = () => s.exec(`
        let appearance = null;
        try {
          appearance = JSON.parse(localStorage.getItem('strandivo.settings') || '{}').appearance ?? null;
        } catch (e) {
          appearance = undefined;
        }
        return { theme: document.documentElement.dataset.theme, appearance };
      `);
      const appearance = value => s.exec("window.__strandivo.saveSettings({ appearance: arguments[0] });", value);
      const before = await read();
      const other = before.theme === "dark" ? "light" : "dark";
      const same = a => a.replace(/sv-export-\d+-/g, "");
      const named = r => `${r.theme} (appearance ${r.appearance ?? "not set"})`;
      try {
        const first = await saveWith("Save as SVG");
        await appearance(other);
        const switched = await s.waitFor(`document.documentElement.dataset.theme === '${other}'`, 5000);
        const during = await read();
        const second = await saveWith("Save as SVG");
        const a = same(String(first)), b = same(String(second));
        let at = 0;
        while (at < a.length && at < b.length && a[at] === b[at]) at++;
        check(
          "The circular map's SVG is the same in the light and in the dark theme",
          switched && during.theme === other && during.appearance === other && standaloneSvg(first) && standaloneSvg(second) && a === b,
          `${named(before)} → ${named(during)}; ${a === b ? `${a.length} characters in both` : `the first difference is at character ${at}: ${JSON.stringify(a.slice(Math.max(0, at - 30), at + 40))} against ${JSON.stringify(b.slice(Math.max(0, at - 30), at + 40))}`}`
        );
      } finally {
        // As Settings had it; if that couldn't be read, light.
        await appearance(before.appearance === undefined ? "light" : before.appearance ?? "system");
        const back = await s.waitFor(`document.documentElement.dataset.theme === '${before.theme}'`, 5000);
        const now = await read();
        check(
          "The theme is put back after the map's SVG was saved in both",
          back && now.theme === before.theme && (before.appearance === undefined || (now.appearance ?? "system") === (before.appearance ?? "system")),
          `${named(before)} before, ${named(now)} after${before.appearance === undefined ? " (its setting couldn't be read, so light was put back)" : ""}`
        );
      }
    });
  } finally {
    await closeMenu();
    await s.exec("window.__strandivo.store.select({ range: null, caret: 0 }, 'e2e');");
    await transparent(saved.transparent);
    await mode(saved.linear);
    await control("Zoom", saved.zoom);
    if (!saved.linear) await control("Rotate", saved.rotate);
  }

  // Everything above put back what it changed.
  const now = await snapshot();
  const kept = await s.exec("const same = window.__strandivo.store.data === window.__e2eMapImageData; delete window.__e2eMapImageData; return same;");
  const moved = ["zoom", "linear", "transparent", "tabs", "tab", "features", "theme", ...(saved.linear ? [] : ["rotate"])].filter(k => now[k] !== saved[k]);
  check(
    "The map image checks leave the tabs, the map, the theme and the file's data as they found them",
    !moved.length && kept,
    [...moved.map(k => `${k} was ${saved[k]}, is ${now[k]}`), ...(kept ? [] : ["the file's data is not the object it was"])].join("; ") || "nothing changed"
  );
}
