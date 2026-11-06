#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Draws the app icon and writes every file made from it: the shell's PNGs, .ico and
// .icns in src-tauri/icons/, and the website's icon and favicon. The drawing is worked
// out here (arcs, arrowheads, the origin tick) rather than kept as a picture, so the
// arrowheads sit exactly on their arcs. Sizes of 32 px and under use a plainer drawing
// (no origin tick, thicker strands, less margin), as the full one blurs into a ring.
//
//   node tools/build-icon.mjs          writes the SVGs, renders every size
//   node tools/build-icon.mjs --svg    writes only the SVGs
//
// Rendering uses the Tauri CLI's own SVG renderer (`tauri icon --png`); the .icns needs
// macOS's iconutil, so run it on a Mac.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ICONS = join(ROOT, "src-tauri/icons");
const SITE = join(ROOT, "site");

const C = 512; // centre of the 1024 canvas
const COLOURS = {
  top: "#123a5e",
  bottom: "#0b223c",
  backbone: "#e2ecf5",
  pink: "#f06292",
  orange: "#ff9f43",
  green: "#2ecc8c",
};

// Three features of a plasmid map, in degrees clockwise from the origin at the top.
// Two run clockwise and one back, so somewhere two heads must face each other: that
// gap (on the left) is the widest, and the tails meet at the origin.
const FEATURES = [
  { from: 14, to: 133, cw: true, colour: COLOURS.orange },
  { from: 152, to: 238, cw: true, colour: COLOURS.green },
  { from: 266, to: 346, cw: false, colour: COLOURS.pink },
];

const FULL = {
  inset: 100, // Apple's grid: an 824 px body on a 1024 px canvas
  corner: 185,
  r: 252, // the backbone's radius, which features are centred on
  backbone: 36,
  band: 92,
  headWidth: 180,
  headLength: 128,
  soften: 10, // rounds every corner by half this
  // The origin crosses the backbone, centred on it, with a gap of the background's
  // colour around it so it doesn't merge into the backbone.
  tick: { length: 150, width: 32, gap: 16 },
};

const SMALL = {
  inset: 28,
  corner: 210,
  r: 278,
  backbone: 64,
  band: 150,
  headWidth: 300,
  headLength: 180,
  soften: 0,
  tick: null,
};

const f = (n) => Number(n.toFixed(2));
function at(deg, radius) {
  const t = (deg * Math.PI) / 180;
  return `${f(C + radius * Math.sin(t))} ${f(C - radius * Math.cos(t))}`;
}

// Points from (θ0, r0) to (θ1, r1) with the angle and radius changing together, so the
// line bends with the circle as a map's feature arrows do.
function along(t0, r0, t1, r1) {
  const steps = 24;
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    points.push(`L ${at(t0 + (t1 - t0) * k, r0 + (r1 - r0) * k)}`);
  }
  return points.join(" ");
}

// One closed path per feature, so the head and the body have no seam between them.
// The head's base is a radial line and its tip lies on the backbone's circle. Its sides
// follow the circle rather than running straight to the tip: a straight head points
// along a chord, a few degrees inside the body's direction, and looks bent off it.
function featurePath(feature, p) {
  const outer = p.r + p.band / 2;
  const inner = p.r - p.band / 2;
  const head = (p.headLength / p.r) * (180 / Math.PI);
  const [tail, tip] = feature.cw ? [feature.from, feature.to] : [feature.to, feature.from];
  const dir = feature.cw ? 1 : -1;
  const base = tip - dir * head;
  const large = Math.abs(base - tail) > 180 ? 1 : 0;
  const there = feature.cw ? 1 : 0; // SVG's sweep flag for going from tail to head
  return [
    `M ${at(tail, outer)}`,
    `A ${outer} ${outer} 0 ${large} ${there} ${at(base, outer)}`,
    `L ${at(base, p.r + p.headWidth / 2)}`,
    along(base, p.r + p.headWidth / 2, tip, p.r),
    along(tip, p.r, base, p.r - p.headWidth / 2),
    `L ${at(base, inner)}`,
    `A ${inner} ${inner} 0 ${large} ${1 - there} ${at(tail, inner)}`,
    "Z",
  ].join(" ");
}

