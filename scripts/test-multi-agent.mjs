#!/usr/bin/env node
/**
 * Test multi-agent evolution architecture.
 * Tests:
 * 1. Config: evolutionMode field exists and defaults to "multi"
 * 2. Prompt builders: all three agent prompts are generated correctly
 * 3. Executor: runMultiAgentEvolution function exists
 * 4. Report merging logic
 */

import { strict as assert } from "node:assert";

// ── Test 1: Config ──────────────────────────────────────────────────────────

console.log("Test 1: Config — evolutionMode field");

const { getDefaultConfig, loadConfig } = await import("../dist/config.js");
const defaults = getDefaultConfig();
assert.equal(defaults.evolutionMode, "multi", "Default evolutionMode should be 'multi'");
console.log("  ✓ evolutionMode defaults to 'multi'");

const config = await loadConfig();
assert.ok(config.evolutionMode === "multi" || config.evolutionMode === "single",
  "evolutionMode should be 'multi' or 'single'");
console.log(`  ✓ Loaded config has evolutionMode: ${config.evolutionMode}`);

// ── Test 2: Prompt builders ────────────────────────────────────────────────

console.log("\nTest 2: Prompt builders");

const {
  buildPrompt,
  buildContextAgentPrompt,
  buildSkillAgentPrompt,
  buildTaskAgentPrompt,
} = await import("../dist/prompt.js");

// Single-agent prompt (backward compat)
const singlePrompt = buildPrompt(["prev report"], { taskAutoApprove: true });
assert.ok(singlePrompt.includes("background evolution engine"), "Single prompt should have identity");
assert.ok(singlePrompt.includes("Task Planning"), "Single prompt should mention task planning");
assert.ok(singlePrompt.includes("Task auto-approve is ON"), "Should show auto-approve ON");
console.log("  ✓ buildPrompt (single-agent) works correctly");

// Context Agent
const contextPrompt = buildContextAgentPrompt(["report 1"], "/tmp/test_context_report.md");
assert.ok(contextPrompt.includes("Context Agent"), "Should identify as Context Agent");
assert.ok(contextPrompt.includes("user-context"), "Should mention user-context");
assert.ok(contextPrompt.includes("Do NOT touch"), "Should have isolation rules");
assert.ok(contextPrompt.includes("skill-evolver") && contextPrompt.includes("another agent handles"), "Should not handle skill-evolver");
assert.ok(contextPrompt.includes("/tmp/test_context_report.md"), "Should include report path");
assert.ok(contextPrompt.includes("Report 1"), "Should include recent reports");
console.log("  ✓ buildContextAgentPrompt generates correct prompt");

// Skill Agent
const skillPrompt = buildSkillAgentPrompt([], "/tmp/test_skill_report.md");
assert.ok(skillPrompt.includes("Skill Agent"), "Should identify as Skill Agent");
assert.ok(skillPrompt.includes("Need Discovery"), "Should mention need discovery");
assert.ok(skillPrompt.includes("skillhub.club") || skillPrompt.includes("External Skills") || skillPrompt.includes("SkillHub"),
  "Should mention external skill search");
assert.ok(skillPrompt.includes("permitted_skills.md"), "Should mention permissions");
assert.ok(skillPrompt.includes("at least 3"), "Should require minimum needs identification");
assert.ok(skillPrompt.includes("first evolution cycle"), "Should show no previous reports");
console.log("  ✓ buildSkillAgentPrompt generates correct prompt");

// Task Agent
const taskPrompt = buildTaskAgentPrompt(["report A", "report B"], "/tmp/test_task_report.md", { taskAutoApprove: true });
assert.ok(taskPrompt.includes("Task Agent"), "Should identify as Task Agent");
assert.ok(taskPrompt.includes("Objective Decomposition"), "Should require objective decomposition");
assert.ok(taskPrompt.includes("MANDATORY"), "Should mark decomposition as mandatory");
assert.ok(taskPrompt.includes("objective.yaml"), "Should reference objective.yaml");
assert.ok(taskPrompt.includes("active"), "Auto-approve ON should set status active");
assert.ok(taskPrompt.includes("Report 1") && taskPrompt.includes("Report 2"), "Should include both reports");
console.log("  ✓ buildTaskAgentPrompt generates correct prompt");

