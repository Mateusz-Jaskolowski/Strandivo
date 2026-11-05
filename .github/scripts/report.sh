#!/usr/bin/env bash
# Runs a shell command and posts its full output as notice annotations (up to 10 chunks),
# so it can be read through the GitHub API. Used by the "Diagnostics" workflow.
set -uo pipefail
log="$(mktemp)"
bash -c "$1" >"$log" 2>&1
status=$?
total=$(wc -c <"$log")
chunk=6000
i=0
while [ $((i * chunk)) -lt "$total" ] && [ "$i" -lt 10 ]; do
  part="$(tail -c +$((i * chunk + 1)) "$log" | head -c "$chunk" | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g')"
  part="${part//'%'/'%25'}"
  part="${part//$'\r'/}"
  part="${part//$'\n'/'%0A'}"
  echo "::notice title=Output part $((i + 1)) (exit ${status})::${part}"
  i=$((i + 1))
done
[ "$total" -eq 0 ] && echo "::notice title=Output (exit ${status})::(no output)"
exit 0
