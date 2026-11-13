// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// For tests only: a minisign key made on the spot, which signs as `tauri signer` does
// (prehashed), with both wrapped in base64 as Tauri writes them.

import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

export function testKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const id = randomBytes(8);
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  const line = Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64");
  const shownId = Buffer.from(id).reverse().toString("hex").toUpperCase();
  const pubText = `untrusted comment: minisign public key: ${shownId}\n${line}\n`;
  return {
    id: shownId,
    line,
    /** As in tauri.conf.json. */
    pubkey: Buffer.from(pubText).toString("base64"),
    /** As in latest.json: `trusted` changes the trusted comment after signing. */
    sign(data, { trusted } = {}) {
      const signature = sign(null, createHash("blake2b512").update(data).digest(), privateKey);
      const comment = "timestamp:1763000000\tfile:test";
      const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
      const text = [
        "untrusted comment: signature from tauri secret key",
        Buffer.concat([Buffer.from("ED"), id, signature]).toString("base64"),
        `trusted comment: ${trusted ?? comment}`,
        global.toString("base64")
      ].join("\n");
      return Buffer.from(`${text}\n`).toString("base64");
    }
  };
}
