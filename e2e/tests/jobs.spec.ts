import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { LESSON, createUser, openWithText, signIn } from "./helpers";

const job = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "e2ejob0000000000000000000000000f", status, stage: status === "failed" ? "failed" : "queued", progress: 0,
  message: "", error: null, title: null, source_type: "text", source_label: "Pasted text", focus: null,
  created_at: 0, updated_at: 0, ...extra,
});

async function mockJob(page: Page, base: "explainer" | "presentations", failWith: string) {
  await page.route(`**/api/${base}/jobs`, (r) =>
    r.request().method() === "POST" ? r.fulfill({ json: { success: true, job: job("queued") } }) : r.continue());
  await page.route(`**/api/${base}/jobs/e2ejob*`, (r) =>
    r.fulfill({ json: { success: true, job: job("failed", { error: failWith }) } }));
}

test.describe("Video and slides: failure handling (mocked)", () => {
  test("V-02 a failed video job shows the reason and Try Again", async ({ page }) => {
    await mockJob(page, "explainer", "Rendering failed after 5 attempts.");
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Video");
    await page.getByRole("button", { name: "Generate Video" }).click();
    await expect(page.getByText("Rendering failed after 5 attempts.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  });

  test("P-02 a failed slide job shows the reason and Try Again", async ({ page }) => {
    await mockJob(page, "presentations", "The presentation service is not running.");
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Slides");
    await page.getByRole("button", { name: "Create Presentation" }).click();
    await expect(page.getByText("The presentation service is not running.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  });

  test("P-03 a stale job id left in the browser does not poll forever", async ({ page }) => {
    let polls = 0;
    await page.route("**/api/presentations/jobs/stale*", (r) => { polls++; return r.fulfill({ status: 404, json: { detail: "Not Found" } }); });
    await signIn(page, await createUser("student"));
    await page.evaluate(() => localStorage.setItem("presentation_active_job", "stale0000"));
    await page.reload();
    await page.getByRole("tab", { name: "Slides", exact: true }).click();
    await page.waitForTimeout(12_000);
    expect(polls, "a 404 for a stale job should stop polling").toBeLessThanOrEqual(1);
  });
});

test.describe("Video and slides: real generation @slow", () => {
  test("P-01 slide deck from text downloads as PPTX @slow", async ({ page }) => {
    test.setTimeout(600_000);
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Slides");
    await page.getByRole("button", { name: "Create Presentation" }).click();
    await expect(page.getByText("Building your presentation")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download PPTX" })).toBeVisible({ timeout: 540_000 });
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PPTX" }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.pptx$/);
    const bytes = readFileSync(await dl.path());
    expect(bytes.subarray(0, 2).toString()).toBe("PK"); // PPTX is a zip
  });

  test("V-01 explainer video from text plays and downloads @slow", async ({ page }) => {
    test.setTimeout(1_800_000);
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Video");
    await page.locator("#explainer-focus").fill("why plants need light");
    await page.getByRole("button", { name: "Generate Video" }).click();
    await expect(page.getByText("Creating your explainer video")).toBeVisible();
    const video = page.locator("video");
    await expect(video).toBeVisible({ timeout: 1_700_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 60_000 }).toBeGreaterThan(0);
    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
    expect(duration).toBeGreaterThan(5);
    await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute("download", /\.mp4$/);
  });
});
