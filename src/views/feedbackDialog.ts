// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Help → Send Feedback… and Report a Bug…: a bug, an idea or a question, sent as a GitHub
// issue through feedback.strandivo.com, so no GitHub account is needed. Everything sent
// with it is shown in full first; recent errors and the open file are off until ticked.
// The email address and the file go to the maintainer alone, never in the issue, which
// anyone can read; a name to credit goes in it, and is remembered once sent. If it can't
// be sent, the text stays, with Copy and Email instead. Post on GitHub instead opens the
// issue on GitHub, filled in, for people who'd rather post from their own account.
// Opened from "Strandivo quit unexpectedly" (src/crash.ts), it is a bug about that crash,
// with what the app noted shown in full and ticked, as reporting it is why it opened.

import { h, toast } from "../ui/dom.ts";
import { openDialog } from "../ui/modal.ts";
import { buildReport, crashForReport, crashLines, creditName, describeSystem, FEEDBACK_KINDS, LIMITS, reportProblem, reportText, type CrashReport, type FeedbackKind, type FeedbackReport, type SystemInfo } from "../lib/feedback.ts";
import { copyText, emailFeedback, openIssue, openNewIssue, sendFeedback, systemInfo } from "../platform.ts";
import { recentErrors, rememberedName, rememberName } from "../feedback.ts";

export interface FeedbackContext {
  /** Home, or the open file's view. */
  view: string;
  /** The file in the current tab, if there is one: its name and its GenBank text. */
  file: { name: string; contents: () => string } | null;
}

/** A crash to report, and what to do once the report has gone. */
export interface CrashToReport {
  crash: CrashReport;
  sent(): void;
}

const PLACEHOLDERS: Record<FeedbackKind, string> = {
  bug: "Brief summary of what went wrong",
  idea: "What you'd like Strandivo to do",
  question: "What you'd like to know"
};

