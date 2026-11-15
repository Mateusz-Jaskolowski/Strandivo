// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The sequence's name in the middle of the circular map, with its length under it: as
// large as fits inside the circle (the ruler's numbers are its edge), on as few lines as
// can be read, up to three. A name too long even for that is cut short with an ellipsis.
// No DOM here: text is measured by the caller, so it is unit-tested.

/** Width of `text` set at `size` px in the name's font. */
export type Measure = (text: string, size: number) => number;

export interface NameLines {
  /** Font size of the name, px. */
  size: number;
  /** Each line and the y of its baseline; the circle's centre is 0. */
  lines: { text: string; y: number }[];
  /** Baseline of the length under the name. */
  lengthY: number;
  /** The name was cut short to fit. */
  cut: boolean;
}

/** The length's font size and the gap above it. */
export const LENGTH_SIZE = 11.5;
const LENGTH_GAP = 4;
const LINE_HEIGHT = 1.2;
/** The largest size, and how small each number of lines may go before trying one more. */
const MAX_SIZE = 18;
const MIN_SIZE = [13, 12, 11];
/** Where a word too long for a line is broken, after the character, before anywhere else. */
const BREAK_AFTER = /[_\-/.,+)]/;

/** Widths free on each of `count` lines at `size`, stacked with the length line in a circle of `radius`. */
function lineWidths(count: number, size: number, radius: number): { widths: number[]; top: number } {
  const lh = size * LINE_HEIGHT;
  const top = -(count * lh + LENGTH_GAP + LENGTH_SIZE * LINE_HEIGHT) / 2;
  const widths = Array.from({ length: count }, (_, i) => {
    // A line's room is the circle's chord at whichever of its edges is further out.
    const far = Math.max(Math.abs(top + i * lh), Math.abs(top + (i + 1) * lh));
    return far >= radius ? 0 : 2 * Math.sqrt(radius * radius - far * far);
  });
  return { widths, top };
}

/**
 * The longest start of `word` that fits in `width`, ending after a break character such as
 * "_" or "-" when one leaves at least half of what fits; null when not even one character does.
 */
function breakWord(word: string, width: number, size: number, measure: Measure): [string, string] | null {
  let fit = 0;
  let after = 0;
  for (let i = 1; i <= word.length && measure(word.slice(0, i), size) <= width; i++) {
    fit = i;
    if (BREAK_AFTER.test(word[i - 1])) after = i;
  }
  if (!fit) return null;
  const cut = after >= fit / 2 ? after : fit;
  return [word.slice(0, cut), word.slice(cut)];
}

/**
 * Fills lines of the given widths with `words` in order, breaking a word only when it fits
 * on no line by itself. The lines, and the words left over when they ran out.
 */
function fill(words: string[], widths: number[], size: number, measure: Measure): { lines: string[]; rest: string[] } | null {
  const queue = [...words];
  const lines: string[] = [];
  let line = "";
  while (queue.length && lines.length < widths.length) {
    const width = widths[lines.length];
    const word = queue[0];
    const joined = line ? `${line} ${word}` : word;
    if (measure(joined, size) <= width) {
      line = joined;
      queue.shift();
    } else if (line) {
      lines.push(line);
      line = "";
    } else {
      const parts = breakWord(word, width, size, measure);
      if (!parts) return null;
      lines.push(parts[0]);
      queue[0] = parts[1];
    }
  }
  if (line) lines.push(line);
  return { lines, rest: queue };
}

/** `text` cut to fit `width`, ending in an ellipsis. */
function ellipsize(text: string, width: number, size: number, measure: Measure): string {
  let n = text.length;
  while (n > 0 && measure(`${text.slice(0, n).trimEnd()}…`, size) > width) n--;
  return `${text.slice(0, n).trimEnd()}…`;
}

function place(lines: string[], size: number, top: number, cut: boolean): NameLines {
  const lh = size * LINE_HEIGHT;
  // Each baseline sits a third of the font below its line's middle, as capitals do.
  const placed = lines.map((text, i) => ({ text, y: top + (i + 0.5) * lh + size * 0.35 }));
  const lengthTop = top + lines.length * lh + LENGTH_GAP;
  return { size, lines: placed, lengthY: lengthTop + (LENGTH_SIZE * LINE_HEIGHT) / 2 + LENGTH_SIZE * 0.35, cut };
}

/**
 * Lays out `name` inside a circle of `radius`: one line if it can be at least 13 px, else
 * two, else three, each as large as fits, up to 18 px; failing that, three lines at 11 px,
 * the last cut short.
 */
export function layoutName(name: string, radius: number, measure: Measure): NameLines {
  const words = name.split(/\s+/).filter(Boolean);
  if (!words.length) return place([], MAX_SIZE, lineWidths(0, MAX_SIZE, radius).top, false);
  for (let count = 1; count <= MIN_SIZE.length; count++) {
    for (let size = MAX_SIZE; size >= MIN_SIZE[count - 1]; size -= 0.5) {
      const { widths, top } = lineWidths(count, size, radius);
      const filled = fill(words, widths, size, measure);
      if (filled && !filled.rest.length) return place(filled.lines, size, top, false);
    }
  }
  // Too long even for three lines: the first two filled, the rest cut short on the third.
  const count = MIN_SIZE.length;
  const size = MIN_SIZE[count - 1];
  const { widths, top } = lineWidths(count, size, radius);
  const head = fill(words, widths.slice(0, -1), size, measure);
  if (!head) {
    const one = lineWidths(1, size, radius);
    return place([ellipsize(words.join(" "), one.widths[0], size, measure)], size, one.top, true);
  }
  // Two lines at this size hold it all, if more snugly than three would.
  if (!head.rest.length) return place(head.lines, size, lineWidths(head.lines.length, size, radius).top, false);
  return place([...head.lines, ellipsize(head.rest.join(" "), widths[count - 1], size, measure)], size, top, true);
}
