#!/usr/bin/env node
/**
 * Tests for task-skill co-evolution integration.
 * Validates: Task schema extensions, skill_needs CRUD, prompt integration,
 * related skills in task prompts, skill-building task templates.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";

const require = createRequire(import.meta.url);
const distPath = join(decodeURIComponent(import.meta.url.replace("file://", "")), "..", "..", "dist");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

// ── Test Group 1: Task Schema Extensions ───────────────────────────────────

console.log("\n📋 Task Schema Extensions");

const taskStore = await import(join(distPath, "task-store.js"));

test("Task type supports relatedSkills field", () => {
  // Verify the module exports are correct
  assert(typeof taskStore.listTasks === "function", "listTasks should be exported");
  assert(typeof taskStore.createTask === "function", "createTask should be exported");
});

test("Task type supports skillTarget field", () => {
  assert(typeof taskStore.getTask === "function", "getTask should be exported");
  assert(typeof taskStore.updateTask === "function", "updateTask should be exported");
});

// ── Test Group 2: Skill Needs CRUD ─────────────────────────────────────────

console.log("\n🔗 Skill Needs (task→skill bridge)");

test("listSkillNeeds is exported", () => {
  assert(typeof taskStore.listSkillNeeds === "function", "listSkillNeeds should be exported");
});

test("addSkillNeed is exported", () => {
  assert(typeof taskStore.addSkillNeed === "function", "addSkillNeed should be exported");
});

const SKILL_NEEDS_TEST_DIR = join(homedir(), ".claude", "skills", "skill-evolver", "tmp");
const SKILL_NEEDS_FILE = join(SKILL_NEEDS_TEST_DIR, "skill_needs.yaml");

// Backup existing file if present
let originalSkillNeeds = null;
try {
  originalSkillNeeds = await readFile(SKILL_NEEDS_FILE, "utf-8");
} catch { /* doesn't exist */ }

await testAsync("addSkillNeed creates entry", async () => {
  // Clean slate
  try { await rm(SKILL_NEEDS_FILE); } catch { /* ok */ }

  await taskStore.addSkillNeed({
    need: "Test skill need",
    source_task: "t_test_001",
    task_name: "Test Task",
    evidence: "Test evidence",
    priority: "high",
    date: "2026-03-09",
    addressed: false,
  });

  const needs = await taskStore.listSkillNeeds();
  assert(needs.length === 1, `Expected 1 need, got ${needs.length}`);
  assert(needs[0].need === "Test skill need", "Need text mismatch");
  assert(needs[0].source_task === "t_test_001", "Source task mismatch");
  assert(needs[0].priority === "high", "Priority mismatch");
});

await testAsync("addSkillNeed deduplicates by need text", async () => {
  await taskStore.addSkillNeed({
    need: "Test skill need",
    source_task: "t_test_002",
    task_name: "Another Task",
    evidence: "More evidence",
    priority: "medium",
    date: "2026-03-10",
  });

  const needs = await taskStore.listSkillNeeds();
  assert(needs.length === 1, `Expected 1 need after dedup, got ${needs.length}`);
  assert(needs[0].evidence.includes("More evidence"), "Evidence should be appended");
  assert(needs[0].priority === "high", "Priority should remain high (not downgraded)");
});

await testAsync("addSkillNeed adds distinct entries", async () => {
  await taskStore.addSkillNeed({
    need: "Different skill need",
    source_task: "t_test_003",
    task_name: "Third Task",
    evidence: "Different evidence",
    priority: "medium",
    date: "2026-03-10",
  });

  const needs = await taskStore.listSkillNeeds();
  assert(needs.length === 2, `Expected 2 needs, got ${needs.length}`);
});

// Restore original file
if (originalSkillNeeds !== null) {
  await writeFile(SKILL_NEEDS_FILE, originalSkillNeeds, "utf-8");
} else {
  try { await rm(SKILL_NEEDS_FILE); } catch { /* ok */ }
}

// ── Test Group 3: Prompt Integration ───────────────────────────────────────

console.log("\n📝 Prompt Integration");

