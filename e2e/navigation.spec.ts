import { test, expect } from "@playwright/test";

test.describe("Works-to-Studio navigation", () => {
  test("opens a video work in Studio and returns to Works", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);

    const studioWork = page.locator('main a[href^="/studio/"]').first();
    await expect(studioWork).toBeVisible();
    await studioWork.click();

    await expect(page).toHaveURL(/\/studio\/[^/]+$/);
    await expect(page.locator("[data-work-id]")).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);

    await page.getByRole("button", { name: /works|作品/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("banner")).toBeVisible();
  });
});
