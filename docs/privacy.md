# Privacy

Strandivo is a desktop app, and your work stays on your computer. Your sequences, files,
file names, folders, features, primers and notes are never sent anywhere by the app.

This page lists everything the app sends over the network and when. Strandivo is
maintained by Mateusz Jaskolowski; questions about this page go to hello@strandivo.com.

## Checking for updates

Once a day, while "Check for updates automatically" is on, and whenever you choose Check
for Updates…, the app asks `updates.strandivo.com` whether there is a newer version. The
request carries:

- the app's version, such as 0.2.1;
- the operating system, such as macOS or Windows;
- the processor, such as Apple silicon or Intel.

Like any internet connection, the request comes from your IP address. The service replies
with the latest version's details and only increments a daily counter for that version,
operating system and processor. It keeps no logs and never records your IP address or
anything that identifies your copy of the app. It runs on Cloudflare.

You can turn automatic checks off in the welcome window or in Settings → Updates and
privacy. Check for Updates… still works when you ask.

## Installing an update

When you choose to install an update, the app downloads it from GitHub, where Strandivo's
releases are published. GitHub sees that download as it sees any other, under
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## Looking up a protein in UniProt

When you look up a UniProt entry for a protein's regions, the app queries UniProt
(`rest.uniprot.org`, run by EMBL-EBI and its partners) for that accession alone, such as
P42212. Neither your sequence nor your file is sent, and the lookup happens only when you
ask. UniProt's [privacy notice](https://www.uniprot.org/help/privacy) covers what it
keeps.

## Sending feedback

Help → Send Feedback… and Report a Bug… send your report to `feedback.strandivo.com` only
when you click Send. The dialog shows everything included with the report before you send
it:

- the report type (bug, idea or question), summary and details;
- the app's version, operating system and processor;
- which view was open, such as Home or Map.

Two optional items are included only if you tick them (both are unticked by default):

- **Recent errors**: up to 20 app errors from the past week, with file paths removed and
  previewed in the dialog. They are stored locally on your computer for up to a week so a
  report after a crash can still include them.
- **The open file**, formatted as GenBank.

The service posts your report as a public issue on Strandivo's GitHub repository and
returns the issue number. Your email address and any attached file are never included in
the public issue — they are emailed privately to the maintainer with a link to the issue.
The service keeps no logs or copies of its own, aside from a per-minute rate limit in
Cloudflare to prevent spam. GitHub stores the issue under
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement),
and any email stays in the maintainer's mailbox. To have an issue or email removed, write
to hello@strandivo.com.

If a report can't be sent, nothing leaves the app: you can copy the report text or email
it to feedback@strandivo.com from your mail app instead.

## Reporting a crash

If Strandivo quits unexpectedly, it writes a local crash log in its app data folder with
the error message, code location, thread, app version, operating system, processor and
timestamp. Nothing is sent automatically.

On the next launch, Strandivo reads that file once, deletes it, and shows a banner:
"Strandivo quit unexpectedly last time." Clicking Dismiss clears it. Clicking Report it…
opens the bug report dialog with **Crash details** ticked and previewed in full (with file
paths removed). It is sent only if you click Send, and you can untick it first. Recent
errors remain unticked unless you opt in.

## Usage statistics

Strandivo can share anonymous counts of which features are used and on which operating
systems. This is **off by default**: you can turn it on or off on first launch or at any
time in Settings → Updates and privacy. When it is off, nothing is sent; turning it off
takes effect immediately and discards any queued events.

When enabled, the app sends only the events listed below. Event properties use fixed
categories or coarse numeric buckets (0, 1, 2–5, 6–20 and >20 unless noted below), never
file names, sequences or user text.

- `app_started`: the app was opened, with `arch`, the processor (Apple silicon or ARM,
  Intel or AMD); `installed`, how long ago this copy was first opened (its first day,
  first week, first month or longer: the date itself stays on your computer); and
  `folders`, how many folders Home lists, as a range.
