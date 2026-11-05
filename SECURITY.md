# Security

Please report a security problem privately, never in a public issue:

- on GitHub, with **Report a vulnerability** under this repository's *Security* tab, or
- by email to security@strandivo.com.

Say what is affected, how to reproduce it and what it could lead to. You'll get an answer
within a week, and credit in the release that fixes it if you'd like.

## What this covers

- The desktop app, in its latest release.
- The services it talks to: update checks (`updates.strandivo.com`), feedback
  (`feedback.strandivo.com`) and the website (`strandivo.com`).

Strandivo reads files from other software (GenBank, SnapGene, FASTA, `.ab1` traces and
more), so a file that makes it run code, read or write files it wasn't asked to, or reach
the network is a security problem too.
