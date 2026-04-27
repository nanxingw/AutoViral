#!/usr/bin/env bash
# D3 sweep — fail if forbidden words appear in production code, skill docs,
# or active product documentation.
#
# Scope (Plan 5 widened): src/ + skills/ + migrations/ + README.md + CLAUDE.md +
# docs/skill-structure-guide.md.
#
# Out-of-scope (allowed forbidden words):
#   - docs/how-it-works.md, docs/desigen/, docs/experience/ — ARCHIVED legacy
#     architecture notes; banner at top of each marks them as historical.
#   - docs/research-*.md — external research notes referencing generic ML
#     "pipeline" terminology, not product description.
#   - docs/superpowers/ — spec / plan / notes (gitignored anyway).
#   - migration scripts whose explicit purpose is to remove the field.
#   - test files referencing legacy names in 410 assertions / forbidden lists.
#   - this script itself.
#
# D3-OK marker on a line allow-lists it (e.g. 410 stubs spelling out a legacy
# route path, STRIP_KEYS arrays, comments saying "D3: no pipeline"). Markers on
# nearby lines do NOT cascade — annotate every line explicitly.
set -e
PATTERN='step_divider|eval_divider|pipeline/advance|currentStep|阶段|流水线|下一步'
INCLUDES=(
  "src/"
  "skills/"
  "migrations/"
  "README.md"
  "CLAUDE.md"
  "docs/skill-structure-guide.md"
)
EXCLUDES=(
  ":(exclude)scripts/check-d3-words.sh"
  ":(exclude)migrations/strip-pipeline.ts"
  ":(exclude)migrations/strip-pipeline.test.ts"
  ":(exclude)src/**/*.test.ts"
  ":(exclude)src/**/*.test.tsx"
  ":(exclude)src/*.test.ts"
)
HITS=$(git grep -nE "$PATTERN" -- "${INCLUDES[@]}" "${EXCLUDES[@]}" | grep -v "D3-OK" || true)
if [ -n "$HITS" ]; then
  echo "D3 forbidden words found:"
  echo "$HITS"
  exit 1
fi

# Also scan commit subjects on this branch since plan1-scaffold-complete.
# Allow subjects that describe REMOVAL of the legacy concept — those have to
# spell out the term being removed (e.g. "drop step_divider events").
if git rev-parse plan1-scaffold-complete >/dev/null 2>&1; then
  COMMIT_HITS=$(git log --format='%h %s' plan1-scaffold-complete..HEAD \
    | grep -E "$PATTERN" \
    | grep -v "D3-OK" \
    | grep -viE "drop|remove|delete|rip out|legacy|migrate from|抹除|去掉|废弃" \
    || true)
  if [ -n "$COMMIT_HITS" ]; then
    echo "D3 forbidden words in commit messages:"
    echo "$COMMIT_HITS"
    exit 1
  fi
fi

echo "D3 sweep clean."