- `settings_chosen`: once each time the app opens, three choices from Settings: `tm`, the
  Tm method; `amber`, whether TAG is read as Q; and `bases`, whether bases are shown in
  upper case, lower case or as in the file.
- `file_opened`: a file was opened, with `format`, its kind (GenBank, SnapGene, FASTA,
  EMBL or other), worked out from its name, never the name itself; `from`, whether it
  was opened from Home, dropped on the window or opened another way; `length`, its
  sequence's length (under 5 kb, 5–15 kb, 15–50 kb or longer); and `topology`, circular
  or linear.
- `file_saved`: a file was saved or exported, with `format` (GenBank or FASTA) and `how`
  (saved, or exported as a copy).
- `view_used`: one of a file's five views was used, with `view` (Map, Sequence, Primers,
  Reads or Info); once a view each time the app opens.
- `feature_added`: a feature was added, with `how`: from the selection, from an ORF or
  from a protein's region.
- `features_detected`: known parts found in a sequence were added, with `found`, how
  many, as a range.
- `primer_added`: a primer was added, with `how`: from the selection, typed in, or from
  the primer library.
- `primers_designed`, `pcr_product_made`, `digest_simulated`: primer design, the PCR
  product dialog or a digest was used to the end.
- `mutagenesis_designed`: mutagenesis primers were made, with `layout`, back to back or
  overlapping.
- `cloning_simulated`: a cloning was simulated, with `method` (restriction, Gibson,
  In-Fusion or Golden Gate).
- `primer_pairs_shown`, `primer_pairs_exported`: the Primers tab's Pairs view was shown,
  or its Export list was used.
- `reads_added`: reads were added to a file, with `format` (AB1, FASTA, FASTQ, GenBank or
  a mix) and `reads`, how many, as a range.
- `reads_aligned`: reads were checked against a sequence, with `reads`, how many, as a
  range; `kind`, whether Sanger reads, long reads or both; `took`, how long it took
  (under a second, 1–5 seconds, 5–30 seconds or longer); and `variable`, whether the
  sequence has variable regions.
- `check_saved`: a read check was saved as a file.
- `update_installed`: the app was updated to a new version.
- `error_caught`: something went wrong in the app's window, with `kind` (a script error,
  a promise nobody caught, a command that failed, or a crash, counted when the app next
  opens); never the message, which could name a file.

Every event also carries the app's version, the operating system and its version, the
time, and a session number: a random number the app makes when it starts and drops after
four hours without events. It is never stored, so it can't link one day's use to the next.
Events are sent every 30 seconds while the app is open. A test version (a release
candidate, such as 0.4.0-rc.1) marks its events as tests, which Aptabase keeps apart from
everyone else's. A copy built by the project's checks sends none, and neither does one
built from the source, unless whoever builds it adds the project's key, which only its
maintainers have; theirs are marked as tests too.

They go to [Aptabase](https://aptabase.com), an open-source service for app statistics,
in its EU region. Like any server, it sees the address the events come from: it uses it
to tell the country and region, and to count visitors a day with a code that changes
every day, and it doesn't keep the address. Aptabase's own
[privacy policy](https://aptabase.com/legal/privacy) covers what it keeps.

## Opening the website

What's new… and some help items open strandivo.com or GitHub in your web browser. The app
sends nothing itself; your browser visits the page as it would any other.

## This website

strandivo.com uses no cookies and no tracking. Its single script (on the home and Download
pages) checks which operating system your browser runs on so the matching installer is
shown first; it sends and stores nothing. The site is hosted on Cloudflare Pages.

## What the app doesn't do

- No usage statistics unless you opt in, and then only the events listed above.
- No user accounts, sign-in or persistent device identifiers.
- No automatic crash or error reporting: logs are sent only when you submit a bug report,
  and only as shown in the dialog. With usage statistics enabled, errors and crashes are
  counted by category alone.
