// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { groupLinearCutSites, layoutLinearLabels, maxLinearLabelWidth, type LinearLabel } from "./linearMapLabels.ts";

const width = 480;
const step = 16;
const wanted = (x: number[], labelWidth: number) => x.map((x, item) => ({ item, x, width: labelWidth }));

test("linear cut groups separate at zoom, and chains of nearby ticks cannot extend a group", () => {
  const sites = [10, 10, 11, 12, 14, 100].map((cut, id) => ({ cut, id }));
  const groupIds = (scale: number) => groupLinearCutSites(sites, scale).map(group => group.map(site => site.id));
  assert.deepEqual(groupIds(0.5), [[0, 1, 2, 3], [4], [5]]);
  assert.deepEqual(groupIds(3), [[0, 1], [2], [3], [4], [5]]);
});

function checkLayout(inputs: LinearLabel<number>[]) {
  const layout = layoutLinearLabels(inputs, width, step);
  assert.deepEqual(layout.labels.map(p => p.item).sort((a, b) => a - b), inputs.map(a => a.item));
  for (const label of layout.labels) {
    assert.equal(label.x, inputs[label.item].x, "the mark stays at its original position");
    assert.ok(label.left >= 4 && label.left + label.width <= width - 4, "label is in bounds");
    for (const other of layout.labels) {
      if (label === other) continue;
      if (label.distance === other.distance) {
        assert.ok(label.left + label.width <= other.left || other.left + other.width <= label.left, "names are separate");
      } else if (label.distance < other.distance) {
        const x = other.bend && label.distance > other.bend.to ? other.stem : other.x;
        assert.ok(x < label.left || x > label.left + label.width, "a later stem does not pass through a name");
      }
    }
  }
  return layout;
}

test("linear map labels stay close when there is room and fan out around a cluster", () => {
  const layout = checkLayout(wanted([140, 147, 155, 169, 390], 80));
  assert.equal(layout.labels.find(p => p.item === 4)?.dir, 0);
  assert.equal(layout.labels.find(p => p.item === 0)?.dir, -1);
  assert.equal(layout.labels.find(p => p.item === 3)?.dir, 1);
  assert.equal(layout.height, 2 * step);
});

test("crowds at the ends turn inward, and sites at one position stay separately labeled", () => {
  const layout = checkLayout(wanted([24, 28, 32, 32, 440, 445, 450], 100));
  assert.ok(layout.labels.every(p => p.dir === (p.x < width / 2 ? 1 : -1)));
  assert.ok(layout.labels.every(p => !p.bend));
});

test("a crowd at one end can use two columns of names without crossing leaders", () => {
  const inputs = [...wanted([24, 27, 30, 33], 95), ...wanted([45, 53, 64], 70)].map((p, item) => ({ ...p, item }));
  const layout = checkLayout(inputs);
  assert.ok(layout.labels.some(p => p.bend));
  assert.equal(layout.height, 5 * step);
  for (const left of layout.labels) for (const right of layout.labels) {
    if (left.x < right.x) assert.ok(left.stem <= right.stem);
  }
});

test("a track with no open gaps makes room without crossing stems or clipping long names", () => {
  const layout = checkLayout(wanted([24, 40, 200, 390, 456], maxLinearLabelWidth(width)));
  assert.ok(layout.labels.every(p => p.bend));
  const sorted = [...layout.labels].sort((a, b) => a.x - b.x);
  assert.ok(sorted.every((p, i) => !i || sorted[i - 1].stem <= p.stem));
});
