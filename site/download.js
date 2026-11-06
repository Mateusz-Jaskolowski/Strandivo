// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The site's one script: it asks the browser which system it runs on and puts that
// system's download first. It sends nothing and stores nothing, and without it the pages
// show every download, as they are written. The markup it shows is in the page already
// (`data-os`, hidden), so it only changes attributes, classes and text.

/** "mac", "windows", "linux" or null when it can't tell, or Strandivo doesn't run there. */
export function detectOs(nav) {
  const ua = nav.userAgent || "";
  const platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "";
  // Phones and tablets: an iPad asks for desktop pages and calls itself a Mac, but has touch.
  if (/Android|iPhone|iPad|iPod|CrOS/i.test(ua)) return null;
  if (/^mac|macos/i.test(platform) || /Macintosh/.test(ua)) return nav.maxTouchPoints > 1 ? null : "mac";
  if (/^win/i.test(platform) || /Windows/.test(ua)) return "windows";
  if (/linux|x11/i.test(platform) || /Linux|X11/.test(ua)) return "linux";
  return null;
}

const NAMES = { mac: "Mac", windows: "Windows", linux: "Linux" };

function suggest(os) {
  // Home's button names the system; it still leads to the Download page.
  for (const a of document.querySelectorAll("[data-download-button]")) a.textContent = `Download for ${NAMES[os]}`;
  const box = document.getElementById("suggested");
  if (!box) return;
  for (const el of box.querySelectorAll("[data-os]")) el.hidden = el.dataset.os !== os;
  box.hidden = false;
  // The rest become the smaller "other systems" list.
  const all = document.getElementById("all-downloads");
  if (all) all.classList.add("others");
  const title = document.getElementById("all-downloads-title");
  if (title) title.hidden = false;
}

if (typeof document !== "undefined") {
  const os = detectOs(navigator);
  if (os) suggest(os);
}
