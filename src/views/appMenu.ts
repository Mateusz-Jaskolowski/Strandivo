// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The menu button at the right end of the app bar, in a browser only, where there is no
// menu bar: the native menu's items (src/lib/appMenu.ts) in a menu drawn in the page, with
// the keys that work there.

import { h } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { showContextMenu, type ContextMenuEntry } from "../platform.ts";
import { APP_MENU } from "../lib/appMenu.ts";
import { shortcutFor, shortcutText } from "../lib/shortcuts.ts";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** `run` runs an item by its id, as the native menu does; `hasFile` greys out items that need a file. */
export function appMenuButton(run: (id: string) => void, hasFile: () => boolean): HTMLElement {
  const entries = (): ContextMenuEntry[] =>
    APP_MENU.map(group => ({
      label: group.label,
      items: group.items.map((item): ContextMenuEntry => {
        if (item === "separator") return "separator";
        const key = shortcutFor(item.id, { mac: isMac, browser: true });
        return { label: item.label, enabled: !item.file || hasFile(), shortcut: key ? shortcutText(key, isMac) : undefined, run: () => run(item.id) };
      })
    }));
  const button = h("button", { type: "button", class: "sv-icon-btn sv-appmenu-btn", "aria-label": "Menu", "aria-haspopup": "menu", title: "Menu" }, iconSvg("menu", 17)) as HTMLButtonElement;
  // A click while the menu is open closes it, rather than closing and opening it again: the
  // menu closes itself on the press, so whether it was open is noted before that, by a
  // listener registered before any menu's own.
  let wasOpen = false;
  window.addEventListener("pointerdown", () => (wasOpen = !!document.querySelector(".ps-context-menu")), { capture: true });
  button.addEventListener("click", () => {
    if (wasOpen) {
      wasOpen = false;
      return;
    }
    const r = button.getBoundingClientRect();
    void showContextMenu(entries(), { x: r.right, y: r.bottom + 4 });
  });
  return button;
}
