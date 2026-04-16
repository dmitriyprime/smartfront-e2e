import { test, expect } from "@playwright/test";

test("has title", async ({ page }) => {
  await page.goto("/");

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Welcome to SmartFront/);
});

test("shop collection link", async ({ page }) => {
  await page.goto("/");

  // Click the get started link.
  await page.getByRole("link", { name: "Shop Collection" }).click();

  // Expects page to have a heading with the name of Women.
  await expect(page.getByRole("heading", { name: "Women" })).toBeVisible();
})
