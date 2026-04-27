import { test, expect } from "@playwright/test";

test.describe("Editor page", () => {
  test("opens with one slide and shows the four-panel shell", async ({
    page,
  }) => {
    await page.goto("/editor/test-work-id");
    // The editor shell mounts with the work id wired through.
    await expect(page.locator("[data-work-id='test-work-id']")).toBeVisible();
    // SlidesNav add button is present.
    await expect(page.getByText(/Add slide/i)).toBeVisible();
    // Filmstrip microcopy.
    await expect(page.getByText(/Drag to reorder/i)).toBeVisible();
    // Inspector tabs are present.
    await expect(page.getByRole("tab", { name: /Design/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Copy/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^AI$/i })).toBeVisible();
  });

  test("does NOT contain forbidden D3 vocabulary", async ({ page }) => {
    await page.goto("/editor/test-work-id");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/pipeline/i);
    expect(body).not.toMatch(/\bstage\b/i);
    expect(body).not.toMatch(/\bphase\b/i);
    expect(body).not.toMatch(/阶段/);
    expect(body).not.toMatch(/流水线/);
    expect(body).not.toMatch(/下一步/);
  });
});
