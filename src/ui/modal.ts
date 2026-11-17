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

/**
 * What covers the window, the topmost last. Every modal listens for keys on `document`,
 * the oldest first, so each must check it is the topmost before answering one.
 */
const layers: object[] = [];
const leave = (layer: object) => {
  const i = layers.indexOf(layer);
  if (i >= 0) layers.splice(i, 1);
};

export function choose<T>(title: string, message: string, buttons: ModalButton<T>[], cancelValue: T): Promise<T> {
  return new Promise(resolve => {
    const layer = {};
    layers.push(layer);
    const done = (v: T) => {
      leave(layer);
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (layers[layers.length - 1] !== layer) return;
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

/** True while a dialog covers the window (shortcuts that act on the document can wait). */
export const dialogOpen = () => layers.length > 0;

export interface DialogOptions {
  title: string;
  note?: string;
  width?: number;
  onClose?: () => void;
  /** Escape while this dialog is on top: true if it was handled here, so the dialog stays. */
  onEscape?: () => boolean;
}

/**
 * A task dialog over the window (Design primers, PCR product…): title, a body the caller
 * fills, buttons at the bottom. Escape or the close button closes it; an editor can handle
 * Escape first by returning true from `onEscape`. One that belongs to an open file is opened
 * through its `DocContext.openDialog`, so it goes with its tab.
 */
export function openDialog(o: DialogOptions): Dialog {
  const before = document.activeElement as HTMLElement | null;
  const layer = {};
  layers.push(layer);
  const body = h("div", { class: "sv-dialog-body" });
  const footer = h("div", { class: "sv-dialog-foot" });
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    leave(layer);
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    o.onClose?.();
    if (before?.isConnected) before.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented && layers[layers.length - 1] === layer) {
      e.preventDefault();
      e.stopPropagation();
      if (!o.onEscape?.()) close();
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
  requestAnimationFrame(() => {
    if (closed) return;
    const first = body.querySelector<HTMLElement>("input:not([type=checkbox]), select, textarea, button") ?? closeBtn;
    first.focus();
  });
  return { el, body, footer, close };
}

/**
 * The dialogs of one place that goes away while they are open (a file's tab). Closing
 * them with it is the same as Cancel: nothing they would have applied is.
 */
export interface DialogGroup {
  open(o: DialogOptions): Dialog;
  /** Closes the dialogs still open, the topmost first. */
  closeAll(): void;
}

export function dialogGroup(): DialogGroup {
  const open = new Set<Dialog>();
  let closing = false;
  return {
    open: o => {
      const dlg: Dialog = openDialog({
        ...o,
        onClose: () => {
          open.delete(dlg);
          o.onClose?.();
        }
      });
      open.add(dlg);
      // A dialog's `onClose` can bring back the one it came from (the region editor and
      // Protein details): while the group closes, that one is closed again at once.
      if (closing) dlg.close();
      return dlg;
    },
    closeAll: () => {
      closing = true;
      try {
        [...open].reverse().forEach(d => d.close());
      } finally {
        closing = false;
      }
    }
  };
}
