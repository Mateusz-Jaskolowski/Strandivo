// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Checks minisign signatures as Tauri's updater does (it uses the minisign-verify crate): an
// installed copy installs an update only if the file's signature in latest.json verifies
// against the public key built into it. Node's own Ed25519 and BLAKE2b do the work, so the
// release jobs that run this need nothing installed.
//
// Tauri wraps both once more in base64: `plugins.updater.pubkey` in tauri.conf.json is the
// base64 of minisign's .pub text, and each signature the base64 of its .minisig text.

import { createHash, createPublicKey, verify } from "node:crypto";

/** Bytes from strict base64, or null: Buffer.from would skip characters that don't belong. */
function base64(text) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  return Buffer.from(text, "base64");
}

/** Text from Tauri's base64 wrapping of a minisign file. */
function unwrap(b64, what) {
  const bin = base64(b64.trim());
  if (!bin) throw new Error(`${what} isn't base64`);
  return bin.toString("utf8");
}

/**
 * A minisign public key, from its .pub text or just the key's line. `id` is shown as
 * minisign shows it (DE18055614E24CDD), which is its eight bytes in reverse.
 */
export function parsePublicKey(text) {
  const line = text.trim().split(/\r?\n/).pop() ?? "";
  const bin = base64(line);
  if (bin?.length !== 42 || bin.toString("latin1", 0, 2) !== "Ed") throw new Error("not a minisign public key");
  const raw = bin.subarray(10);
  return {
    id: Buffer.from(bin.subarray(2, 10)).reverse().toString("hex").toUpperCase(),
    line,
    key: createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" })
  };
}

/** A minisign signature, from its .minisig text: four lines, as minisign-verify reads them. */
export function parseSignature(text) {
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  if (lines.length < 4) throw new Error("not a minisign signature");
  const sig = base64(lines[1]);
  const global = base64(lines[3]);
  const prefix = "trusted comment: ";
  if (sig?.length !== 74 || global?.length !== 64 || !lines[2].startsWith(prefix)) throw new Error("not a minisign signature");
  const algorithm = sig.toString("latin1", 0, 2);
  // "ED" signs the file's BLAKE2b-512 hash, minisign's way since 0.8; "Ed" the file itself,
  // which the updater still accepts.
  if (algorithm !== "ED" && algorithm !== "Ed") throw new Error(`unknown signature algorithm "${algorithm}"`);
  return {
    prehashed: algorithm === "ED",
    id: Buffer.from(sig.subarray(2, 10)).reverse().toString("hex").toUpperCase(),
    signature: sig.subarray(10),
    trustedComment: lines[2].slice(prefix.length),
    globalSignature: global
  };
}

/** Why `data` doesn't verify against `signature` and `publicKey` (both parsed), or null. */
export function signatureProblem(publicKey, signature, data) {
  if (signature.id !== publicKey.id) return `signed with key ${signature.id}, not ${publicKey.id}`;
  const message = signature.prehashed ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, message, publicKey.key, signature.signature)) return "its signature doesn't match the file";
  // The second signature covers the first and the trusted comment, as minisign checks too.
  const global = Buffer.concat([signature.signature, Buffer.from(signature.trustedComment, "utf8")]);
  if (!verify(null, global, publicKey.key, signature.globalSignature)) return "its signature's trusted comment was changed";
  return null;
}

/** The key in tauri.conf.json's `plugins.updater.pubkey`. */
export const tauriPublicKey = b64 => parsePublicKey(unwrap(b64, "The updater's public key"));

/** A signature from latest.json, or from a .sig file the build wrote. */
export const tauriSignature = b64 => parseSignature(unwrap(b64, "The signature"));
