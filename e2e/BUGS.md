# learnable.ai — bugs found by the E2E suite

Run: 2026-11-09, `dev` @ `ad3b7d7`, isolated local stack (see `TEST_CASES.md`).
Result of the fast suite: **71 tests: 54 passed, 17 failed.** After separating out 3 test mistakes, the
failures come down to the bugs below. "Test" is the ID of the failing case. Evidence such as traces,
screenshots and videos is in `e2e/test-results/` after a run (`npx playwright show-report`).

Status: **all 12 bugs are fixed** (BUG-01 to BUG-04 in the first round, BUG-05 to BUG-12 in the second). Second-round run: 65 of 73 passed; the 8 failures were 5 Gemini-quota timeouts (ENV-01) and 3 test-selector fixes, and all of those fixed tests then passed. First round; their tests (X-03, S-09, G-14, R-05, G-11, G-12 and the new G-16) pass. G-01, G-03 and G-04 also failed in that rerun, but only because Gemini kept returning 429 (ENV-01); with the BUG-04 fix the user now sees "The AI service is busy or out of quota right now…" instead of nothing.

Severity: **Critical** — security/data integrity, fix now · **High** — breaks a core flow or exposes
users · **Medium** — wrong result or misleading UI · **Low** — polish.

## Blocker found while testing

**ENV-01 — Gemini API quota exhausted (429).** During the run, Gemini began returning
`429 You exceeded your current quota`. The live site uses the same `GOOGLE_API_KEY`, so live summaries,
quizzes, flashcards, mind maps, slides and videos are probably failing too. Because of BUG-04,
users see nothing when this happens. This blocked G-02 and G-06 on rerun, and the `@slow` slide and
video runs (P-01, V-01). Check the quota/billing for the key in Google AI Studio.

## Bugs

