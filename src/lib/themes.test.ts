// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The themes hold together: colours live in token blocks, every theme names the same
// tokens, its text reads on its backgrounds (WCAG AA), and the script that sets the theme
// before the first paint decides as Settings does. A new theme is checked by adding it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { isAppearance, themeFor, THEME_LABELS, THEMES } from "./themes.ts";

const SRC = new URL("../", import.meta.url);

interface Rule {
  file: string;
  selector: string;
  decls: [string, string][];
}

/** A rule's declarations, split at semicolons outside quotes and brackets. */
function declarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const take = (end: number) => {
    const d = body.slice(start, end).trim();
    const colon = d.indexOf(":");
    if (colon > 0) out.push([d.slice(0, colon).trim(), d.slice(colon + 1).trim()]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      take(i);
      start = i + 1;
    }
  }
  take(body.length);
  return out;
}

/** Every style rule in a stylesheet, from inside @media and @keyframes too. */
function rulesOf(css: string, file: string): Rule[] {
  const out: Rule[] = [];
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const prelude = text.slice(i, open).split(";").pop()!.trim();
      let depth = 1;
      let j = open + 1;
      for (; j < text.length && depth; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith("@")) walk(body);
      else out.push({ file, selector: prelude.replace(/\s+/g, " "), decls: declarations(body) });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return out;
}

const cssFiles = (readdirSync(SRC, { recursive: true }) as string[]).filter(f => f.endsWith(".css")).sort();
const rules = cssFiles.flatMap(f => rulesOf(readFileSync(new URL(f, SRC), "utf8"), f));

/**
 * A block of tokens: `:root` alone holds what every theme shares (and, listed beside a
 * theme, makes that theme the default); `:root[data-theme="…"]` names a theme.
 */
function tokenBlock(r: Rule): { root: boolean; themes: string[] } | null {
  const parts = r.selector.split(",").map(s => /^:root(?:\[data-theme="([a-z-]+)"\])?$/.exec(s.trim()));
  if (parts.some(p => !p)) return null;
  return { root: parts.some(p => !p![1]), themes: parts.filter(p => p![1]).map(p => p![1]) };
}

const blocks = rules.flatMap(r => {
  const b = tokenBlock(r);
  return b ? [{ ...b, rule: r }] : [];
});
const themeBlocks = blocks.filter(b => b.themes.length);

test("the stylesheets have a block of tokens for each theme, and no other", () => {
  const found = [...new Set(themeBlocks.flatMap(b => b.themes))].sort();
  assert.deepEqual(found, [...THEMES].sort());
  assert.deepEqual(Object.keys(THEME_LABELS).sort(), [...THEMES].sort());
  assert.equal(themeBlocks.filter(b => b.rule.selector.split(",").some(s => s.trim() === ":root")).length, 1, "one theme is the default");
});

test("every theme names the same tokens, and says whether it is light or dark", () => {
  const named = (theme: string) => new Set(themeBlocks.filter(b => b.themes.includes(theme)).flatMap(b => b.rule.decls.map(([p]) => p)));
  const all = new Set(THEMES.flatMap(t => [...named(t)]));
  const missing = THEMES.flatMap(t => [...all].filter(p => !named(t).has(p)).map(p => `${t} has no ${p}`));
  assert.deepEqual(missing, []);
  for (const t of THEMES) {
    const scheme = themeBlocks.filter(b => b.themes.includes(t)).flatMap(b => b.rule.decls).find(([p]) => p === "color-scheme")?.[1];
    assert.ok(scheme === "light" || scheme === "dark", `${t}: color-scheme ${scheme}`);
  }
});

