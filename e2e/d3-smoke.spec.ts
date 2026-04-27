import { test, expect, type Page } from "@playwright/test";

// 4 D3 smoke flows — verify the redesigned UI never exposes ordering/stage vocabulary.
// These run against the dev frontend only (no backend). Each route renders an offline
// fallback when /api calls fail; the assertions are about the static UI surface staying
// D3-clean regardless of backend state.

const FORBIDDEN_PATTERNS = [
  /\bpipeline\b/i,
  /\bstage progress\b/i,
  /\bphase\b/i,
  /阶段/,
  /流水线/,
  /下一步/,
  /先[要必]调研/,
  /应该先/,
  /every 1h/i,
  /auto.?research/i,
];

async function expectBodyDoesNotContainForbidden(page: Page) {
  const body = await page.locator("body").innerText();
  for (const re of FORBIDDEN_PATTERNS) {
    expect(body, `body should not contain ${re}`).not.toMatch(re);
  }
}

test.describe("D3 stage-removal smoke", () => {
  test("D3-1 image-text route renders without stage vocabulary", async ({ page }) => {
    await page.goto("/editor/demo-work");
    await expect(page.locator(".editor-shell")).toBeVisible();
    await expectBodyDoesNotContainForbidden(page);
  });

  test("D3-2 video studio route renders without stage vocabulary", async ({ page }) => {
    await page.goto("/studio/demo-work");
    await expect(page.locator("[data-work-id='demo-work']")).toBeVisible();
    await expectBodyDoesNotContainForbidden(page);
  });

  test("D3-3 explore route does not advertise auto-research / cron", async ({ page }) => {
    await page.goto("/explore");
    await expectBodyDoesNotContainForbidden(page);
  });

  test("D3-4 works hero leads with autonomy, no stage progress chip", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/PICK UP WHERE YOU LEFT OFF/i)).toBeVisible();
    await expectBodyDoesNotContainForbidden(page);
  });
});
