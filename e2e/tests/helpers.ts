import { APIRequestContext, Page, expect, request as pwRequest } from "@playwright/test";

export const API = `http://localhost:${process.env.E2E_API_PORT || "8020"}/api`;
export const PASSWORD = "E2e-Test-Pass-2026!";

export type Role = "teacher" | "student";
export interface TestUser { username: string; email: string; password: string; role: Role; access: string; refresh: string }

let counter = 0;
export function uniqueName(prefix = "e2e") {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${process.pid % 1000}_${counter}`;
}

async function api(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: API + "/" });
}

/** Create a user through the API (fast setup for tests that aren't about sign-up). */
export async function createUser(role: Role, prefix = role): Promise<TestUser> {
  const ctx = await api();
  const username = uniqueName(prefix);
  const email = `${username}@example.com`;
  const res = await ctx.post("users/auth/register", { data: { username, email, password: PASSWORD, role } });
  expect(res.status(), await res.text()).toBe(200);
  const tokens = await res.json();
  await ctx.dispose();
  return { username, email, password: PASSWORD, role, ...tokens };
}

/** Sign a browser page in by storing the user's tokens, then open `path`. */
export async function signIn(page: Page, user: TestUser, path = "/input") {
  await page.goto("/");
  await page.evaluate(([a, r]) => {
    localStorage.setItem("auth_access", a);
    localStorage.setItem("auth_refresh", r);
  }, [user.access, user.refresh]);
  await page.goto(path);
}

export async function apiPost(path: string, data: unknown, token?: string) {
  const ctx = await api();
  const res = await ctx.post(path, { data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await res.text();
  await ctx.dispose();
  let json: any = null;
  try { json = JSON.parse(body); } catch { /* not JSON */ }
  return { status: res.status(), json, body };
}

export async function apiGet(path: string, token?: string) {
  const ctx = await api();
  const res = await ctx.get(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await res.text();
  await ctx.dispose();
  let json: any = null;
  try { json = JSON.parse(body); } catch { /* not JSON */ }
  return { status: res.status(), json, body };
}

export async function apiPatch(path: string, data: unknown, token?: string) {
  const ctx = await api();
  const res = await ctx.patch(path, { data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await res.text();
  await ctx.dispose();
  let json: any = null;
  try { json = JSON.parse(body); } catch { /* not JSON */ }
  return { status: res.status(), json, body };
}

export const SAMPLE_QUIZ = {
  success: true, content: "Photosynthesis", num_questions: 3,
  quiz: [
    { question: "Where does photosynthesis happen?", options: ["Mitochondria", "Chloroplasts", "Nucleus", "Ribosomes"], correct_answer: "B", explanation: "Chloroplasts contain chlorophyll." },
    { question: "Which gas is released?", options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], correct_answer: "A", explanation: "Splitting water releases oxygen." },
    { question: "What does the Calvin cycle make?", options: ["ATP", "Water", "Glucose", "Chlorophyll"], correct_answer: "C", explanation: "It fixes CO2 into glucose." },
  ],
};

export const SAMPLE_FLASHCARDS = {
  success: true, content: "Photosynthesis",
  flashcards: [
    { front: "Chlorophyll", back: "Green pigment that absorbs light", category: "Cell Biology", difficulty: "easy" },
    { front: "Stomata", back: "Pores that let CO2 in", category: "Plant Anatomy", difficulty: "medium" },
    { front: "Calvin cycle", back: "Turns CO2 into glucose\tusing ATP & NADPH", category: "Biochemistry", difficulty: "hard" },
  ],
};

export const SAMPLE_SUMMARY = (summary: string) => ({
  success: true, original_text: "Photosynthesis lesson", summary, word_count_original: 80, word_count_summary: 20,
});

/** Open /input with text pasted and the given content tab selected. */
export async function openWithText(page: Page, text: string, tab: "Summary" | "Mindmap" | "Quiz" | "Flashcards" | "Video" | "Slides") {
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await page.locator("#text-input").fill(text);
  await page.getByRole("tab", { name: tab, exact: true }).click();
}

/** A short, factual lesson text that generates quickly and predictably. */
export const LESSON = `Photosynthesis is the process plants use to make their own food.
Plants take in carbon dioxide from the air through tiny pores called stomata, and water from the soil through their roots.
Inside chloroplasts, the green pigment chlorophyll absorbs sunlight.
Light energy splits water molecules, releasing oxygen as a by-product.
The energy is stored in ATP and NADPH, which the Calvin cycle uses to turn carbon dioxide into glucose.
Plants use glucose for energy and to build cellulose for their cell walls.`;

/** Collect browser console errors and failed API responses during a test. */
export function watchPage(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return { consoleErrors, failedRequests };
}
