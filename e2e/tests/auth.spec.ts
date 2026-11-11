import { test, expect, Page } from "@playwright/test";
import { PASSWORD, apiPost, createUser, signIn, uniqueName } from "./helpers";

async function fillSignUp(page: Page, username: string, email: string, password: string) {
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
}

async function fillSignIn(page: Page, username: string, password: string) {
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(password);
}

const errorBox = (page: Page) => page.locator(".text-red-600");
const header = (page: Page) => page.locator("header");

test.describe("Authentication and roles", () => {
  test("A-01 student sign-up lands on /input with a Student badge", async ({ page }) => {
    const u = uniqueName("stu");
    await page.goto("/register/student");
    await expect(page.getByRole("heading", { name: "Create a student account" })).toBeVisible();
    await fillSignUp(page, u, `${u}@example.com`, PASSWORD);
    await page.getByRole("button", { name: "Create student account" }).click();
    await expect(page).toHaveURL(/\/input$/);
    await expect(header(page)).toContainText(u);
    await expect(header(page)).toContainText("Student");
  });

  test("A-02 teacher sign-up lands on /input with a Teacher badge", async ({ page }) => {
    const u = uniqueName("tch");
    await page.goto("/register/teacher");
    await fillSignUp(page, u, `${u}@example.com`, PASSWORD);
    await page.getByRole("button", { name: "Create teacher account" }).click();
    await expect(page).toHaveURL(/\/input$/);
    await expect(header(page)).toContainText("Teacher");
  });

  test("A-03 /register without a role creates a student", async ({ page }) => {
    const u = uniqueName("def");
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create a student account" })).toBeVisible();
    await fillSignUp(page, u, `${u}@example.com`, PASSWORD);
    await page.getByRole("button", { name: "Create student account" }).click();
    await expect(header(page)).toContainText("Student");
  });

  test("A-04 duplicate username shows a clear error", async ({ page }) => {
    const existing = await createUser("student");
    await page.goto("/register/student");
    await fillSignUp(page, existing.username, `other_${existing.email}`, PASSWORD);
    await page.getByRole("button", { name: "Create student account" }).click();
    await expect(errorBox(page)).toContainText(/already exists/i);
    await expect(page).toHaveURL(/\/register\/student/);
  });

  test("A-05 username length minimum is 3 (2 rejected, 3 accepted)", async () => {
    const two = await apiPost("users/auth/register", { username: "ab", email: "ab@example.com", password: PASSWORD });
    expect(two.status).toBe(422);
    const three = uniqueName("x").slice(-3);
    const ok = await apiPost("users/auth/register", { username: three, email: `${three}@example.com`, password: PASSWORD });
    expect([200, 409]).toContain(ok.status); // 409 only if a random 3-char name already exists
  });

  test("A-05b username too short shows a readable message in the form", async ({ page }) => {
    await page.goto("/register/student");
    await fillSignUp(page, "ab", "ab@example.com", PASSWORD);
    await page.getByRole("button", { name: "Create student account" }).click();
    await expect(errorBox(page)).toBeVisible();
    const text = (await errorBox(page).textContent()) || "";
    // A generic message gives the user no idea which field is wrong.
    expect.soft(text, "error should mention the username").toMatch(/username|3 characters|too short/i);
  });

  test("A-06 username length maximum is 150", async () => {
    const base = uniqueName("L");
    const u150 = (base + "x".repeat(150)).slice(0, 150);
    const ok = await apiPost("users/auth/register", { username: u150, email: "u150@example.com", password: PASSWORD });
    expect(ok.status).toBe(200);
    const u151 = (base + "y".repeat(151)).slice(0, 151);
    const bad = await apiPost("users/auth/register", { username: u151, email: "u151@example.com", password: PASSWORD });
    expect(bad.status).toBe(422);
  });

  test("A-07 password minimum is 8 (7 rejected, 8 accepted)", async () => {
    const u7 = uniqueName("p7");
    expect((await apiPost("users/auth/register", { username: u7, email: `${u7}@example.com`, password: "Abc1234" })).status).toBe(422);
    const u8 = uniqueName("p8");
    expect((await apiPost("users/auth/register", { username: u8, email: `${u8}@example.com`, password: "Abc12345" })).status).toBe(200);
  });

  test("A-08 invalid email is rejected with a readable message", async ({ page }) => {
    await page.goto("/register/student");
    await fillSignUp(page, uniqueName("em"), "not-an-email", PASSWORD);
    await page.getByRole("button", { name: "Create student account" }).click();
    await expect(page).toHaveURL(/\/register\/student/);
    const native = await page.getByPlaceholder("Email").evaluate((el: HTMLInputElement) => el.validity.valid === false);
    if (!native) {
      await expect(errorBox(page)).toBeVisible();
      expect.soft((await errorBox(page).textContent()) || "", "error should mention the email").toMatch(/email/i);
    }
  });

  test("A-09 empty sign-up form shows a message and does not crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/register/student");
    await page.getByRole("button", { name: "Create student account" }).click();
    await expect(page).toHaveURL(/\/register\/student/);
    await expect(errorBox(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("A-10 wrong password shows Invalid credentials", async ({ page }) => {
    const u = await createUser("student");
    await page.goto("/login/student");
    await fillSignIn(page, u.username, "definitely-wrong");
    await page.getByRole("button", { name: "Sign in as a student" }).click();
    await expect(errorBox(page)).toHaveText("Invalid credentials");
  });

  test("A-11 teacher account is refused on the student sign-in", async ({ page }) => {
    const t = await createUser("teacher");
    await page.goto("/login/student");
    await fillSignIn(page, t.username, t.password);
    await page.getByRole("button", { name: "Sign in as a student" }).click();
    await expect(errorBox(page)).toContainText("This is a teacher account");
    expect(await page.evaluate(() => localStorage.getItem("auth_access"))).toBeNull();
  });

  test("A-12 student account is refused on the teacher sign-in", async ({ page }) => {
    const s = await createUser("student");
    await page.goto("/login/teacher");
    await fillSignIn(page, s.username, s.password);
    await page.getByRole("button", { name: "Sign in as a teacher" }).click();
    await expect(errorBox(page)).toContainText("This is a student account");
  });

  test("A-13 switching role keeps ?redirect=", async ({ page }) => {
    await page.goto("/login/student?redirect=%2Fr%2Fabc");
    await page.getByRole("radio", { name: "I'm a teacher" }).click();
    await expect(page).toHaveURL(/\/login\/teacher\?redirect=%2Fr%2Fabc$/);
    await expect(page.getByRole("heading", { name: "Teacher sign in" })).toBeVisible();
  });

  test("A-14 sign out clears the session", async ({ page }) => {
    const s = await createUser("student");
    await signIn(page, s);
    await expect(header(page)).toContainText(s.username);
    await page.getByRole("button", { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => localStorage.getItem("auth_access"))).toBeNull();
    await page.goto("/input");
    await expect(page).toHaveURL(/\/login/);
  });

  test("A-15 protected route redirects to sign-in and back", async ({ page }) => {
    const s = await createUser("student");
    await page.goto("/input");
    await expect(page).toHaveURL(/\/login\?redirect=%2Finput/);
    await fillSignIn(page, s.username, s.password);
    await page.getByRole("button", { name: "Sign in as a student" }).click();
    await expect(page).toHaveURL(/\/input$/);
  });

  test("A-16 open redirect to another site is ignored", async ({ page }) => {
    const s = await createUser("student");
    await page.goto("/login/student?redirect=//evil.example/steal");
    await fillSignIn(page, s.username, s.password);
    await page.getByRole("button", { name: "Sign in as a student" }).click();
    await expect(page).toHaveURL(/localhost:\d+\/input$/);
  });

  test("A-17 garbage token is treated as signed out", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.evaluate(() => { localStorage.setItem("auth_access", "garbage"); localStorage.setItem("auth_refresh", "garbage"); });
    await page.goto("/input");
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });

  test("A-18 API rejects an unknown role", async () => {
    const u = uniqueName("adm");
    const r = await apiPost("users/auth/register", { username: u, email: `${u}@example.com`, password: PASSWORD, role: "admin" });
    expect(r.status).toBe(422);
    const login = await apiPost("users/auth/login", { username: u, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  test("A-19 HTML in a username is shown as text", async ({ page }) => {
    let dialog = false;
    page.on("dialog", async (d) => { dialog = true; await d.dismiss(); });
    const evil = `x<img src=x onerror=alert(1)>${Date.now() % 100000}`;
    const r = await apiPost("users/auth/register", { username: evil, email: `xss${Date.now()}@example.com`, password: PASSWORD });
    test.skip(r.status !== 200, `server rejected the name (${r.status}) — nothing to render`);
    await page.goto("/");
    await page.evaluate(([a, b]) => { localStorage.setItem("auth_access", a); localStorage.setItem("auth_refresh", b); }, [r.json.access, r.json.refresh]);
    await page.goto("/input");
    await expect(header(page)).toContainText("<img src=x");
    expect(dialog).toBe(false);
  });

  test("A-20 unicode username works end to end", async ({ page }) => {
    const u = `José_学生_${Date.now() % 100000}`;
    const r = await apiPost("users/auth/register", { username: u, email: `uni${Date.now()}@example.com`, password: PASSWORD });
    expect([200, 422]).toContain(r.status);
    if (r.status === 200) {
      await page.goto("/login/student");
      await fillSignIn(page, u, PASSWORD);
      await page.getByRole("button", { name: "Sign in as a student" }).click();
      await expect(header(page)).toContainText(u);
    }
  });

  test("A-21 username with surrounding spaces behaves consistently", async () => {
    const core = uniqueName("sp");
    const r = await apiPost("users/auth/register", { username: `  ${core}  `, email: `${core}@example.com`, password: PASSWORD });
    if (r.status === 200) {
      const exact = await apiPost("users/auth/login", { username: `  ${core}  `, password: PASSWORD });
      const trimmed = await apiPost("users/auth/login", { username: core, password: PASSWORD });
      expect.soft(trimmed.status, "signing in with the trimmed name should work").toBe(200);
      expect(exact.status).toBe(200);
    }
  });

  test("A-22 Forgot password explains how to get a reset", async ({ page }) => {
    await page.goto("/login/student");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByText(/Ask your teacher or school admin to reset it/)).toBeVisible();
    await page.getByRole("radio", { name: "I'm a teacher" }).click();
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByText(/Contact the learnable.ai administrator/)).toBeVisible();
  });
});
