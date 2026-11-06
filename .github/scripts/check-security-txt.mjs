// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Checks the website's security.txt (RFC 9116), whose Expires date has to be renewed by
// hand: it fails from 30 days before that date, so renewing it isn't forgotten, and when
// the date is more than a year away, which the RFC advises against.
import { readFileSync } from "node:fs";

const PATH = "site/.well-known/security.txt";
const DAY = 24 * 60 * 60 * 1000;

function fail(message) {
  console.log(`::error file=${PATH},title=security.txt::${message}`);
  process.exit(1);
}

const text = readFileSync(new URL(`../../${PATH}`, import.meta.url), "utf8");
const line = text.match(/^Expires:\s*(\S+)\s*$/m);
if (!line) fail(`${PATH} has no Expires line.`);
const expires = new Date(line[1]);
if (Number.isNaN(expires.getTime())) fail(`${PATH} has an Expires date that can't be read: ${line[1]}`);
const days = (expires.getTime() - Date.now()) / DAY;
if (days < 30) fail(`${PATH} expires on ${line[1].slice(0, 10)}. Move Expires on by a year.`);
if (days > 366) fail(`${PATH} expires more than a year from now; RFC 9116 asks for less.`);