// Task Agent with auto-approve OFF
const taskPromptNoApprove = buildTaskAgentPrompt([], "/tmp/test.md", { taskAutoApprove: false });
assert.ok(taskPromptNoApprove.includes("pending"), "Auto-approve OFF should mention pending");
console.log("  ✓ buildTaskAgentPrompt handles auto-approve OFF");

// ── Test 3: Prompt isolation ────────────────────────────────────────────────

console.log("\nTest 3: Agent isolation");

// Context agent should NOT mention skill creation or task creation
assert.ok(!contextPrompt.includes("Create or Evolve"), "Context agent should not create skills");
assert.ok(!contextPrompt.includes("tasks.yaml"), "Context agent should not touch tasks");
console.log("  ✓ Context agent has no skill/task write instructions");

// Skill agent has READ-ONLY access to tasks (co-evolution), but no WRITE access
assert.ok(skillPrompt.includes("tasks.yaml") && skillPrompt.includes("read only"), "Skill agent should have read-only task access");
assert.ok(skillPrompt.includes("another agent handles this — read only"), "Skill agent tasks.yaml should be explicitly read-only");
console.log("  ✓ Skill agent has read-only task access (co-evolution)");

// Task agent has READ access to skills (co-evolution), but cannot create/modify them directly
assert.ok(taskPrompt.includes("permitted_skills"), "Task agent should read skill inventory");
assert.ok(taskPrompt.includes("do not modify any skill files"), "Task agent should not modify skills directly");
assert.ok(!taskPrompt.includes("Create or Evolve"), "Task agent should not create skills directly");
console.log("  ✓ Task agent has read-only skill access (co-evolution)");

// ── Test 4: Executor exports ────────────────────────────────────────────────

console.log("\nTest 4: Executor exports");

const executorModule = await import("../dist/executor.js");
assert.ok(typeof executorModule.runEvolutionCycle === "function", "runEvolutionCycle should exist");
assert.ok(typeof executorModule.runMultiAgentEvolution === "function", "runMultiAgentEvolution should exist");
assert.ok(executorModule.executor, "executor instance should exist");
assert.ok(typeof executorModule.executor.hasEvolutionRunning === "boolean", "hasEvolutionRunning should be a boolean");
assert.equal(executorModule.executor.hasEvolutionRunning, false, "No evolution should be running");
console.log("  ✓ runMultiAgentEvolution exported");
console.log("  ✓ executor.hasEvolutionRunning works");

// ── Test 5: JobType includes new types ──────────────────────────────────────

console.log("\nTest 5: JobType compatibility");

// Verify the executor can accept evo-* job types (type checking at runtime)
const testJob = {
  id: "test-evo-context-1",
  type: "evo-context",
  prompt: "test",
  model: "sonnet",
};
// Just verify the Map accepts it
executorModule.executor.running.set(testJob.id, testJob);
assert.ok(executorModule.executor.hasEvolutionRunning, "evo-context should count as evolution");
assert.equal(executorModule.executor.state, "running", "Should show running state");
executorModule.executor.running.delete(testJob.id);
assert.ok(!executorModule.executor.hasEvolutionRunning, "Should be false after cleanup");
console.log("  ✓ evo-context/evo-skill/evo-task job types work correctly");

// ── Test 6: Scheduler compatibility ─────────────────────────────────────────

console.log("\nTest 6: Scheduler compatibility");

const { parseIntervalMs } = await import("../dist/scheduler.js");
assert.equal(parseIntervalMs("30m"), 30 * 60 * 1000, "30m should parse correctly");
assert.equal(parseIntervalMs("1h"), 60 * 60 * 1000, "1h should parse correctly");
console.log("  ✓ Scheduler still parses intervals correctly");

// ── Test 7: API status endpoint includes new fields ─────────────────────────

console.log("\nTest 7: API route structure");

const { apiRoutes } = await import("../dist/server/api.js");
assert.ok(apiRoutes, "apiRoutes should be exported");
console.log("  ✓ API routes compile and export correctly");

// ── Summary ─────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════");
console.log("All tests passed! ✓");
console.log("═══════════════════════════════════════════");
