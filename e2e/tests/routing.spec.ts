import { test, expect } from "@playwright/test";
import { createUser, signIn } from "./helpers";

test.describe("Routing and session", () => {
  test("R-01 unknown route shows the 404 page", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText("Oops! Page not found")).toBeVisible();
    await page.getByRole("link", { name: "Return to Home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("R-02 unknown role in the URL falls back to the student sign-in", async ({ page }) => {
    await page.goto("/login/headmaster");
    await expect(page.getByRole("heading", { name: "Student sign in" })).toBeVisible();
  });

  test("R-03 a missing shared resource shows a not-found message", async ({ page }) => {
    const s = await createUser("student");
    await signIn(page, s, "/r/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("This resource doesn't exist or hasn't been shared with you.")).toBeVisible();
  });

  test("R-04 sign-in page fits a phone screen", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.goto("/login/student");
    await expect(page.getByRole("button", { name: "Sign in as a student" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "no horizontal scrolling").toBeLessThanOrEqual(0);
    await page.close();
  });

  test("R-05 an expired access token is refreshed instead of signing the user out", async ({ page }) => {
    const s = await createUser("student");
    // Simulate an expired access token: invalid access token, valid refresh token.
    await page.goto("/");
    await page.evaluate(([r]) => {
      localStorage.setItem("auth_access", "expired.access.token");
      localStorage.setItem("auth_refresh", r);
    }, [s.refresh]);
    await page.goto("/input");
    await page.waitForLoadState("networkidle");
    expect(page.url(), "user should stay signed in after a silent token refresh").toMatch(/\/input$/);
  });

  test("R-06 signing out clears the remembered video and slide jobs", async ({ page }) => {
    const s = await createUser("student");
    await signIn(page, s);
    await page.evaluate(() => {
      localStorage.setItem("explainer_active_job", "job-of-previous-user");
      localStorage.setItem("presentation_active_job", "job-of-previous-user");
    });
    await page.getByRole("button", { name: /Sign out/ }).click();
    const left = await page.evaluate(() => [localStorage.getItem("explainer_active_job"), localStorage.getItem("presentation_active_job")]);
    expect(left, "the next person on this browser must not resume these jobs").toEqual([null, null]);
  });

  test("R-07 every home page button does something", async ({ page }) => {
    await page.goto("/");
    const dead: string[] = [];
    for (const name of ["See How It Works", "Start Your Journey", "Learn More"]) {
      await page.goto("/");
      const btn = page.getByRole("button", { name }).first();
      await expect(btn, `button "${name}"`).toBeVisible();
      const before = { url: page.url(), y: await page.evaluate(() => window.scrollY) };
      await btn.scrollIntoViewIfNeeded();
      const startY = await page.evaluate(() => window.scrollY);
      await btn.click();
      await page.waitForTimeout(1200);
      const after = { url: page.url(), y: await page.evaluate(() => window.scrollY) };
      if (after.url === before.url && Math.abs(after.y - startY) < 50) dead.push(name);
    }
    expect(dead, "buttons that do nothing when clicked").toEqual([]);
  });
});
