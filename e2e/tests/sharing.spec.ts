import { test, expect } from "@playwright/test";
import { LESSON, SAMPLE_QUIZ, SAMPLE_SUMMARY, apiPatch, apiPost, createUser, openWithText, signIn } from "./helpers";

async function sharedQuiz(teacherToken: string, share = true) {
  const r = await apiPost("library/resources", { type: "quiz", title: "Photosynthesis check", payload: SAMPLE_QUIZ }, teacherToken);
  expect(r.status, r.body).toBe(200);
  const id = r.json.resource.id as string;
  if (share) expect((await apiPatch(`library/resources/${id}/sharing`, { share_enabled: true }, teacherToken)).status).toBe(200);
  return id;
}

test.describe("Sharing to a class", () => {
  test("S-01 Share to class is shown to teachers only", async ({ browser }) => {
    for (const role of ["teacher", "student"] as const) {
      const page = await browser.newPage();
      await page.route("**/api/learning/summarize-content", (r) => r.fulfill({ json: SAMPLE_SUMMARY("A summary.") }));
      await signIn(page, await createUser(role));
      await openWithText(page, LESSON, "Summary");
      await page.getByRole("button", { name: "Generate Summary" }).click();
      await expect(page.getByText("A summary.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Share to class" })).toHaveCount(role === "teacher" ? 1 : 0);
      await page.close();
    }
  });

  test("S-02 teacher shares a quiz; student takes it and is graded by the server", async ({ page }) => {
    const teacher = await createUser("teacher");
    const id = await sharedQuiz(teacher.access);
    const student = await createUser("student");

    const resourceResponse = page.waitForResponse((r) => r.url().endsWith(`/library/resources/${id}`) && r.request().method() === "GET");
    await signIn(page, student, `/r/${id}`);
    const payload = await (await resourceResponse).json();
    expect(JSON.stringify(payload), "answer key must not be sent before submitting").not.toContain("correct_answer");

    await expect(page.getByRole("heading", { name: "Photosynthesis check" })).toBeVisible();
    const answers = ["Chloroplasts", "Nitrogen", "Glucose"]; // 2 of 3 correct
    for (let i = 0; i < answers.length; i++) {
      await page.getByRole("button", { name: new RegExp(`${answers[i]}$`) }).click();
      if (i < answers.length - 1) await page.getByRole("button", { name: "Next", exact: true }).click();
    }
    await page.getByRole("button", { name: "Submit quiz" }).click();
    await expect(page.getByRole("heading", { name: "2 / 3" })).toBeVisible();
    await expect(page.getByText(/Correct: Oxygen/)).toBeVisible();
  });

  test("S-03 a student cannot save resources through the API", async () => {
    const s = await createUser("student");
    const r = await apiPost("library/resources", { type: "quiz", title: "x", payload: SAMPLE_QUIZ }, s.access);
    expect(r.status).toBe(403);
  });

  test("S-04 a signed-out visitor is asked to sign in, then returned to the lesson", async ({ page }) => {
    const teacher = await createUser("teacher");
    const id = await sharedQuiz(teacher.access);
    const student = await createUser("student");
    await page.goto(`/r/${id}`);
    await expect(page.getByRole("heading", { name: "Sign in to open this lesson" })).toBeVisible();
    await page.getByRole("link", { name: "Sign in with username" }).click();
    await page.getByPlaceholder("Username").fill(student.username);
    await page.getByPlaceholder("Password").fill(student.password);
    await page.getByRole("button", { name: "Sign in as a student" }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${id}$`));
    await expect(page.getByRole("heading", { name: "Photosynthesis check" })).toBeVisible();
  });

  test("S-05 a saved but unshared resource is not visible to others", async ({ page }) => {
    const teacher = await createUser("teacher");
    const id = await sharedQuiz(teacher.access, false);
    await signIn(page, await createUser("student"), `/r/${id}`);
    await expect(page.getByText("This resource doesn't exist or hasn't been shared with you.")).toBeVisible();
  });

  test("S-06 only the owner can change sharing", async () => {
    const teacher = await createUser("teacher");
    const id = await sharedQuiz(teacher.access, false);
    const other = await createUser("teacher");
    expect((await apiPatch(`library/resources/${id}/sharing`, { share_enabled: true }, other.access)).status).toBe(404);
  });

  test("S-07 quiz attempts with too few, too many or empty answers are graded", async () => {
    const teacher = await createUser("teacher");
    const id = await sharedQuiz(teacher.access);
    const s = await createUser("student");
    for (const answers of [[], ["Chloroplasts"], ["Chloroplasts", "Oxygen", "Glucose", "extra", "extra"], [null, null, null]]) {
      const r = await apiPost(`library/resources/${id}/attempts`, { answers }, s.access);
      expect(r.status, JSON.stringify(answers)).toBe(200);
      expect(r.json.max_score).toBe(3);
    }
  });

  test("S-08 a failed save shows a readable reason, not a bare status code", async ({ page }) => {
    await page.route("**/api/learning/summarize-content", (r) => r.fulfill({ json: SAMPLE_SUMMARY("A summary.") }));
    await page.route("**/api/library/resources", (r) =>
      r.request().method() === "POST"
        ? r.fulfill({ status: 403, json: { error: "Only teacher accounts can share resources to a class." } })
        : r.continue());
    await signIn(page, await createUser("teacher"));
    await openWithText(page, LESSON, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await page.getByRole("button", { name: "Share to class" }).click();
    await page.getByRole("button", { name: "Save to library" }).click();
    await expect(page.getByText("Couldn't save")).toBeVisible();
    await expect(page.getByText("Only teacher accounts can share resources to a class."), "server's reason shown").toBeVisible({ timeout: 3000 });
  });

  test("S-09 HTML inside a shared summary does not run for students", async ({ page }) => {
    const teacher = await createUser("teacher");
    const r = await apiPost("library/resources", {
      type: "summary", title: "Shared summary",
      payload: SAMPLE_SUMMARY('Read this <img src=x onerror="window.__xss=document.cookie||1">'),
    }, teacher.access);
    const id = r.json.resource.id;
    await apiPatch(`library/resources/${id}/sharing`, { share_enabled: true }, teacher.access);
    await signIn(page, await createUser("student"), `/r/${id}`);
    await expect(page.getByText(/Read this/)).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__xss), "a teacher's saved HTML ran in a student's browser").toBeUndefined();
  });

  test("S-10 teacher saves and gets a share link through the dialog", async ({ page }) => {
    await page.route("**/api/learning/summarize-content", (r) => r.fulfill({ json: SAMPLE_SUMMARY("A summary.") }));
    await signIn(page, await createUser("teacher"));
    await openWithText(page, LESSON, "Summary");
    await page.getByRole("button", { name: "Generate Summary" }).click();
    await page.getByRole("button", { name: "Share to class" }).click();
    await page.getByLabel("Title students will see").fill("Plants 101");
    await page.getByRole("button", { name: "Save to library" }).click();
    await expect(page.getByRole("button", { name: "Share to Google Classroom" })).toBeVisible();
    const link = await page.locator("[role=dialog] input[readonly]").inputValue();
    expect(link).toMatch(/\/r\/[0-9a-f-]{36}$/);
  });
});
