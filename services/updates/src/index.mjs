// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// updates.strandivo.com: what an installed copy asks once a day for the latest version.
// It hands over latest.json from the newest published GitHub release, so the address
// built into every copy stays ours while the files can live anywhere. The app adds its
// version, OS and processor to the query; part 5 of docs/updates-feedback-usage-plan.md
// counts those per day, and nothing else is kept. Logging is off (wrangler.toml).

export const LATEST = "https://github.com/Mateusz-Jaskolowski/Strandivo/releases/latest/download/latest.json";

/** 204 tells the updater there is nothing to install; the copy keeps what it has. */
const noUpdate = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

export async function handle(request, fetchLatest = url => fetch(url, { redirect: "follow", cf: { cacheTtl: 300, cacheEverything: true } })) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Only GET is answered here.", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  if (url.pathname !== "/latest.json") return new Response("Not found.", { status: 404 });

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

export default { fetch: request => handle(request) };
