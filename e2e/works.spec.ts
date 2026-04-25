import { test, expect } from "@playwright/test";

test.describe("Works page", () => {
  // NEGATIVE assertion: Plan §6 D3 forbids "auto-research" / "every 1h" / "researched X pieces" / "pipeline" / "stage" / "阶段" in product copy.
  test("does NOT mention auto-research / cron forbidden words", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/auto.?research/i);
    expect(body).not.toMatch(/every 1h/i);
    expect(body).not.toMatch(/researched \d+ pieces/i);
    expect(body).not.toMatch(/pipeline/i);
    expect(body).not.toMatch(/阶段/);
  });

  test("hero says PICK UP WHERE YOU LEFT OFF", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/PICK UP WHERE YOU LEFT OFF/i)).toBeVisible();
  });
});
