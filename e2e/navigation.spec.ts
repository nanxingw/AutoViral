import { test, expect } from "@playwright/test";

test.describe("top-level navigation", () => {
  test("loads / and reaches Explore + Analytics", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Autoviral")).toBeVisible();

    await page.getByRole("link", { name: /Explore · 灵感/ }).click();
    await expect(page).toHaveURL(/\/explore/);
    await expect(page.getByText(/PULSE OF THE ALGORITHM/i)).toBeVisible();

    await page.getByRole("link", { name: /Analytics · 数据/ }).click();
    await expect(page).toHaveURL(/\/analytics/);
  });
});
