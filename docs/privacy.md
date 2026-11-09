# Privacy

Strandivo runs on your computer, as a desktop app or in your web browser, and your work
stays there. Your sequences, files, file names, folders, features, primers and notes are
never sent anywhere by the app.

This page lists everything the app does send, and when. It is the one list:
strandivo.com/privacy is made from it, so the two can't disagree. Strandivo is maintained by
Mateusz Jaskolowski; questions about this page go to hello@strandivo.com.

## The browser version

Strandivo also runs in a web browser. It is the same app, served as plain files with
nothing of ours behind them that could receive anything, and your files stay on your
computer:

- A file you open is read by your browser, on your computer, and never uploaded. Saving
  writes it back where it came from (in Chrome and Edge) or saves a copy to your
  Downloads folder (in other browsers).
- Aligning reads and finding features run in your browser too, in the page itself.
- The folders you add to Home, recent files, remembered reads, notes and settings are kept
  by your browser, for this site only, on this computer. Clearing the site's data in your
  browser removes them.

It sends what the app sends, as listed on this page, with three differences:

- **Usage statistics are on unless you turn them off.** The welcome window says so on your
  first visit and has Turn off, and "Share anonymous usage statistics" in Settings →
  Privacy turns them off or on at any time. They are off whenever your browser asks sites
  not to track you (Global Privacy Control). What they hold is under Usage statistics.
- There is nothing to update: each visit loads the latest release.
- A bug report names the browser and its major version, such as Chrome 142, and the
  operating system, in place of the system's version and the processor.

The page is served by Cloudflare, which sees each visit as any website's host does: that
the page was loaded, from which address and browser. It never sees a file.

You can check all this. The page's Content Security Policy, a rule your browser enforces
whatever the page's code tries, lets it connect to its own site, UniProt
(`rest.uniprot.org`), the feedback service (`feedback.strandivo.com`) and Aptabase
(`eu.aptabase.com`), and nothing else. The policy is in the page's headers for anyone to
read, and your browser's developer tools list every request the page makes: none carries
a file.

## Checking for updates

Once a day, while "Check for updates automatically" is on, and whenever you choose Check
for Updates…, the app asks `updates.strandivo.com` whether there is a newer version. The
question carries:

- the app's version, such as 0.2.1;
- the operating system, such as macOS or Windows;
- the processor, such as Apple silicon or Intel.

Like any connection on the internet, it also comes from your network's address. The
service answers with the newest version's details. All it keeps is a count: one more
check that day for that version, operating system and processor, which tells roughly how
many copies are in use. It doesn't record the address or anything that tells one copy
from another, and it has no logs. It runs on Cloudflare, which carries the connection.

You can turn automatic checks off in the welcome window or in Settings → Updates and
privacy. Check for Updates… still works when you ask.

## Installing an update

When you choose to install an update, the app downloads it from GitHub, where Strandivo's
releases are published. GitHub sees that download as it sees any other, under
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## Looking up a protein in UniProt

When you look up a UniProt entry for a protein's regions, the app asks UniProt
(`rest.uniprot.org`, run by EMBL-EBI and its partners) for that one entry, by its
accession, such as P42212. Nothing else goes with it: not the sequence, not the file. It
happens only when you ask. UniProt's own
[privacy notice](https://www.uniprot.org/help/privacy) covers what it keeps.

## Sending feedback

Help → Send Feedback… and Report a Bug… send what you write to `feedback.strandivo.com`,
only when you click Send. The dialog shows everything that goes with it before you send:

- what kind it is (a bug, an idea or a question), your summary and your details;
- the app's version, the operating system and its version, and the processor;
- which part of the app was open, such as Home or the Map.

Two more things go only if you tick them, and both are off each time the dialog opens:

- **Recent errors**: what went wrong in the app's windows in the past week, at most the
  last 20, with file paths removed. The dialog shows them as they will be sent. They are
  kept on your computer, so a report after a crash still has them, and dropped after a
  week.
- **The open file**, as GenBank.

The service files your report as an issue in Strandivo's repository on GitHub, where
anyone can read it, and tells you its number. Your email address, if you give one, and
the open file, if you attach it, never go in the issue: they are emailed to the
maintainer alone, with the issue's link, so the maintainer can answer you. The service
keeps nothing itself and has no logs. To stop floods it lets each network send a few
reports a minute, which Cloudflare counts for that minute and forgets. GitHub keeps the
issue under [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement);
the email stays in the maintainer's mailbox. To have an issue or an email removed, write
to hello@strandivo.com.

If a report can't be sent, nothing leaves the app: you can copy it, or email it to
feedback@strandivo.com from your own mail app instead.

## Reporting a crash

If Strandivo quits unexpectedly, it writes down why, in a small file in the app's own
folder on your computer: the error's message, where in Strandivo's code it happened,
which part of the app was running (its thread), the app's version, the operating system
and the processor, and the time. Nothing is sent then.

The next time it opens, the app reads that file once and deletes it, and a strip under
the app bar says "Strandivo quit unexpectedly last time." Dismiss forgets it. Report it…
opens Report a Bug with **Why it quit** ticked and shown in full, as it will be sent: the
message with file paths removed, where in the code, the thread, the version that quit and
the time. It goes only if you click Send, as part of a bug report (see Sending feedback),
and you can untick it first. Recent errors stay off unless you tick them.

## Usage statistics

From Strandivo 0.3.0 the app can count which of its features are used, and on which
systems, so that work goes where it helps most. In the desktop app it is **off unless you
turn it on**: the welcome window asks, and "Share anonymous usage statistics" in Settings →
Updates and privacy turns it on or off at any time. Until you turn it on, nothing is sent.
In the browser version it is on unless you turn it off (see The browser version). Turning
it off sends nothing, not even that you turned it off; anything waiting to be sent is
dropped at once.

When it is on, the app sends these events, and nothing else. Every detail an event carries
is one of a few fixed words or a number put in a range, so none can hold a name, a
sequence or anything you typed. A count's ranges are 0, 1, 2–5, 6–20 and more than 20;
other numbers have their own few ranges, given below.

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

In the browser version the page sends each event itself, with the app's version, the time
and the session number, which is kept only while the page is open: closing or reloading it
starts a new one. Aptabase reads the browser and the operating system from the request, as
any website can. Nothing is stored for statistics, so `app_started` has no `installed`
there, and its processor is always "other". Events also go as the page closes, so the last
ones aren't lost. Only the browser version the project publishes sends; a preview of a
version still being tried marks its events as tests.

They go to [Aptabase](https://aptabase.com), an open-source service for app statistics,
in its EU region. Like any server, it sees the address the events come from: it uses it
to tell the country and region, and to count visitors a day with a code that changes
every day, and it doesn't keep the address. Aptabase's own
[privacy policy](https://aptabase.com/legal/privacy) covers what it keeps.

## Opening the website

What's new… and some help items open strandivo.com or GitHub in your web browser. The app
sends nothing itself; your browser visits the page as it would any other.

## This website

strandivo.com has no cookies and no tracking. Its one script, on the home and Download
pages, asks your browser which system it runs on, so that the right download comes
first; it sends nothing and stores nothing. The site is served by Cloudflare, which
handles each visit to deliver the page.

## What the app doesn't do

- No usage statistics in the desktop app unless you turn them on, none in the browser
  version once you turn them off, and only ever the events listed above.
- No account, no sign-in, no identifier for your copy of the app.
- No crash reports and no error messages are sent on their own: they go only in a bug
  report you send, and only as shown in it. With usage statistics on, an error or a crash
  is counted by its kind alone.