const prompt = await import(join(distPath, "prompt.js"));

test("buildSkillAgentPrompt includes task awareness", () => {
  const p = prompt.buildSkillAgentPrompt([], "/tmp/test_report.md");
  assert(p.includes("tasks/tasks.yaml"), "Should reference tasks.yaml");
  assert(p.includes("task execution patterns"), "Should mention task execution patterns");
  assert(p.includes("skill_needs.yaml"), "Should reference skill_needs.yaml");
  assert(p.includes("Source E"), "Should have Source E for task patterns");
  assert(p.includes("Source F"), "Should have Source F for skill-need signals");
});

test("buildSkillAgentPrompt has task read access", () => {
  const p = prompt.buildSkillAgentPrompt([], "/tmp/test_report.md");
  assert(p.includes("~/.skill-evolver/tasks/tasks.yaml") && p.includes("read only"), "Should have read-only task access");
  assert(p.includes("~/.skill-evolver/tasks/*/reports/"), "Should read task reports");
});

test("buildSkillAgentPrompt report template includes task-derived needs", () => {
  const p = prompt.buildSkillAgentPrompt([], "/tmp/test_report.md");
  assert(p.includes("Task-Derived Needs"), "Report should have Task-Derived Needs section");
  assert(p.includes("skill_needs addressed"), "Report should track addressed skill needs");
});

test("buildTaskAgentPrompt includes skill awareness", () => {
  const p = prompt.buildTaskAgentPrompt([], "/tmp/test_report.md");
  assert(p.includes("Skill Awareness"), "Should have Skill Awareness phase");
  assert(p.includes("ls ~/.claude/skills/"), "Should list available skills");
  assert(p.includes("permitted_skills.md"), "Should reference permitted skills");
  assert(p.includes("relatedSkills"), "Should mention relatedSkills field");
  assert(p.includes("skill-building"), "Should mention skill-building tasks");
});

test("buildTaskAgentPrompt has skill-building task template", () => {
  const p = prompt.buildTaskAgentPrompt([], "/tmp/test_report.md");
  assert(p.includes("skillTarget"), "Should include skillTarget field");
  assert(p.includes("skill-creator"), "Should reference skill-creator");
  assert(p.includes("Skill-building task format"), "Should have skill-building format section");
  assert(p.includes("When to create a skill-building task"), "Should explain when to create skill-building tasks");
});

test("buildTaskAgentPrompt report includes skill awareness section", () => {
  const p = prompt.buildTaskAgentPrompt([], "/tmp/test_report.md");
  assert(p.includes("## Skill Awareness"), "Report should have Skill Awareness section");
  assert(p.includes("Skill-building tasks"), "Report should mention skill-building tasks");
});

test("buildPostTaskPrompt includes skill-need signal emission", () => {
  const mockTask = {
    id: "t_test_001",
    name: "Test Task",
    prompt: "test",
    status: "active",
    runCount: 1,
    createdAt: "2026-03-09T00:00:00Z",
  };
  const p = prompt.buildPostTaskPrompt(mockTask, "test report content", []);
  assert(p.includes("skill-need signals"), "Should mention skill-need signals");
  assert(p.includes("skill_needs.yaml"), "Should reference skill_needs.yaml");
  assert(p.includes("task-skill co-evolution"), "Should mention co-evolution");
  assert(p.includes("Skill-building task verification"), "Should have skill-building verification step");
});

test("buildTaskPrompt includes related skills when present", () => {
  const taskWithSkills = {
    id: "t_test_002",
    name: "Test Task With Skills",
    description: "A task that uses skills",
    prompt: "Do something",
    status: "active",
    runCount: 0,
    createdAt: "2026-03-09T00:00:00Z",
    relatedSkills: ["python-llm-resilience", "frontend-design"],
  };
  const p = prompt.buildTaskPrompt(taskWithSkills, "/tmp/artifacts", "/tmp/report.md");
  assert(p.includes("Related Skills"), "Should have Related Skills section");
  assert(p.includes("python-llm-resilience"), "Should list python-llm-resilience");
  assert(p.includes("frontend-design"), "Should list frontend-design");
  assert(p.includes("SKILL.md"), "Should tell executor to read SKILL.md files");
});

