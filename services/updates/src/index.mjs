// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// updates.strandivo.com: what an installed copy asks once a day for the latest version.
// It hands over latest.json from the newest published GitHub release, so the address
// built into every copy stays ours while the files can live anywhere. The app adds its
// version, OS and processor to the query; part 5 of docs/updates-feedback-usage-plan.md
// counts those per day (a row per day, version, OS and processor, holding a number), and
// nothing else is kept: no address, no identifier. Logging is off (wrangler.toml).

export const LATEST = "https://github.com/Mateusz-Jaskolowski/Strandivo/releases/latest/download/latest.json";

/** 204 tells the updater there is nothing to install; the copy keeps what it has. */
const noUpdate = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

const OSES = ["darwin", "windows", "linux"];
const ARCHES = ["aarch64", "x86_64", "i686", "armv7"];

/** What a check is counted as: only known words and a version's numbers, else "other". */
export function checkKey(url, now = new Date()) {
  const q = url.searchParams;
  const version = q.get("version") ?? "";
  return {
    day: now.toISOString().slice(0, 10),
    version: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version) ? version : "other",
    os: OSES.includes(q.get("target")) ? q.get("target") : "other",
    arch: ARCHES.includes(q.get("arch")) ? q.get("arch") : "other"
  };
}

export const COUNT_SQL =
  "INSERT INTO checks (day, version, os, arch, n) VALUES (?1, ?2, ?3, ?4, 1) " +
  "ON CONFLICT (day, version, os, arch) DO UPDATE SET n = n + 1";

/** Adds one to the day's count; a failure is ignored, as an update check matters more. */
async function count(db, url) {
  if (!db) return;
  const k = checkKey(url);
  try {
    await db.prepare(COUNT_SQL).bind(k.day, k.version, k.os, k.arch).run();
  } catch {
    // Not counted.
  }
}

export async function handle(
  request,
  fetchLatest = url => fetch(url, { redirect: "follow", cf: { cacheTtl: 300, cacheEverything: true } }),
  env = {},
  waitUntil = p => p
) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Only GET is answered here.", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  if (url.pathname !== "/latest.json") return new Response("Not found.", { status: 404 });
  // Counted after answering, so a slow database never slows a check down.
  if (request.method === "GET") waitUntil(count(env.CHECKS, url));

  // No release yet, GitHub unreachable or a file that isn't an update manifest: say there
  // is no update rather than an error, so a copy never shows a failure it can't fix.
  let manifest;
  try {
    const res = await fetchLatest(LATEST);
    if (!res.ok) return noUpdate();
    manifest = await res.json();
  } catch {
    return noUpdate();
  }
  if (typeof manifest?.version !== "string" || !manifest.platforms || typeof manifest.platforms !== "object") return noUpdate();

  return new Response(request.method === "HEAD" ? null : JSON.stringify(manifest), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" }
  });
}

export default { fetch: (request, env, ctx) => handle(request, undefined, env, p => ctx.waitUntil(p)) };
