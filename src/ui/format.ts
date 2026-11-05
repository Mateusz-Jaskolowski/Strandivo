// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Number formatting for the interface: 1,234,567. One shared formatter, because
// Number.toLocaleString builds a new one on every call, which is slow in long lists.

const INTEGER = new Intl.NumberFormat("en-US");

export const fmt = (n: number) => INTEGER.format(n);

/** A round step for a ruler, at least `raw`. */
export function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