export async function openFeedback(kind: FeedbackKind, context: FeedbackContext, crashed?: CrashToReport): Promise<void> {
  const app: SystemInfo = await systemInfo();
  const errors = recentErrors();
  let chosen: FeedbackKind = crashed ? "bug" : kind;

  const dlg = openDialog({ title: "Send feedback", note: "Posts a public issue on Strandivo's GitHub. No GitHub account needed.", width: 580 });

  const kindButtons = FEEDBACK_KINDS.map(k =>
    h("button", { type: "button", "aria-pressed": String(k.id === chosen), onclick: () => setKind(k.id) }, k.label)
  );
  const summary = h("input", { class: "sv-input", type: "text", maxlength: LIMITS.summary, "aria-label": "Summary", placeholder: PLACEHOLDERS[chosen] }) as HTMLInputElement;
  const details = h("textarea", { class: "sv-input sv-feedback-details", rows: 6, maxlength: LIMITS.details, "aria-label": "Details", placeholder: crashed ? "What you were doing when it quit, if you remember" : "What you did and what happened, or anything else that helps" }) as HTMLTextAreaElement;
  if (crashed) summary.value = "Strandivo quit unexpectedly";
  const name = h("input", { class: "sv-input", type: "text", maxlength: LIMITS.name, "aria-label": "Your name", placeholder: "Name or initials", autocomplete: "name", value: rememberedName() }) as HTMLInputElement;
  const email = h("input", { class: "sv-input", type: "email", maxlength: LIMITS.email, "aria-label": "Your email", placeholder: "you@lab.org", autocomplete: "email" }) as HTMLInputElement;
  // The name as the issue will show it, listed with the rest of what is sent.
  const sentBy = h("li");
  const showName = () => {
    const shown = creditName(name.value);
    sentBy.textContent = `Sent by: ${shown}`;
    sentBy.hidden = !shown;
  };
  showName();
  name.addEventListener("input", showName);

  const withErrors = h("input", { type: "checkbox", disabled: errors.length === 0 }) as HTMLInputElement;
  const withFile = h("input", { type: "checkbox" }) as HTMLInputElement;
  // What the errors will read as, so the user sees exactly what goes.
  const scrubbed = buildReport({ kind, summary: "x", details: "", email: "", app, view: context.view, errors, file: null }).errors ?? [];
  const errorList = h("pre", { class: "sv-feedback-errors", hidden: true }, scrubbed.join("\n"));
  withErrors.addEventListener("change", () => (errorList.hidden = !withErrors.checked));
  // The crash as it will be sent, paths removed: ticked, as reporting it is why this opened.
  const crash = crashed ? crashForReport(crashed.crash) : null;
  const withCrash = h("input", { type: "checkbox", checked: !!crash }) as HTMLInputElement;
  const crashText = h("pre", { class: "sv-feedback-errors sv-feedback-crash" }, crash ? crashLines(crash).join("\n") : "");
  withCrash.addEventListener("change", () => (crashText.hidden = !withCrash.checked));

  const status = h("p", { class: "sv-feedback-status", "aria-live": "polite" });
  const send = h("button", { type: "button", class: "sv-btn sv-btn-primary", disabled: true, onclick: () => void submit() }, "Send") as HTMLButtonElement;
  const copy = h("button", { type: "button", class: "sv-btn", hidden: true, onclick: () => void copyReport() }, "Copy");
  const byEmail = h("button", { type: "button", class: "sv-btn", hidden: true, onclick: () => void emailReport() }, "Email instead");
  const onGitHub = h("button", { type: "button", class: "sv-link", title: "Opens a new issue on GitHub with what you've written, to post from your own account", onclick: () => void postOnGitHub() }, "Post on GitHub instead");

  function setKind(k: FeedbackKind) {
    chosen = k;
    kindButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(FEEDBACK_KINDS[i].id === k)));
    summary.placeholder = PLACEHOLDERS[k];
  }

  /** The report as the dialog shows it; `attach` false leaves out the file, which only the service takes. */
  const report = (attach = true): FeedbackReport => {
    let file: FeedbackReport["file"] = null;
    if (attach && withFile.checked && context.file) file = { name: context.file.name, contents: context.file.contents() };
    return buildReport({ kind: chosen, summary: summary.value, details: details.value, email: email.value, name: name.value, app, view: context.view, errors: withErrors.checked ? errors : null, file, crash: crashed && withCrash.checked ? crashed.crash : null });
  };

  const update = () => {
    send.disabled = !summary.value.trim();
  };
  update();
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
      rememberName(r.name);
      if (r.crash) crashed?.sent();
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

  /** The issue opens filled in on GitHub, to post as themselves; their email and file stay here. */
  async function postOnGitHub() {
    try {
      await openNewIssue(report(false));
      dlg.close();
    } catch {
      toast("Couldn't open GitHub in your browser. Copy the report instead.", "error", 6000);
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
      h("p", { class: "sv-feedback-thanks" }, `Thanks — sent as #${number}.`),
      h("p", { class: "sv-small" }, "You can follow replies on GitHub."),
      notEmailed
        ? h("p", { class: "sv-small sv-text-warn" }, "Your email address or attached file couldn't be delivered. To get a reply, email feedback@strandivo.com with the issue number.")
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
    field("Your name", name, "Optional, to credit you in the public issue."),
    field("Your email", email, "Optional, if you'd like a reply. Shared only with the maintainer, never in the public issue."),
    h(
      "section",
      { class: "sv-feedback-sent" },
      h("h3", { class: "sv-section-title" }, "Included with the report"),
      h("ul", { class: "sv-small" }, h("li", null, describeSystem(app)), h("li", null, `Open view: ${context.view}`), sentBy),
      crash ? option(withCrash, "Crash details", "The crash log with file paths removed, shown below.", crashText) : "",
      option(withErrors, errors.length ? `Recent errors (${errors.length})` : "Recent errors (none)", "App errors from the past week, with file paths removed.", errorList),
      context.file
        ? option(withFile, `Attach the open file (${context.file.name})`, "Sent privately to the maintainer as GenBank, never in the public issue. Attach only sequences you're allowed to share.")
        : ""
    )
  );
  dlg.footer.replaceChildren(h("div", { class: "sv-foot-start sv-feedback-foot" }, onGitHub, status), copy, byEmail, h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"), send);
  (crashed ? details : summary).focus();
}
