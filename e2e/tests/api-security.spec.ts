import { test, expect, request as pwRequest } from "@playwright/test";
import { API, apiGet, apiPost, createUser } from "./helpers";

test.describe("API security", () => {
  test("X-01 protected endpoints reject requests without a token", async () => {
    const checks: [string, "GET" | "POST"][] = [
      ["users/auth/me", "GET"],
      ["library/resources", "GET"],
      ["library/resources", "POST"],
      ["explainer/jobs", "GET"],
      ["presentations/jobs", "GET"],
      ["learning/summarize-content", "POST"],
    ];
    const results: string[] = [];
    for (const [path, method] of checks) {
      const r = method === "GET" ? await apiGet(path) : await apiPost(path, {});
      results.push(`${method} ${path} -> ${r.status}`);
      expect.soft(r.status, `${method} ${path}`).toBe(401);
    }
    console.log(results.join("\n"));
  });

  test("X-02 image proxy rejects a wrong key", async () => {
    const r = await apiPost("presentations/image-proxy/v1/images/generations", { prompt: "x" }, "wrong-key");
    expect(r.status).toBe(401);
  });

  test("X-03 an ordinary user cannot grant themselves credits", async () => {
    const s = await createUser("student");
    const me = (await apiGet("users/auth/me", s.access)).json;
    const ctx = await pwRequest.newContext({ baseURL: API + "/" });
    const headers = { Authorization: `Bearer ${s.access}` };
    // Credits are only changed through the admin panel API, which is admin-only.
    const r = await ctx.post(`admin/users/${me.id}/credits`, { data: { action: "grant", resource_type: "all", amount: 1000 }, headers });
    const legacy = await ctx.post("users/credits/add", { data: { amount: 1_000_000 }, headers });
    const after = (await apiGet("users/auth/me", s.access)).json.credits;
    await ctx.dispose();
    console.log(`admin credits -> ${r.status()}, legacy credits/add -> ${legacy.status()}`);
    expect(r.status()).toBe(403);
    expect(legacy.status()).toBe(404);
    expect(after, "a student must not be able to add credits to their own account").toEqual(me.credits);
  });

  test("X-04 refresh endpoint rejects access tokens and garbage", async () => {
    const s = await createUser("student");
    const ctx = await pwRequest.newContext({ baseURL: API + "/" });
    const withAccess = await ctx.post(`users/auth/refresh?refresh=${encodeURIComponent(s.access)}`);
    const garbage = await ctx.post("users/auth/refresh?refresh=garbage");
    const valid = await ctx.post(`users/auth/refresh?refresh=${encodeURIComponent(s.refresh)}`);
    await ctx.dispose();
    expect(withAccess.status()).toBe(401);
    expect(garbage.status()).toBe(401);
    expect(valid.status()).toBe(200);
  });

  test("X-05 malformed JSON on register returns 4xx, not 500", async () => {
    const ctx = await pwRequest.newContext({ baseURL: API + "/" });
    const r = await ctx.post("users/auth/register", { data: "{not json", headers: { "Content-Type": "application/json" } });
    await ctx.dispose();
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });

  test("X-06 tokens of a deleted-looking user id are rejected", async () => {
    // A well-formed request with a token signed by someone else must not authenticate.
    const forged = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwidHlwZSI6ImFjY2VzcyJ9.c2lnbmF0dXJl";
    const r = await apiGet("users/auth/me", forged);
    expect(r.status).toBe(401);
  });
});
