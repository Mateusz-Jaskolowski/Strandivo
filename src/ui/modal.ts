// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// In-window modal dialog with any number of buttons (native dialogs only offer two).

import { h } from "./dom.ts";

export interface ModalButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

export function choose<T>(title: string, message: string, buttons: ModalButton<T>[], cancelValue: T): Promise<T> {
  return new Promise(resolve => {
    const done = (v: T) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(cancelValue);
      } else if (e.key === "Enter") {
        const primary = buttons.find(b => b.primary);
        if (primary) {
          e.preventDefault();
          e.stopPropagation();
          done(primary.value);
        }
      }
    };
    const overlay = h(
      "div",
      { class: "ps-modal-overlay" },
      h(
        "div",
        { class: "ps-modal", role: "dialog", "aria-modal": "true" },
        h("h3", null, title),
        h("p", null, message),
        h(
          "div",
          { class: "ps-modal-buttons" },
          buttons.map(b =>
            h(
              "button",
              {
                class: `ps-btn${b.primary ? " ps-btn-primary" : ""}${b.danger ? " ps-btn-danger" : ""}`,
                onclick: () => done(b.value)
              },
              b.label
            )
          )
        )
      )
    );
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    (overlay.querySelector(".ps-btn-primary") as HTMLButtonElement | null)?.focus();
  });
}

export interface Dialog {
  readonly el: HTMLElement;
  /** Fill with `body.replaceChildren(…)`; it scrolls when tall. */
  readonly body: HTMLElement;
  /** Buttons along the bottom; empty hides it. */
  readonly footer: HTMLElement;
  close(): void;
}

let openDialogs = 0;
/** True while a dialog covers the window (shortcuts that act on the document can wait). */
export const dialogOpen = () => openDialogs > 0;

/**
 * A task dialog over the window (Design primers, PCR product…): title, a body the caller
 * fills, buttons at the bottom. Escape or the close button closes it.
 */
export function openDialog(o: { title: string; note?: string; width?: number; onClose?: () => void }): Dialog {
  const before = document.activeElement as HTMLElement | null;
  const body = h("div", { class: "sv-dialog-body" });
  const footer = h("div", { class: "sv-dialog-foot" });
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openDialogs--;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    o.onClose?.();
    if (before?.isConnected) before.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const closeBtn = h("button", { type: "button", class: "sv-dialog-close", "aria-label": "Close", onclick: close });
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
  const el = h(
    "div",
    { class: "sv-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, style: o.width ? { width: `min(${o.width}px, calc(100vw - 32px))` } : undefined },
    h("div", { class: "sv-dialog-head" }, h("div", null, h("h2", { id: titleId, class: "sv-dialog-title" }, o.title), o.note ? h("p", { class: "sv-dialog-note" }, o.note) : ""), closeBtn),
    body,
    footer
  );
  // A textarea dragged taller grows only while the dialog has room, so the dialog never
  // has to scroll its other fields out of sight.
  body.addEventListener("pointerdown", e => {
    if (!(e.target instanceof HTMLTextAreaElement)) return;
    const room = parseFloat(getComputedStyle(el).maxHeight) - el.offsetHeight;
    if (Number.isFinite(room)) e.target.style.maxHeight = `${e.target.offsetHeight + Math.max(0, room)}px`;
  });
  const overlay = h("div", { class: "sv-dialog-overlay" }, el);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
  openDialogs++;
  requestAnimationFrame(() => {
    if (closed) return;
    const first = body.querySelector<HTMLElement>("input:not([type=checkbox]), select, textarea, button") ?? closeBtn;
    first.focus();
  });
  return { el, body, footer, close };
}