// CSS's named colours: as values, they would look the same in every theme.
const NAMED = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
  cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
  darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
  firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
  hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
  midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen`.split(/\s+/)
);

/** The colours a value names itself, rather than through a token. */
function colourLiterals(value: string): string[] {
  const v = value
    .replace(/url\([^)]*\)/g, "")
    .replace(/"[^"]*"|'[^']*'/g, "")
    .replace(/--[\w-]+/g, "");
  const found = [...v.matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi)].map(m => m[0]);
  for (const word of v.match(/[a-z]+/gi) ?? []) if (NAMED.has(word.toLowerCase())) found.push(word);
  return found;
}

/** Colours outside the token blocks that no theme should change, each with why. */
const ALLOWED: { selector: RegExp; reason: string }[] = [
  { selector: /^\.ps-toast/, reason: "Toasts are dark slate in every theme, with white text." },
  { selector: /^\.ps-context-swatch$/, reason: "The edge of a colour swatch, drawn on the colour itself." },
  { selector: /^\.sv-protein-region$/, reason: "White text on the region's own colour, which no theme changes." },
  { selector: /^\.sv-figure-paper$/, reason: "The protein figure is shown on white, as it is saved and copied." }
];

test("outside the token blocks the stylesheets name no colours, but a few listed ones", () => {
  const used = new Set<RegExp>();
  const stray: string[] = [];
  for (const r of rules) {
    if (tokenBlock(r)) continue;
    for (const [prop, value] of r.decls) {
      const found = colourLiterals(value);
      if (!found.length) continue;
      const allowed = ALLOWED.find(a => a.selector.test(r.selector));
      if (allowed) used.add(allowed.selector);
      else stray.push(`${r.file}: ${r.selector} { ${prop}: ${value} } names ${found.join(", ")}: use a token`);
    }
  }
  assert.deepEqual(stray, []);
  assert.deepEqual(ALLOWED.filter(a => !used.has(a.selector)).map(a => a.selector.source), [], "an allowed colour that is gone should leave the list");
});

/** A theme's tokens as they reach the page: shared and default blocks, then its own. */
function tokensOf(theme: string): Map<string, string> {
  const out = new Map<string, string>();
  const put = (b: (typeof blocks)[number]) => {
    for (const [p, v] of b.rule.decls) if (p.startsWith("--")) out.set(p, v);
  };
  // `:root[data-theme]` outweighs `:root` wherever it is written.
  for (const b of blocks) if (b.root) put(b);
  for (const b of blocks) if (b.themes.includes(theme)) put(b);
  return out;
}

function resolve(tokens: Map<string, string>, value: string, depth = 0): string {
  assert.ok(depth < 20, `tokens refer to each other in a loop: ${value}`);
  const next = value.replace(/var\((--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name: string, fallback?: string) => {
    const v = tokens.get(name) ?? fallback;
    assert.ok(v !== undefined, `${name} is not defined`);
    return v;
  });
  return next === value ? value : resolve(tokens, next, depth + 1);
}

/** An opaque colour's red, green and blue, 0–255. */
function rgb(css: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join("") : hex[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css);
  assert.ok(fn && (fn[4] === undefined || Number(fn[4]) === 1), `${css} is not an opaque colour`);
  return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
}

/** WCAG 2's contrast ratio of two colours. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = rgb(c).map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Text tokens and the backgrounds they are used on. */
const PAIRS: [string, string][] = [
  ...["--text", "--text-2", "--text-3"].flatMap(fg => ["--panel", "--side", "--bg"].map((bg): [string, string] => [fg, bg])),
  ["--accent-text", "--panel"],
  ["--on-accent", "--accent"],
  ["--on-primer", "--primer"],
  ["--on-bad", "--bad"]
];

test("in every theme, text tokens pass WCAG AA (4.5:1) on their backgrounds", () => {
  const failing: string[] = [];
  for (const theme of THEMES) {
    const tokens = tokensOf(theme);
    for (const [fg, bg] of PAIRS) {
      const ratio = contrast(resolve(tokens, `var(${fg})`), resolve(tokens, `var(${bg})`));
      if (ratio < 4.5) failing.push(`${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failing, []);
});

test("Appearance is System or a theme, and System follows the computer", () => {
  assert.ok(isAppearance("system") && THEMES.every(isAppearance));
  assert.ok(!isAppearance("sepia") && !isAppearance(undefined));
  for (const t of THEMES) {
    assert.equal(themeFor(t, true), t);
    assert.equal(themeFor(t, false), t);
  }
  assert.equal(themeFor("system", true), "dark");
  assert.equal(themeFor("system", false), "light");
  assert.equal(themeFor("sepia", true), "dark");
});

test("before the page loads, the boot script picks the theme Settings will", async () => {
  // Settings' key, as src/settings.ts writes it; the script must read the same.
  const key = /const KEY = "([^"]+)"/.exec(readFileSync(new URL("settings.ts", SRC), "utf8"))![1];
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const cases: [stored: string | null | Error, systemDark: boolean | Error, theme: string][] = [
    [null, false, "light"],
    [null, true, "dark"],
    ["{}", true, "dark"],
    ['{"appearance":"system"}', true, "dark"],
    ['{"appearance":"system"}', false, "light"],
    ['{"appearance":"light"}', true, "light"],
    ['{"appearance":"dark"}', false, "dark"],
    // Unknown names and unreadable settings are System, as loadSettings has them.
    ['{"appearance":"sepia"}', true, "dark"],
    ["{broken", true, "dark"],
    ["null", true, "dark"],
    [new Error("storage denied"), true, "dark"],
    ['{"appearance":"system"}', new Error("no media queries"), "light"]
  ];
  for (const [i, [stored, systemDark, theme]] of cases.entries()) {
    const root = { dataset: {} as Record<string, string> };
    set("__THEMES__", THEMES);
    set("document", { documentElement: root });
    set("localStorage", {
      getItem: (k: string) => {
        if (stored instanceof Error) throw stored;
        return k === key ? stored : null;
      }
    });
    set("matchMedia", (q: string) => {
      if (systemDark instanceof Error) throw systemDark;
      return { matches: q === "(prefers-color-scheme: dark)" && systemDark };
    });
    await import(`../themeBoot.ts?case=${i}`);
    assert.equal(root.dataset.theme, theme, `case ${i}: ${String(stored)}, system dark ${String(systemDark)}`);
  }
  for (const name of ["__THEMES__", "document", "localStorage", "matchMedia"]) delete (globalThis as Record<string, unknown>)[name];
});
