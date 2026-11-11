import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { LESSON, SAMPLE_SUMMARY, createUser, openWithText, signIn, watchPage } from "./helpers";

const GEN_TIMEOUT = 150_000;

test.describe("Generation with real Gemini", () => {
  test.describe.configure({ timeout: 240_000 });

  test("G-01 summary from pasted text", async ({ page }) => {
    const w = watchPage(page);
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await expect(page.getByText("Generating summary...")).toBeVisible();
    await expect(page.locator(".prose").first()).toContainText(/photosynthes/i, { timeout: GEN_TIMEOUT });
    expect(w.failedRequests).toEqual([]);
  });

  test("G-02 quiz: answer every question and see the score", async ({ page }) => {
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Quiz");
    await page.getByRole("button", { name: "Generate Quiz" }).click();
    const counter = page.getByText(/^Question \d+ of \d+$/);
    await expect(counter).toBeVisible({ timeout: GEN_TIMEOUT });
    const total = Number((await counter.textContent())!.match(/of (\d+)/)![1]);
    expect(total, "quiz length is hard-coded to 10").toBe(10);
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
    for (let i = 1; i <= total; i++) {
      await expect(counter).toHaveText(`Question ${i} of ${total}`);
      await page.getByRole("button", { name: /^A\./ }).click();
      await page.getByRole("button", { name: i === total ? "Finish Quiz" : "Next Question" }).click();
    }
    await expect(page.getByRole("heading", { name: "Quiz Results" })).toBeVisible();
    await expect(page.getByText(new RegExp(`^\\d+/${total}$`))).toBeVisible();
    await expect(page.getByText(/% Score$/)).toBeVisible();
  });

  test("G-03 flashcards: navigation boundaries", async ({ page }) => {
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Flashcards");
    await page.getByRole("button", { name: "Create Flashcards" }).click();
    const counter = page.getByText(/^Card \d+ of \d+$/);
    await expect(counter).toBeVisible({ timeout: GEN_TIMEOUT });
    const total = Number((await counter.textContent())!.match(/of (\d+)/)![1]);
    const prev = page.getByRole("button", { name: "Previous", exact: true });
    const next = page.getByRole("button", { name: "Next", exact: true });
    await expect(prev).toBeDisabled();
    for (let i = 1; i < total; i++) await next.click();
    await expect(counter).toHaveText(`Card ${total} of ${total}`);
    await expect(next).toBeDisabled();
    await prev.click();
    await expect(counter).toHaveText(`Card ${total - 1} of ${total}`);
  });

  test("G-04 mind map renders, and the layout buttons do what they say", async ({ page }) => {
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Mindmap");
    await page.getByRole("button", { name: "Create Mindmap" }).click();
    const svg = page.locator(".mermaid-diagram svg").first();
    await expect(svg).toBeVisible({ timeout: GEN_TIMEOUT });

    const ratio = async () => {
      const box = await svg.evaluate((el: SVGSVGElement) => { const b = el.getBBox(); return { w: b.width, h: b.height }; });
      return box.w / box.h;
    };
    await page.getByRole("button", { name: "Horizontal Layout" }).click();
    await page.waitForTimeout(1500);
    const horizontal = await ratio();
    await page.getByRole("button", { name: "Vertical Layout" }).click();
    await page.waitForTimeout(1500);
    const vertical = await ratio();
    console.log(`aspect ratio horizontal=${horizontal.toFixed(2)} vertical=${vertical.toFixed(2)}`);
    expect.soft(horizontal, "'Horizontal Layout' should be wider (relative to height) than 'Vertical Layout'").toBeGreaterThan(vertical);
  });

  test("G-05 empty and whitespace-only text keep Generate disabled", async ({ page }) => {
    await signIn(page, await createUser("student"));
    await openWithText(page, "", "Summary");
    await expect(page.getByRole("button", { name: "Generate Summary" })).toBeDisabled();
    await openWithText(page, "     \n\t  ", "Summary");
    await expect(page.getByRole("button", { name: "Generate Summary" })).toBeDisabled();
  });

  test("G-06 one-word input is handled gracefully", async ({ page }) => {
    const w = watchPage(page);
    await signIn(page, await createUser("student"));
    await openWithText(page, "Photosynthesis", "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await expect(page.getByText("Generating summary...")).toBeHidden({ timeout: GEN_TIMEOUT });
    const hasResult = await page.locator(".prose").count();
    const hasMessage = await page.getByText("Couldn't generate that").count();
    expect.soft(hasResult + hasMessage, "either a summary or a visible message").toBeGreaterThan(0);
    expect(w.consoleErrors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });

  test("G-07 very long text (~200 KB) gives a result or a clear error", async ({ page }) => {
    const w = watchPage(page);
    await signIn(page, await createUser("student"));
    const long = (LESSON + "\n").repeat(Math.ceil(200_000 / (LESSON.length + 1))).slice(0, 200_000);
    await openWithText(page, long, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await expect(page.getByText("Generating summary...")).toBeHidden({ timeout: 200_000 });
    const result = await page.locator(".prose").count();
    const toast = await page.locator("[role=status], li[data-state=open]").count();
    console.log(`long input: result=${result} toast=${toast} 5xx=${w.failedRequests.join(",")}`);
    expect(result + toast, "the user must see either a summary or an error").toBeGreaterThan(0);
  });

  test("G-08 URL tab with an invalid URL shows an error", async ({ page }) => {
    await signIn(page, await createUser("student"));
    await page.getByRole("tab", { name: "URL", exact: true }).click();
    await page.locator("#url-input").fill("this is not a url");
    await page.getByRole("tab", { name: "Summary", exact: true }).click();
    await expect(page.getByRole("button", { name: "Generate Summary" }), "an invalid URL can't be submitted").toBeDisabled();
    await page.getByRole("tab", { name: "URL", exact: true }).click();
    await expect(page.getByText("That isn't a YouTube video link.", { exact: false })).toBeVisible();
    await page.locator("#url-input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.getByRole("tab", { name: "Summary", exact: true }).click();
    await expect(page.getByRole("button", { name: "Generate Summary" })).toBeEnabled();
  });
});

test.describe("Generation input validation and failures (mocked API)", () => {
  test("G-09 unsupported file type is rejected with a message", async ({ page }) => {
    await signIn(page, await createUser("student"));
    await page.getByRole("tab", { name: "Files", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles({ name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await expect(page.getByText("Uploaded Files (1)")).toHaveCount(0);
    await expect(page.getByText(/not supported/i).first(), "the user should be told why the file was ignored").toBeVisible({ timeout: 3000 });
  });

  test("G-10 file above 50 MB is rejected with a message", async ({ page }) => {
    await signIn(page, await createUser("student"));
    await page.getByRole("tab", { name: "Files", exact: true }).click();
    // Playwright can't pass >50 MB buffers directly, so write a real 51 MB file.
    const big = test.info().outputPath("huge.pdf");
    writeFileSync(big, Buffer.alloc(51 * 1024 * 1024));
    await page.locator("input[type=file]").setInputFiles(big);
    await expect(page.getByText("Uploaded Files (1)")).toHaveCount(0);
    await expect(page.getByText(/larger than the 50 MB limit/i).first(), "size error message").toBeVisible({ timeout: 3000 });
  });

  test("G-10b a valid PDF is accepted and listed", async ({ page }) => {
    await signIn(page, await createUser("student"));
    await page.getByRole("tab", { name: "Files", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
    await expect(page.getByText("Uploaded Files (1)")).toBeVisible();
    await expect(page.getByText("notes.pdf")).toBeVisible();
  });

  test("G-11 a server error during generation is shown to the user", async ({ page }) => {
    await page.route("**/api/learning/summarize-content", (r) => r.fulfill({ status: 500, body: "Internal Server Error" }));
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await expect(page.getByRole("button", { name: "Generate Summary" })).toBeEnabled();
    await expect(page.getByText(/error|failed|went wrong|try again/i).first(), "an error message after a 500").toBeVisible({ timeout: 5000 });
  });

  test("G-12 a network failure during generation is shown to the user", async ({ page }) => {
    await page.route("**/api/learning/summarize-content", (r) => r.abort("connectionrefused"));
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await expect(page.getByText(/network|error|failed|try again/i).first(), "an error message after a network failure").toBeVisible({ timeout: 5000 });
  });

  test("G-16 an AI quota error (HTTP 200 + error body) shows a friendly message", async ({ page }) => {
    await page.route("**/api/learning/summarize-content", (r) => r.fulfill({
      json: { success: false, error: "Error generating summary: 429 You exceeded your current quota, please check your plan and billing details." },
    }));
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await expect(page.getByText("Couldn't generate that").first()).toBeVisible();
    await expect(page.getByText(/busy or out of quota/).first()).toBeVisible();
  });

  test("G-13 Clear All resets text and result", async ({ page }) => {
    await page.route("**/api/learning/summarize-content", (r) => r.fulfill({ json: SAMPLE_SUMMARY("Plants make glucose from light.") }));
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await expect(page.getByText("Plants make glucose from light.")).toBeVisible();
    await page.getByRole("button", { name: "Clear All" }).last().click();
    await expect(page.getByText("Plants make glucose from light.")).toBeHidden();
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    await expect(page.locator("#text-input")).toHaveValue("");
  });

  test("G-14 HTML in a generated summary is not executed", async ({ page }) => {
    await page.route("**/api/learning/summarize-content", (r) =>
      r.fulfill({ json: SAMPLE_SUMMARY('Summary text <img src=x onerror="window.__xss=1">') }));
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await expect(page.getByText(/Summary text/)).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__xss), "summary HTML ran a script").toBeUndefined();
  });

  test("G-15 Regenerate after clearing the text tells the user what is missing", async ({ page }) => {
    await page.route("**/api/learning/summarize-content", (r) => r.fulfill({ json: SAMPLE_SUMMARY("First summary.") }));
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await expect(page.getByText("First summary.")).toBeVisible();
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    await page.locator("#text-input").fill("");
    await page.getByRole("button", { name: "Regenerate" }).first().click();
    await expect(page.getByText("Input Required").first()).toBeVisible();
  });
});
