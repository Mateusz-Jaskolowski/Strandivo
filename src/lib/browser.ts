// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Which browser and system the browser version runs in, from the user-agent string, for
// what a bug report says about where it came from. Only the family, its major version and
// the system's name: never the whole string, and never the system's version, which
// browsers no longer tell (Chrome on any Mac says 10.15.7). No DOM, so it is unit-tested.

export interface BrowserInfo {
  /** "Chrome", "Edge", "Safari", "Firefox", "Opera" or "Browser". */
  name: string;
  /** Its major version, or "" when it can't be told. */
  version: string;
  /** "macOS", "Windows", "Linux", "ChromeOS", "iOS", "Android" or "" */
  system: string;
}

/** The browser and system named by `ua`; order matters, as Edge and Opera say Chrome too. */
export function browserInfo(ua: string): BrowserInfo {
  const major = (re: RegExp) => re.exec(ua)?.[1] ?? "";
  const system = /CrOS/.test(ua)
    ? "ChromeOS"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  if (/Edg(?:e|A|iOS)?\//.test(ua)) return { name: "Edge", version: major(/Edg(?:e|A|iOS)?\/(\d+)/), system };
  if (/OPR\/|Opera\//.test(ua)) return { name: "Opera", version: major(/(?:OPR|Opera)\/(\d+)/), system };
  if (/Firefox\/|FxiOS\//.test(ua)) return { name: "Firefox", version: major(/(?:Firefox|FxiOS)\/(\d+)/), system };
  if (/Chrome\/|CriOS\//.test(ua)) return { name: "Chrome", version: major(/(?:Chrome|CriOS)\/(\d+)/), system };
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return { name: "Safari", version: major(/Version\/(\d+)/), system };
  return { name: "Browser", version: "", system };
}
