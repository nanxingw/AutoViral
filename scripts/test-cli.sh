#!/bin/bash
# Run evolution cycle with real-time output
export CLAUDECODE=""
cd "/Users/nanjiayan/Desktop/Skill evolver/skill-evolver"

echo "🔄 Starting evolution cycle (real-time output)..."
echo "================================================"
echo ""
node dist/index.js evolve
EXIT_CODE=$?
echo ""
echo "================================================"
echo "Exit code: $EXIT_CODE"
echo ""

echo "=== Check Results ==="
echo ""
echo "--- Reports ---"
for f in ~/.skill-evolver/reports/*.md; do
  if [ -f "$f" ]; then
    echo "📄 $(basename $f)"
    cat "$f"
    echo ""
  fi
done

echo "--- preference_tmp ---"
cat ~/.claude/skills/user-context/tmp/preference_tmp.yaml
echo ""
echo "--- objective_tmp ---"
cat ~/.claude/skills/user-context/tmp/objective_tmp.yaml
echo ""
echo "--- cognition_tmp ---"
cat ~/.claude/skills/user-context/tmp/cognition_tmp.yaml
echo ""
echo "--- success_experience ---"
cat ~/.claude/skills/skill-evolver/tmp/success_experience.yaml
echo ""
echo "--- failure_experience ---"
cat ~/.claude/skills/skill-evolver/tmp/failure_experience.yaml
echo ""
echo "--- useful_tips ---"
cat ~/.claude/skills/skill-evolver/tmp/useful_tips.yaml
echo ""
echo "=== DONE ==="