| ID | Severity | Bug | Test | Where | Status |
|---|---|---|---|---|---|
| BUG-01 | **Critical** | Any signed-in user can give themselves unlimited credits: `POST /api/users/credits/add` with `{"amount":1000000}` took a student from 100 to 1,000,100 credits. `/credits/deduct` is also open to every user. | X-03 | `backend/users/api.py` `credits_add`, `credits_deduct` | **Fixed**: `credits/add` and `credits/deduct` are staff-only (403 for others); backend tests added |
| BUG-02 | **High** | Stored XSS: summaries are rendered as raw HTML (`dangerouslySetInnerHTML`, not sanitised). A teacher-saved summary containing `<img src=x onerror=…>` ran script in a **student's** browser (S-09). Generated summaries are rendered the same way (G-14). | S-09, G-14 | `frontend/src/components/ResultsSection.tsx` `MarkdownRenderer` (~l.91) | **Fixed**: summary text is HTML-escaped before markdown; links limited to http(s)/mailto |
| BUG-03 | **High** | Token refresh never works, so everyone is signed out when the 1-hour access token expires. The frontend POSTs `{"refresh": …}` as JSON; the backend reads `refresh` from the query string and returns 422. | R-05 | `frontend/src/lib/api.ts` (refresh call) vs `backend/users/api.py` `refresh` | **Fixed**: refresh accepts a JSON body or `?refresh=`; backend tests added |
| BUG-04 | **High** | Generation failures are invisible. On a server 500, a network failure, or a Gemini 429, the spinner stops, the button re-enables, and no message is shown. The error is stored in `processingStatus.error` but never rendered or toasted. | G-11, G-12, G-06 (and G-02 under quota) | `frontend/src/hooks/useProcessing.ts` (`onError`), `components/InputSection.tsx` | **Fixed**: every generation failure shows a toast; quota errors get a friendly message; upload errors show the server's reason |
| BUG-05 | Medium | Failed generations return **HTTP 200** with the error in the body (seen in the backend log while Gemini returned 429). This hides failures from monitoring, CloudFront and the frontend's status handling. | (log, G-06) | `backend/learning/api.py` / `learning_service.py` | **Fixed**: `ApiErrorStatusMiddleware` returns 400 (bad input), 503 (AI quota, with a readable message) or 502 for `/api/learning/` failures; backend tests added |
| BUG-06 | Medium | Unsupported or oversized files are dropped silently. A `.exe` or a 51 MB PDF just doesn't appear, with no message. The messages "This file type is not supported" and "File size exceeds…" exist but only go to `console.error`. | G-09, G-10 | `frontend/src/hooks/useFileUpload.ts` (~l.348) | **Fixed**: a toast explains why the file was ignored (type or 50 MB limit); G-09, G-10 pass |
| BUG-07 | Medium | Error toasts show bare status codes. Saving to the library when the server refuses shows **"Couldn't save — 403"** instead of the server's reason ("Only teacher accounts can share…"). This affects every `makeRequest` call. | S-08 | `frontend/src/lib/api.ts` `makeRequest` (`throw new Error(String(status))`) | **Fixed**: API errors carry the server's `error`/`detail`, with plain fallbacks for 401/403/404; S-08 passes |
| BUG-08 | Medium | Quizzes whose `correct_answer` is the option text (not a letter) are scored wrong. Picking the right option scored **0/1** in the app, while the Anki export marked it correctly. Shared quizzes are graded the same way on the server. | E-04 | `ResultsSection.tsx` (letter-only scoring), `StudentQuiz.tsx`, `backend/library/services.py` `grade_quiz` | **Fixed**: one `correctIndex` rule (letter, label or option text) in the app, the student quiz and server grading; E-04 and backend tests pass |
| BUG-09 | Low | Sign-up validation errors are generic: a 2-character username and an invalid email both show only "Please check the details you entered." There's also no client-side validation (no `required`, `type=email` or length hints). | A-05b, A-08 | `frontend/src/lib/api.ts` `authPost`, `pages/Register.tsx` | **Fixed**: the form checks fields before sending and names what to fix; 422s are translated per field; A-05b, A-08 pass |
| BUG-10 | Low | Usernames aren't trimmed. `"  name  "` is stored with spaces, so signing in as `name` fails. | A-21 | `backend/users/api.py` `register` | **Fixed**: usernames and emails are trimmed on sign-up and sign-in; A-21 passes |
| BUG-11 | Low | Home page buttons "Watch Demo", "Start Your Journey" and "Learn More" do nothing. "Forgot password?" on the sign-in page is also a no-op. | R-07 | `components/HeroSection.tsx`, `pages/Login.tsx` | **Fixed**: "See How It Works" and "Learn More" scroll to their sections, "Start Your Journey" starts like the main button, "Forgot password?" explains who can reset it; R-07, A-22 pass |
| BUG-12 | Low | Generated quiz options carry a literal "Option A: …" prefix (e.g. `A.Option A: To absorb oxygen…`). This comes from the JSON-fallback prompt's example values. | G-02 (snapshot) | `backend/learning/learning_service.py` `_invoke_mcq` | **Fixed**: the prompt no longer shows "Option A text" placeholders and options are cleaned of letter labels after generation; backend tests added (not re-checked against live Gemini: quota) |

## Found by reading code (fixed in the second round)

These came from the code review for this test plan. All have been changed:

- **Fixed** — The upload box said it supports TXT, but `.txt` isn't in the accepted types, and the "Choose Files" button only accepts one file (`components/ui/file-upload.tsx`, `lib/constants.ts`).
- **No change needed** — The "Input Required" toasts can only appear through Regenerate (G-15 confirms that path). The Generate buttons are disabled instead, so a user gets no hint about why.
- **Fixed** (G-08) — The URL tab promised websites and online documents, but only YouTube links are handled specially; other URLs are summarised as literal text. G-08 passed only because no summary was produced, which was most likely the quota error.
- **Fixed** — Possible problems in the LMS screens: `/lti` can navigate to `/r/null`, and `/lti/pick` fetches the library before checking the launch (`pages/LtiLaunch.tsx`).
- **Fixed** — A video job that "succeeds" without a video would leave a spinner forever (`useExplainerVideo.ts`).

## Disproved by tests

These were suspected from the code, but the tests passed:

- "Horizontal/Vertical Layout buttons are swapped" — G-04 passed (horizontal is wider).
- "Polling never stops after a 404 for a stale job" — P-03 passed.
- "Sign out leaves the video/slide job ids behind" — R-06 passed.

## Test mistakes fixed during triage (not bugs)

- Quiz option buttons are named `A.Option…` (no space); the selector expected `A. `.
- The toast title is rendered twice (visible title plus live region), so the locator needs `.first()`.
- Playwright can't send buffers over 50 MB, so the oversized-file test writes a real 51 MB file.
