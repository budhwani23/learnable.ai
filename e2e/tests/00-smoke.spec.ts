import { test, expect } from "@playwright/test";
import { API, apiGet } from "./helpers";

test.describe("Stack smoke", () => {
  test("SMK-01 backend health check responds", async () => {
    const res = await apiGet("../healthz");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "ok" });
  });

  test("SMK-02 home page loads without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page).toHaveTitle(/Learnable/i);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("SMK-03 frontend talks to the isolated API", async ({ page }) => {
    const seen: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/")) seen.push(r.url()); });
    await page.goto("/login/student");
    await page.getByPlaceholder("Username").fill("nobody_here");
    await page.getByPlaceholder("Password").fill("wrong-password");
    await page.getByRole("button", { name: /Sign in as a student/i }).click();
    await expect(page.getByText("Invalid credentials")).toBeVisible();
    expect(seen.some((u) => u.startsWith(API))).toBeTruthy();
  });
});