function svg(p) {
  const size = 1024 - 2 * p.inset;
  const soft = p.soften
    ? ` stroke-width="${p.soften}" stroke-linejoin="round"`
    : "";
  const features = FEATURES.map(
    (x) => `  <path d="${featurePath(x, p)}" fill="${x.colour}"${soft ? ` stroke="${x.colour}"${soft}` : ""}/>`,
  );
  const tickLine = (stroke, width) =>
    `  <line x1="${C}" y1="${C - p.r + p.tick.length / 2}" x2="${C}" y2="${C - p.r - p.tick.length / 2}" ` +
    `stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
  const tick = p.tick
    ? [tickLine("url(#bg)", p.tick.width + 2 * p.tick.gap), tickLine(COLOURS.backbone, p.tick.width)]
    : [];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">`,
    `  <defs>`,
    // In the canvas's units, so the origin's gap can be painted with it too.
    `    <linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="0" y1="${p.inset}" x2="0" y2="${1024 - p.inset}">`,
    `      <stop offset="0" stop-color="${COLOURS.top}"/>`,
    `      <stop offset="1" stop-color="${COLOURS.bottom}"/>`,
    `    </linearGradient>`,
    `  </defs>`,
    `  <rect x="${p.inset}" y="${p.inset}" width="${size}" height="${size}" rx="${p.corner}" fill="url(#bg)"/>`,
    `  <circle cx="${C}" cy="${C}" r="${p.r}" fill="none" stroke="${COLOURS.backbone}" stroke-width="${p.backbone}"/>`,
    ...tick,
    ...features,
    `</svg>`,
    "",
  ].join("\n");
}

// Renders an SVG at the given sizes with the Tauri CLI; returns a size → PNG path map.
function render(svgPath, sizes, out) {
  execFileSync("npx", ["tauri", "icon", svgPath, "-o", out, "--png", sizes.join(",")], {
    cwd: ROOT,
    stdio: "ignore",
  });
  return Object.fromEntries(sizes.map((s) => [s, join(out, `${s}x${s}.png`)]));
}

// An .ico of PNG images, which Windows has read since Vista.
function writeIco(path, pngs) {
  const entries = Object.entries(pngs).map(([s, file]) => [Number(s), readFileSync(file)]);
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(([s, data], i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s >= 256 ? 0 : s, e);
    header.writeUInt8(s >= 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  writeFileSync(path, Buffer.concat([header, ...entries.map(([, d]) => d)]));
}

const fullSvg = join(ICONS, "icon.svg");
const smallSvg = join(ICONS, "icon-small.svg");
writeFileSync(fullSvg, svg(FULL));
writeFileSync(smallSvg, svg(SMALL));
if (process.argv.includes("--svg")) process.exit(0);

const work = mkdtempSync(join(tmpdir(), "strandivo-icon-"));
try {
  const small = render(smallSvg, [16, 24, 32], join(work, "small"));
  const full = render(fullSvg, [48, 64, 128, 256, 512, 1024], join(work, "full"));

  copyFileSync(small[32], join(ICONS, "32x32.png"));
  copyFileSync(full[128], join(ICONS, "128x128.png"));
  copyFileSync(full[256], join(ICONS, "128x128@2x.png"));
  copyFileSync(full[512], join(ICONS, "icon.png"));
  copyFileSync(full[1024], join(ICONS, "app-icon.png"));
  writeIco(join(ICONS, "icon.ico"), {
    16: small[16], 24: small[24], 32: small[32],
    48: full[48], 64: full[64], 128: full[128], 256: full[256],
  });

  const iconset = join(work, "icon.iconset");
  mkdirSync(iconset);
  const icns = {
    "icon_16x16.png": small[16],
    "icon_16x16@2x.png": small[32],
    "icon_32x32.png": small[32],
    "icon_32x32@2x.png": full[64],
    "icon_128x128.png": full[128],
    "icon_128x128@2x.png": full[256],
    "icon_256x256.png": full[256],
    "icon_256x256@2x.png": full[512],
    "icon_512x512.png": full[512],
    "icon_512x512@2x.png": full[1024],
  };
  for (const [name, file] of Object.entries(icns)) copyFileSync(file, join(iconset, name));
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(ICONS, "icon.icns")]);

  copyFileSync(small[32], join(SITE, "favicon.png"));
  copyFileSync(full[256], join(SITE, "icon.png"));
} finally {
  rmSync(work, { recursive: true, force: true });
}
