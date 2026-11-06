// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Help → Send Feedback… and Report a Bug…: a bug, an idea or a question, sent as a GitHub
// issue through feedback.strandivo.com, so no GitHub account is needed. Everything sent
// with it is shown in full first; recent errors and the open file are off until ticked.
// The email address and the file go to the maintainer alone, never in the issue, which
// anyone can read. If it can't be sent, the text stays, with Copy and Email instead.

import { h, toast } from "../ui/dom.ts";
import { openDialog } from "../ui/modal.ts";
import { buildReport, describeSystem, FEEDBACK_KINDS, LIMITS, reportProblem, reportText, type FeedbackKind, type FeedbackReport, type SystemInfo } from "../lib/feedback.ts";
import { copyText, emailFeedback, openIssue, sendFeedback, systemInfo } from "../platform.ts";
import { recentErrors } from "../feedback.ts";

export interface FeedbackContext {
  /** Home, or the open file's view. */
  view: string;
  /** The file in the current tab, if there is one: its name and its GenBank text. */
  file: { name: string; contents: () => string } | null;
}

const PLACEHOLDERS: Record<FeedbackKind, string> = {
  bug: "What went wrong, in a line",
  idea: "What you'd like Strandivo to do",
  question: "What you'd like to know"
};

export async function openFeedback(kind: FeedbackKind, context: FeedbackContext): Promise<void> {
  const app: SystemInfo = await systemInfo();
  const errors = recentErrors();
  let chosen: FeedbackKind = kind;

  const dlg = openDialog({ title: "Send feedback", note: "It goes to Strandivo's maintainer as an issue on GitHub, which anyone can read. You don't need a GitHub account.", width: 580 });

  const kindButtons = FEEDBACK_KINDS.map(k =>
    h("button", { type: "button", "aria-pressed": String(k.id === chosen), onclick: () => setKind(k.id) }, k.label)
  );
  const summary = h("input", { class: "sv-input", type: "text", maxlength: LIMITS.summary, "aria-label": "Summary", placeholder: PLACEHOLDERS[chosen] }) as HTMLInputElement;
  const details = h("textarea", { class: "sv-input sv-feedback-details", rows: 6, maxlength: LIMITS.details, "aria-label": "Details", placeholder: "What you did and what happened, or anything else that helps" }) as HTMLTextAreaElement;
  const email = h("input", { class: "sv-input", type: "email", maxlength: LIMITS.email, "aria-label": "Your email", placeholder: "you@lab.org", autocomplete: "email" }) as HTMLInputElement;

  const withErrors = h("input", { type: "checkbox", disabled: errors.length === 0 }) as HTMLInputElement;
  const withFile = h("input", { type: "checkbox" }) as HTMLInputElement;
  // What the errors will read as, so the user sees exactly what goes.
  const scrubbed = buildReport({ kind, summary: "x", details: "", email: "", app, view: context.view, errors, file: null }).errors ?? [];
  const errorList = h("pre", { class: "sv-feedback-errors", hidden: true }, scrubbed.join("\n"));
  withErrors.addEventListener("change", () => (errorList.hidden = !withErrors.checked));

  const status = h("p", { class: "sv-feedback-status", "aria-live": "polite" });
  const send = h("button", { type: "button", class: "sv-btn sv-btn-primary", disabled: true, onclick: () => void submit() }, "Send") as HTMLButtonElement;
  const copy = h("button", { type: "button", class: "sv-btn", hidden: true, onclick: () => void copyReport() }, "Copy");
  const byEmail = h("button", { type: "button", class: "sv-btn", hidden: true, onclick: () => void emailReport() }, "Email instead");

  function setKind(k: FeedbackKind) {
    chosen = k;
    kindButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(FEEDBACK_KINDS[i].id === k)));
    summary.placeholder = PLACEHOLDERS[k];
  }

  const report = (): FeedbackReport => {
    let file: FeedbackReport["file"] = null;
    if (withFile.checked && context.file) file = { name: context.file.name, contents: context.file.contents() };
    return buildReport({ kind: chosen, summary: summary.value, details: details.value, email: email.value, app, view: context.view, errors: withErrors.checked ? errors : null, file });
  };

  const update = () => {
    send.disabled = !summary.value.trim();
  };
  summary.addEventListener("input", update);
  summary.addEventListener("keydown", e => {
    if (e.key === "Enter" && !send.disabled) void submit();
  });

  async function submit() {
    const r = report();
    const problem = reportProblem(r);
    if (problem) {
      status.className = "sv-feedback-status sv-text-bad";
      status.textContent = problem;
      return;
    }
    send.disabled = true;
    status.className = "sv-feedback-status";
    status.textContent = "Sending…";
    try {
      const sent = await sendFeedback(r);
      sentView(sent.number, (r.email !== null || r.file !== null) && !sent.emailed);
    } catch (e) {
      status.className = "sv-feedback-status sv-text-bad";
      status.textContent = e instanceof Error ? e.message : String(e);
      copy.hidden = false;
      byEmail.hidden = false;
      send.textContent = "Try again";
      update();
    }
  }

  async function copyReport() {
    try {
      await copyText(reportText(report()));
      toast("Copied the report", "success");
    } catch {
      toast("Couldn't copy the report", "error");
    }
  }

  async function emailReport() {
    const r = report();
    const kindLabel = FEEDBACK_KINDS.find(k => k.id === r.kind)?.label ?? "Feedback";
    await emailFeedback(`${kindLabel}: ${r.summary}`, reportText(r)).catch(() => toast("Couldn't open your mail app. Write to feedback@strandivo.com.", "error", 6000));
  }

  function sentView(number: number, notEmailed: boolean) {
    dlg.body.replaceChildren(
      h("p", { class: "sv-feedback-thanks" }, `Thanks: sent as #${number}.`),
      h("p", { class: "sv-small" }, "You can follow it on GitHub, where the maintainer answers."),
      notEmailed
        ? h("p", { class: "sv-small sv-text-warn" }, "Your email address or file couldn't be passed on to the maintainer. If you'd like an answer, write to feedback@strandivo.com and mention the issue's number.")
        : ""
    );
    dlg.footer.replaceChildren(
      h("button", { type: "button", class: "sv-btn", onclick: () => void openIssue(number) }, "Open on GitHub"),
      h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => dlg.close() }, "Close")
    );
  }

  const field = (label: string, control: HTMLElement, hint?: string) =>
    h("label", { class: "sv-dlg-field" }, h("span", { class: "sv-dlg-label" }, label), control, hint ? h("span", { class: "sv-small sv-dim" }, hint) : "");
  const option = (box: HTMLInputElement, label: string, note: string, extra?: HTMLElement) =>
    h("div", null, h("label", { class: "sv-welcome-option" }, box, h("span", null, h("span", { class: "sv-welcome-label" }, label), h("span", { class: "sv-small sv-dim" }, note))), extra ?? "");

  dlg.body.classList.add("sv-feedback");
  dlg.body.replaceChildren(
    h("div", { class: "sv-segmented sv-segmented-small", role: "group", "aria-label": "Kind" }, ...kindButtons),
    field("Summary", summary),
    field("Details", details),
    field("Your email", email, "Only if you'd like an answer. It goes to the maintainer alone, never in the issue."),
    h(
      "section",
      { class: "sv-feedback-sent" },
      h("h3", { class: "sv-section-title" }, "Sent with it"),
      h("ul", { class: "sv-small" }, h("li", null, describeSystem(app)), h("li", null, `Open view: ${context.view}`)),
      option(withErrors, errors.length ? `Recent errors (${errors.length})` : "Recent errors (none)", "What went wrong in this window lately, with file paths removed. Shown below when ticked.", errorList),
      context.file
        ? option(withFile, `Attach the open file (${context.file.name})`, "As GenBank, to the maintainer alone by email, not in the issue. Sequences can be confidential: attach only what you may share.")
        : ""
    )
  );
  dlg.footer.replaceChildren(h("div", { class: "sv-foot-start" }, status), copy, byEmail, h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"), send);
  summary.focus();
}
