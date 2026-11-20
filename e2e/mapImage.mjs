// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Shared checks of the map as an image, in WebKitGTK (desktop) and Chrome (web): the whole
// map whatever the view's zoom, at its rotation, with nothing selected, every label inside
// the picture, and a transparent background when asked.

/** Opens the map's Export image menu, if it isn't open, and says whether it shows. */
export function openMapImageMenu(s) {
  return s.exec(`
    const b = Array.from(document.querySelectorAll('.sv-map .sv-pane-head button')).find(b => b.textContent.includes('Export image'));
    if (b.getAttribute('aria-expanded') !== 'true') b.click();
    const menu = document.querySelector('.sv-map-image')?.closest('.sv-chip-menu');
    return !!menu && !menu.hidden;
  `);
}

/** Whether a saved SVG stands alone: every style its own, nothing only the page understood. */
export const standaloneSvg = svg => typeof svg === "string" && /^<\?xml/.test(svg) && /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg) && / viewBox="/.test(svg) && !/ class="| style="| data-|var\(|color-mix/.test(svg);

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
 * Runs on an open circular document showing its map, and leaves the map as it found it.
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
  const saved = await s.exec(`
    return { zoom: document.querySelector('[aria-label="Zoom"]').value, rotate: document.querySelector('[aria-label="Rotate"]').value,
      linear: document.querySelector('.sv-map .sv-segmented button[aria-pressed="true"]').textContent === 'Linear',
      transparent: document.querySelector('.sv-map-image input[type="checkbox"]').checked };
  `);
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
    const pngLinear = await saveWith("Save as PNG");
    check("The linear map's PNG has the map drawn on it, not only the paper", inked(pngLinear), JSON.stringify(pngLinear));
    check("The linear map's PNG is opaque to its last column and row, as its paper covers all of it", opaqueToEdge(pngLinear), JSON.stringify(pngLinear));
    const fitLinear = resolutionFits(pngLinear, fitted);
    check("The linear map's PNG says the resolution that sets it at the SVG's size", fitLinear.ok, fitLinear.detail);
    await transparent(true);
    const clearLinear = await saveWith("Save as PNG");
    await transparent(false);
    check("With Transparent background ticked, the linear map's PNG has a clear corner and the map drawn on it", !!clearLinear && clearLinear.cornerAlpha === 0 && inked(clearLinear), JSON.stringify(clearLinear));
  } finally {
    await s.exec("window.__strandivo.store.select({ range: null, caret: 0 }, 'e2e');");
    await transparent(saved.transparent);
    await mode(saved.linear);
    await control("Zoom", saved.zoom);
    if (!saved.linear) await control("Rotate", saved.rotate);
  }
}