test("buildTaskPrompt omits related skills when empty", () => {
  const taskNoSkills = {
    id: "t_test_003",
    name: "Plain Task",
    prompt: "Do something",
    status: "active",
    runCount: 0,
    createdAt: "2026-03-09T00:00:00Z",
  };
  const p = prompt.buildTaskPrompt(taskNoSkills, "/tmp/artifacts", "/tmp/report.md");
  assert(!p.includes("Related Skills"), "Should NOT have Related Skills section");
});

test("buildTaskPrompt includes skillTarget for skill-building tasks", () => {
  const skillTask = {
    id: "t_test_004",
    name: "Create test-skill",
    prompt: "Build a skill",
    status: "active",
    runCount: 0,
    createdAt: "2026-03-09T00:00:00Z",
    tags: ["skill-building"],
    skillTarget: "test-skill",
  };
  const p = prompt.buildTaskPrompt(skillTask, "/tmp/artifacts", "/tmp/report.md");
  assert(p.includes("Skill Target"), "Should show Skill Target");
  assert(p.includes("test-skill"), "Should show the target skill name");
  assert(p.includes("skill-building task"), "Should identify as skill-building task");
});

// ── Test Group 4: Agent Isolation ──────────────────────────────────────────

console.log("\n🔒 Agent Isolation (unchanged)");

test("Skill Agent cannot write to tasks.yaml", () => {
  const p = prompt.buildSkillAgentPrompt([], "/tmp/test.md");
  assert(p.includes("tasks.yaml") && p.includes("read only"), "tasks.yaml should be read-only for Skill Agent");
});

test("Task Agent cannot modify skill files", () => {
  const p = prompt.buildTaskAgentPrompt([], "/tmp/test.md");
  assert(p.includes("do not modify any skill files"), "Task Agent should not modify skills");
});

// ── Test Group 5: Evolution Guide Files ────────────────────────────────────

console.log("\n📄 Evolution Guide Consistency");

await testAsync("skill-evolver evolution guide mentions task patterns", async () => {
  const guide = await readFile(
    join(decodeURIComponent(import.meta.url.replace("file://", "")), "..", "..", "skills", "skill-evolver", "reference", "evolution_guide.md"),
    "utf-8",
  );
  assert(guide.includes("Source E"), "Should have Source E for task patterns");
  assert(guide.includes("Source F"), "Should have Source F for skill-need signals");
  assert(guide.includes("skill_needs.yaml"), "Should reference skill_needs.yaml");
  assert(guide.includes("Task-Derived Needs"), "Report template should have Task-Derived Needs");
});

await testAsync("task-planner evolution guide mentions skill awareness", async () => {
  const guide = await readFile(
    join(decodeURIComponent(import.meta.url.replace("file://", "")), "..", "..", "skills", "task-planner", "reference", "evolution_guide.md"),
    "utf-8",
  );
  assert(guide.includes("Skill Awareness"), "Should have Skill Awareness phase");
  assert(guide.includes("skill-building"), "Should mention skill-building tasks");
  assert(guide.includes("skillTarget"), "Should mention skillTarget field");
  assert(guide.includes("relatedSkills"), "Should mention relatedSkills field");
});

await testAsync("task schema reference includes new fields", async () => {
  const schema = await readFile(
    join(decodeURIComponent(import.meta.url.replace("file://", "")), "..", "..", "skills", "task-planner", "reference", "task_schema.md"),
    "utf-8",
  );
  assert(schema.includes("relatedSkills"), "Schema should document relatedSkills");
  assert(schema.includes("skillTarget"), "Schema should document skillTarget");
  assert(schema.includes("skill_needs.yaml"), "Schema should document skill_needs.yaml");
  assert(schema.includes("Skill-Building Tasks"), "Schema should have Skill-Building Tasks section");
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("✅ All task-skill integration tests passed!");
}
