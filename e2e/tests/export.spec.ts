import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { LESSON, SAMPLE_FLASHCARDS, SAMPLE_QUIZ, createUser, openWithText, signIn } from "./helpers";

async function downloadVia(page: Page, item: string) {
  await page.getByRole("button", { name: "Export" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: item }).click()]);
  return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), "utf-8") };
}

test.describe("Export (mocked generation)", () => {
  test("E-01 flashcards → Anki deck", async ({ page }) => {
    await page.route("**/api/learning/generate-flashcards-multimedia", (r) => r.fulfill({ json: SAMPLE_FLASHCARDS }));
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Flashcards");
    await page.getByRole("button", { name: "Create Flashcards" }).click();
    await expect(page.getByText("Card 1 of 3")).toBeVisible();
    const { name, text } = await downloadVia(page, "Anki deck (.txt)");
    expect(name).toMatch(/\.txt$/);
    const lines = text.trimEnd().split("\n");
    expect(lines.slice(0, 3)).toEqual(["#separator:tab", "#html:true", "#notetype:Basic"]);
    const notes = lines.filter((l) => !l.startsWith("#"));
    expect(notes).toHaveLength(3);
    for (const n of notes) expect(n.split("\t")).toHaveLength(3);
    expect(notes[2]).toContain("Turns CO2 into glucose using ATP &amp; NADPH");
    await expect(page.getByText("Anki file downloaded").first()).toBeVisible();
  });

  test("E-02 quiz → Anki cards include the right answer", async ({ page }) => {
    await page.route("**/api/learning/generate-mcq-quiz-multimedia", (r) => r.fulfill({ json: SAMPLE_QUIZ }));
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Quiz");
    await page.getByRole("button", { name: "Generate Quiz" }).click();
    await expect(page.getByText("Question 1 of 3")).toBeVisible();
    const { text } = await downloadVia(page, "Anki cards (.txt)");
    const notes = text.trimEnd().split("\n").filter((l) => !l.startsWith("#"));
    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain("<b>B. Chloroplasts</b>");
    expect(notes[1]).toContain("<b>A. Oxygen</b>");
  });

  test("E-03 Google Forms is disabled when Google isn't configured", async ({ page }) => {
    await page.route("**/api/learning/generate-mcq-quiz-multimedia", (r) => r.fulfill({ json: SAMPLE_QUIZ }));
    await signIn(page, await createUser("teacher"));
    await openWithText(page, LESSON, "Quiz");
    await page.getByRole("button", { name: "Generate Quiz" }).click();
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("menuitem", { name: "Google Forms (not configured)" })).toBeDisabled();
  });

  test("E-04 quiz with a full-text correct answer still exports the right option", async ({ page }) => {
    const quiz = { ...SAMPLE_QUIZ, quiz: [{ ...SAMPLE_QUIZ.quiz[0], correct_answer: "Chloroplasts" }] };
    await page.route("**/api/learning/generate-mcq-quiz-multimedia", (r) => r.fulfill({ json: quiz }));
    await signIn(page, await createUser("student"));
    await openWithText(page, LESSON, "Quiz");
    await page.getByRole("button", { name: "Generate Quiz" }).click();
    const { text } = await downloadVia(page, "Anki cards (.txt)");
    expect(text).toContain("<b>B. Chloroplasts</b>");
    // The in-app quiz must agree with the export about which answer is right.
    await page.getByRole("button", { name: /^B\.\s?Chloroplasts/ }).click();
    await page.getByRole("button", { name: "Finish Quiz" }).click();
    await expect(page.getByText("1/1"), "choosing the correct option should score 1/1").toBeVisible();
  });
});
