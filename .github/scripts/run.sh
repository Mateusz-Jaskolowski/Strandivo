#!/usr/bin/env bash
# Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Runs a command and, if it fails, repeats the end of its output as a GitHub annotation.
# Annotations can be read through the GitHub API without downloading the full logs.
#
#   .github/scripts/run.sh "Step title" command args...
#   ANNOTATE_WARNINGS='regex' also reports matching lines when the command succeeds.
set -uo pipefail
title="$1"
shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}

encode() {
  local s
  # Drop progress lines (downloads, crates compiling) so the error itself fits.
  s="$(sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -vE '^ *(Downloaded|Downloading|Compiling|Checking|Fresh|Locking|Adding|Updating|Blocking) ' | tail -c 60000)"
  s="${s//'%'/'%25'}"
  s="${s//$'\r'/}"
  s="${s//$'\n'/'%0A'}"
  printf '%s' "$s"
}

if [ "$status" -ne 0 ]; then
  echo "::error title=${title} failed::$(grep -vE '^ *(Downloaded|Downloading|Compiling|Checking|Fresh) ' "$log" | tail -n 150 | encode)"
elif [ -n "${ANNOTATE_WARNINGS:-}" ]; then
  matches="$(grep -E -A6 "$ANNOTATE_WARNINGS" "$log" | head -n 300 || true)"
  if [ -n "$matches" ]; then
    echo "::warning title=${title} warnings::$(printf '%s' "$matches" | encode)"
  fi
fi
exit "$status"
