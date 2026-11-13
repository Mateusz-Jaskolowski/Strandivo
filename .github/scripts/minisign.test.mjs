// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Checking update signatures as the updater does. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePublicKey, parseSignature, signatureProblem, tauriPublicKey, tauriSignature } from "./minisign.mjs";
import { testKey } from "./minisign-fixture.mjs";

// The test vectors of minisign-verify 0.3.0 (MIT, Frank Denis), the crate Tauri's updater
// checks updates with, so this reads minisign's files the way it does.
const VECTOR_KEY = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
const LEGACY = `untrusted comment: signature from minisign secret key
RWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=
trusted comment: timestamp:1555779966\tfile:test
QtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==`;
const PREHASHED = `untrusted comment: signature from minisign secret key
RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=
trusted comment: timestamp:1556193335\tfile:test
y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==`;

test("minisign's own signatures verify, and only for the file they sign", () => {
  const key = parsePublicKey(VECTOR_KEY);
  assert.equal(key.id, "E7620F1842B4E81F");
  assert.equal(parsePublicKey(`untrusted comment: minisign public key E7620F1842B4E81F\n${VECTOR_KEY}\n`).id, key.id);
  for (const text of [LEGACY, PREHASHED]) {
    const sig = parseSignature(text);
    assert.equal(signatureProblem(key, sig, Buffer.from("test")), null);
    assert.equal(signatureProblem(key, sig, Buffer.from("Test")), "its signature doesn't match the file");
  }
  assert.equal(parseSignature(PREHASHED).prehashed, true);
  assert.equal(parseSignature(LEGACY).prehashed, false);
  assert.equal(parseSignature(PREHASHED).trustedComment, "timestamp:1556193335\tfile:test");
});

test("a signature from another key, or with its trusted comment changed, is refused", () => {
  const key = testKey();
  const other = testKey();
  const data = Buffer.from("Strandivo_Windows_setup.exe");
  const ours = tauriPublicKey(key.pubkey);
  assert.equal(ours.id, key.id);
  assert.equal(signatureProblem(ours, tauriSignature(key.sign(data)), data), null);
  assert.match(signatureProblem(ours, tauriSignature(other.sign(data)), data), new RegExp(`signed with key ${other.id}, not ${key.id}`));
  assert.equal(signatureProblem(ours, tauriSignature(key.sign(data, { trusted: "timestamp:1\tfile:x" })), data), "its signature's trusted comment was changed");
});

test("what isn't a key or a signature says so", () => {
  assert.throws(() => tauriPublicKey("not base64!"), /isn't base64/);
  assert.throws(() => parsePublicKey("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0Q"), /not a minisign public key/);
  assert.throws(() => parseSignature("untrusted comment: x\nAAAA\n"), /not a minisign signature/);
  assert.throws(() => parseSignature(LEGACY.replace("RWQf6LRCGA9i59", "RXQf6LRCGA9i59")), /unknown signature algorithm/);
  // Characters Buffer.from would skip make a different key, not this one.
  assert.throws(() => parsePublicKey(`${VECTOR_KEY.slice(0, 10)}*${VECTOR_KEY.slice(10)}`), /not a minisign public key/);
});
