#!/usr/bin/env bash
# D3 sweep — fail if forbidden words appear in production code or skill docs.
# Allow them ONLY in: spec/plan files (docs/superpowers/), notes/, archived comments tagged NEGATIVE, this script itself,
# and migration scripts whose explicit purpose is to remove the field.
set -e
PATTERN='step_divider|eval_divider|pipeline/advance|currentStep|阶段|流水线'
EXCLUDES=(
  ":(exclude)docs/superpowers"
  ":(exclude)scripts/check-d3-words.sh"
  ":(exclude)migrations/strip-pipeline.ts"
  ":(exclude)*.test.ts"   # tests may reference legacy names in 410 assertions
)
HITS=$(git grep -nE "$PATTERN" -- "${EXCLUDES[@]}" || true)
if [ -n "$HITS" ]; then
  echo "D3 forbidden words found:"
  echo "$HITS"
  exit 1
fi
echo "D3 sweep clean."
