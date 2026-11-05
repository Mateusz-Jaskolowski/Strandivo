#!/usr/bin/env bash
# Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Checks that every source file starts with the copyright and licence lines
# (CONTRIBUTING.md, "Licence headers").
set -euo pipefail
cd "$(dirname "$0")/../.."
missing=$(git ls-files '*.ts' '*.mjs' '*.js' '*.css' '*.rs' '*.sh' | while read -r f; do
  head -n 4 "$f" | grep -q 'SPDX-License-Identifier: GPL-3.0-or-later' || echo "  $f"
done)
if [ -n "$missing" ]; then
  echo "These files have no licence header (copy it from any other file):"
  echo "$missing"
  exit 1
fi
