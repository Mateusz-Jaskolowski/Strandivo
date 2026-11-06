# Privacy

Strandivo is a desktop app, and your work stays on your computer. Your sequences, files,
file names, folders, features, primers and notes are never sent anywhere by the app.

This page lists everything the app does send, and when. It is the one list:
strandivo.com/privacy is made from it, so the two can't disagree. Strandivo is maintained by
Mateusz Jaskolowski; questions about this page go to hello@strandivo.com.

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

- **Recent errors**: what went wrong in the app's window lately, with file paths
  removed. The dialog shows them as they will be sent.
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

## Usage statistics

From Strandivo 0.3.0 the app can count which of its features are used, and on which
systems, so that work goes where it helps most. It is **off unless you turn it on**: the
welcome window asks, and "Share anonymous usage statistics" in Settings → Updates and
privacy turns it on or off at any time. Until you turn it on, nothing is sent, and
turning it off sends nothing either, not even that you turned it off; anything waiting to
be sent is dropped at once.

When it is on, the app sends these events, and nothing else. Every detail an event carries
is one of a few fixed words or a number put in a range (0, 1, 2–5, 6–20 or more than 20),
so none can hold a name, a sequence or anything you typed:

- `app_started`: the app was opened, with `arch`, the processor (Apple silicon or ARM,
  Intel or AMD).
- `file_opened`: a file was opened, with `format`, its kind (GenBank, SnapGene, FASTA,
  EMBL or other), worked out from its name; never the name itself.
- `view_shown`: one of a file's five views was shown, with `view` (Map, Sequence,
  Primers, Reads or Info).
- `dialog_completed`: a tool made or added something, with `dialog` (a digest, cloning, primer
  design, a PCR product, mutagenesis primers or finding known parts), the `method` for
  cloning and mutagenesis (such as Gibson or overlapping), and for found parts `parts`,
  how many were added, as a range.
- `primer_pairs`: the Primers tab's Pairs view was shown, or its Export list was used, as
  `action`.
- `reads_aligned`: reads were checked against a sequence, with `reads`, how many, as a
  range, and `kind`, whether Sanger reads, long reads or both.
- `check_saved`: a read check was saved as a file.
- `update_installed`: the app was updated to a new version.
- `error`: something went wrong in the app's window, with `kind` (a script error, a
  promise nobody caught or a command that failed); never the message, which could name a
  file.

Every event also carries the app's version, the operating system and its version, the
time, and a session number: a random number the app makes when it starts and drops after
four hours without events. It is never stored, so it can't link one day's use to the next.
Events are sent every 30 seconds while the app is open. A copy built for testing or
development sends none.

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

- No usage statistics unless you turn them on, and then only the events listed above.
- No account, no sign-in, no identifier for your copy of the app.
- No crash reports and no error messages are sent on their own: messages go only in a
  feedback report, and only if you tick them. With usage statistics on, an error is
  counted by its kind alone.
