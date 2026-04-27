import { test, expect } from "@playwright/test";

test.describe("Studio page", () => {
  test("renders top bar / chat / preview / timeline / tweaks panes", async ({
    page,
  }) => {
    await page.goto("/studio/demo-work");
    // Studio shell mounts with the work id wired through to data attribute
    await expect(page.locator("[data-work-id='demo-work']")).toBeVisible();
    // TopBar export button
    await expect(page.getByRole("button", { name: /Export MP4/i })).toBeVisible();
    // Tweaks sections render
    await expect(page.getByText(/Theme/i).first()).toBeVisible();
    await expect(page.getByText(/Density/i).first()).toBeVisible();
    // CompositionSection only renders once a comp is loaded — give it a beat for the
    // load-or-fallback effect to populate the store.
    await expect(page.getByText(/Composition/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("does NOT contain forbidden D3 vocabulary", async ({ page }) => {
    await page.goto("/studio/demo-work");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/pipeline/i);
    expect(body).not.toMatch(/\bstage\b/i);
    expect(body).not.toMatch(/\bphase\b/i);
    expect(body).not.toMatch(/阶段/);
    expect(body).not.toMatch(/流水线/);
    expect(body).not.toMatch(/下一步/);
  });
});
