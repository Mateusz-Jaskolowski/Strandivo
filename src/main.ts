// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import "./polyfills.ts";
import "./styles.css";
import { replaceContextMenus, windowInfo } from "./platform.ts";
import { toast } from "./ui/dom.ts";
import { loadSettings, onSettingsChanged } from "./settings.ts";
import { useTmSettings } from "./lib/primers.ts";
import { useAmberSuppression } from "./lib/genetics.ts";

window.addEventListener("error", e => {
  console.error(e.error || e.message);
  toast(`Unexpected error: ${e.message}`, "error", 8000);
});
window.addEventListener("unhandledrejection", e => {
  console.error(e.reason);
});

async function boot() {
  const root = document.getElementById("app")!;
  replaceContextMenus();
  // Every window works out Tm and translates the way Settings say; registered first, so
  // windows that redraw on a settings change already see the new choice.
  useTmSettings(loadSettings().tm);
  useAmberSuppression(loadSettings().amberAsQ);
  void onSettingsChanged(s => {
    useTmSettings(s.tm);
    useAmberSuppression(s.amberAsQ);
  });
  try {
    const info = await windowInfo();
    if (info.kind === "settings") {
      const { mountSettings } = await import("./settingsWindow.ts");
      mountSettings(root);
    } else if (info.kind === "library") {
      const { mountLibrary } = await import("./libraryWindow.ts");
      mountLibrary(root);
    } else {
      const { mountMain } = await import("./mainWindow.ts");
      mountMain(root, info.paths);
    }
  } catch (e) {
    console.error(e);
    root.innerHTML = "";
    const pre = document.createElement("pre");
    pre.className = "ps-fatal";
    pre.textContent = `Strandivo couldn't start this window:\n\n${e instanceof Error ? e.stack || e.message : String(e)}`;
    root.appendChild(pre);
  }
}

void boot();
