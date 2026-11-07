#!/usr/bin/env bash
# Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Fails if an agent guide (AGENTS.md, the guides in docs/agents/ and any AGENTS.md in a
# folder) names a file or folder (in `backticks`) that doesn't exist, so the guides can't
# quietly go stale after a rename. Paths are from the repository's root. Only paths with a
# "/" or a file extension are checked; commands and code like `npm test` are skipped.
# Guides are found among tracked files, so `git add` a new one before running this.
set -euo pipefail
cd "$(dirname "$0")/../.."
status=0
while IFS= read -r guide; do
  while IFS= read -r path; do
    if ! compgen -G "${path%/}" >/dev/null; then
      echo "::error file=${guide},title=${guide} is out of date::${guide} mentions ${path}, which doesn't exist. Update the guide."
      status=1
    fi
  done < <(grep -o '`[^` ]*`' "$guide" | tr -d '`' | grep -E '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.*/-]*$|^[A-Za-z0-9_-]+\.(md|json|toml|yml|ts|rs|mjs|sh|css|html)$' | sort -u)
done < <(git ls-files 'AGENTS.md' '*/AGENTS.md' 'docs/agents/*.md')
exit $status
