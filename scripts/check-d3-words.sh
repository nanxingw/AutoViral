#!/usr/bin/env bash
# D3 sweep — fail if forbidden words appear in production code or skill docs.
#
# Scope (Plan 4): src/ + skills/ + migrations/. Top-level docs (README.md,
# CLAUDE.md, docs/) are out of scope for Plan 4 — they describe legacy
# behaviour and are scheduled for cleanup in a later plan. The notes file
# `docs/superpowers/notes/2026-04-27-skill-references.md` records this.
#
# Allow forbidden words ONLY in:
#   - migration scripts whose explicit purpose is to remove the field
#   - test files that reference legacy names in 410 assertions / forbidden lists
#   - this script itself
set -e
PATTERN='step_divider|eval_divider|pipeline/advance|currentStep|阶段|流水线'
INCLUDES=(
  "src/"
  "skills/"
  "migrations/"
)
EXCLUDES=(
  ":(exclude)scripts/check-d3-words.sh"
  ":(exclude)migrations/strip-pipeline.ts"
  ":(exclude)migrations/strip-pipeline.test.ts"
  ":(exclude)src/**/*.test.ts"
  ":(exclude)src/**/*.test.tsx"
  ":(exclude)src/*.test.ts"
)
# D3-OK marker on a line allow-lists it (e.g. 410 stubs that have to spell out
# the legacy path). Markers on nearby lines do NOT cascade — annotate every line
# explicitly.
HITS=$(git grep -nE "$PATTERN" -- "${INCLUDES[@]}" "${EXCLUDES[@]}" | grep -v "D3-OK" || true)
if [ -n "$HITS" ]; then
  echo "D3 forbidden words found:"
  echo "$HITS"
  exit 1
fi
echo "D3 sweep clean."
