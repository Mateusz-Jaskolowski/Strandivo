#!/usr/bin/env bash
# Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Fails if AGENTS.md names a file or folder (in `backticks`) that doesn't exist, so the
# agent guide can't quietly go stale after a rename. Only paths with a "/" or a file
# extension are checked; commands and code like `npm test` are skipped.
set -euo pipefail
cd "$(dirname "$0")/../.."
status=0
while IFS= read -r path; do
  if ! compgen -G "${path%/}" >/dev/null; then
    echo "::error file=AGENTS.md,title=AGENTS.md is out of date::AGENTS.md mentions ${path}, which doesn't exist. Update the guide."
    status=1
  fi
done < <(grep -o '`[^` ]*`' AGENTS.md | tr -d '`' | grep -E '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.*/-]*$|^[A-Za-z0-9_-]+\.(md|json|toml|yml|ts|rs|mjs|sh|css|html)$' | sort -u)
exit $status
