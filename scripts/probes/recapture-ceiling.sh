#!/bin/zsh
# recapture-ceiling.sh — PRD-0015 S5（修正包）
#
# 重采 claude print-mode 后台任务生命周期 system 帧，作为
# src/server/chat-backends/__fixtures__/claude-tasks/*.jsonl 的**上游漂移探测**手段。
#
# 为什么要有这个脚本：parser-contract.regression.test.ts 只锁"已采集 fixture 的帧形状"，
# 它 **无法** 自动发现上游漂移——CI 没有 claude 登录凭据，跑不了真 `claude -p`。所以
# "上游把 killed→terminated / task_updated→task_ended / task_type 改口"这类漂移，只能靠
# 人在本机跑本脚本重采、diff 新旧 fixture 来发现。
#
# 何时重采（唯一触发条件）：**升级 claude CLI 之后**（`claude --version` 变了）。
# 采完把 tmp 输出与 __fixtures__/claude-tasks/ 里的对应文件 diff：
#   - 帧形状 / 终态词汇没变 → 无需动 fixture，契约稳。
#   - 变了 → 按新形状脱敏更新 fixture + parser + parser-contract.regression.test.ts，
#            再让回归红转绿（这就是"在产线复发被杀无提示前修 parser"的时点）。
#
# 采集与 fixture 一一对应（exp4-9 的原始采集命令固化于此，与 __fixtures__ README 的
# 真值表一致）：
#   exp2  local_bash    + ceiling 5000   → 强杀（killed/stopped）
#   exp6  local_bash    + 无 env         → 默认收割（~5s，env 无效）
#   exp4  local_bash    + ceiling 0      → 默认收割（~5s，env 对 bash 型无效）
#   exp7  local_workflow+ 无 env         → result 被 hold 到任务落定 + re-invoke（~90s）
#   exp8  local_workflow+ ceiling 15000  → 15s 上限强杀（killed/stopped）
#   exp9  local_workflow+ ceiling 0      → 真·无限等待，workflow 自然完成（completed）
#
# 用法：
#   scripts/probes/recapture-ceiling.sh            # 采全部到 /tmp/av-ceiling-recapture/
#   OUT=/some/dir scripts/probes/recapture-ceiling.sh
#
# 采完的原始流带机器/会话标识（session_id/uuid/绝对 output_file）——**入库前必须脱敏**
# （见 __fixtures__/claude-tasks/README.md「脱敏」一节：去 session_id/uuid、output_file→
# <SCRATCH> 占位、剥离行首 [Ns] 时间戳前缀）。本脚本只负责采集，不自动入库。

set -u
export PATH="/opt/homebrew/bin:$PATH"

OUT="${OUT:-/tmp/av-ceiling-recapture}"
mkdir -p "$OUT"

echo "claude 版本：$(claude --version 2>/dev/null || echo '<找不到 claude>')"
echo "输出目录：$OUT"
echo

# 逐行打相对秒时间戳（观测 result-hold / 收割时机），落 <exp>.jsonl；stderr 分流。
run() {
  local name="$1" ceiling="$2" prompt="$3"
  echo "===== $name (ceiling=${ceiling:-<unset>}) ====="
  local start=$(date +%s)
  if [[ -n "$ceiling" ]]; then
    CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS="$ceiling" claude -p "$prompt" \
      --output-format stream-json --verbose --dangerously-skip-permissions \
      2> "$OUT/$name-stderr.log" | \
      while IFS= read -r line; do echo "[$(( $(date +%s) - start ))s] $line"; done > "$OUT/$name.jsonl"
  else
    claude -p "$prompt" \
      --output-format stream-json --verbose --dangerously-skip-permissions \
      2> "$OUT/$name-stderr.log" | \
      while IFS= read -r line; do echo "[$(( $(date +%s) - start ))s] $line"; done > "$OUT/$name.jsonl"
  fi
  echo "  → $OUT/$name.jsonl  (总耗时 $(( $(date +%s) - start ))s)"
}

BASH_PROMPT='用 Bash 工具以 run_in_background:true 运行命令 `sleep 30 && echo neverseen`，然后立刻回复"started"结束本轮。不要等待任务。'
BASH_PROMPT_SHORT='用 Bash 工具以 run_in_background:true 运行命令 `sleep 20 && echo bgdone`，然后立刻回复"started"结束本轮。不要等待任务。'

# Workflow 内层跑一个前台等待 30s 的 subagent bash，暴露"result 被 hold / 嵌套 bash 上卷"。
WF_PROMPT='调用 Workflow 工具，script 参数用这段（原样，不要改动）：
export const meta={name:"slow-probe",description:"slow agent probe",phases:[]}
const r = await agent("用 Bash 工具运行 `sleep 30 && echo inner-done`（前台运行，等它完成），然后把文本 done-waiting 作为你的最终回复返回。")
return r
然后立刻回复"launched"结束本轮，不要等待 workflow。'

# local_bash 型（env 对 bash 型无效 —— 三组对照都应 ~5s 收割）。
run "exp2-ceiling"   "5000" "$BASH_PROMPT"
run "exp4-ceiling0"  "0"    "$BASH_PROMPT_SHORT"
run "exp6-default"   ""     "$BASH_PROMPT_SHORT"

# local_workflow 型（result 被 hold；ceiling 对 workflow 型有效）。
run "exp7-workflow-slow"       ""      "$WF_PROMPT"
run "exp8-workflow-ceiling15k" "15000" "$WF_PROMPT"
run "exp9-workflow-ceiling0"   "0"     "$WF_PROMPT"

echo
echo "重采完成。下一步：与 src/server/chat-backends/__fixtures__/claude-tasks/ 对应文件 diff；"
echo "若帧形状/终态词汇变了，脱敏后更新 fixture + parser + parser-contract.regression.test.ts。"
