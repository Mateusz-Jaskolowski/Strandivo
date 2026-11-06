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
service answers with the newest version's details and keeps nothing: it doesn't record
the question, the address or anything else, and it has no logs. It runs on Cloudflare,
which carries the connection.

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

## Opening the website

What's new… and some help items open strandivo.com or GitHub in your web browser. The app
sends nothing itself; your browser visits the page as it would any other.

## This website

strandivo.com has no cookies and no tracking. Its one script, on the home and Download
pages, asks your browser which system it runs on, so that the right download comes
first; it sends nothing and stores nothing. The site is served by Cloudflare, which
handles each visit to deliver the page.

## What the app doesn't do

- No usage statistics are sent. If they are added, they will be off until you turn them
  on, and this page will list every one before any copy sends them.
- No account, no sign-in, no identifier for your copy of the app.
- No crash reports and no error reports are sent on their own.
