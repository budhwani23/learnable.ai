# learnable.ai — end-to-end test cases

Target: isolated local stack started by Playwright (Postgres in Docker :5434 → Django :8020 →
Vite :8082). Generation cases call the real Gemini API. `@slow` cases (video, slides) run only
with `E2E_INCLUDE_SLOW=1`.

Type: **H** happy path · **B** boundary / edge · **F** failure / negative · **S** security

## Authentication and roles (`tests/auth.spec.ts`)

| ID | Type | Case | Expected |
|---|---|---|---|
| A-01 | H | Sign up as a student on `/register/student` | Lands on `/input`; header shows username + **Student** badge |
| A-02 | H | Sign up as a teacher on `/register/teacher` | Lands on `/input`; **Teacher** badge |
| A-03 | B | `/register` with no role | Student page is shown and the account is a student |
| A-04 | F | Sign up with a username that already exists | Clear "Username already exists" error, no navigation |
| A-05 | B | Username 2 chars (rejected) / 3 chars (accepted) | Min length 3 enforced with a readable message |
| A-06 | B | Username 150 chars (accepted) / 151 chars (rejected) | Max length 150 enforced |
| A-07 | B | Password 7 chars (rejected) / 8 chars (accepted) | Min length 8 enforced |
| A-08 | F | Invalid email (`not-an-email`) | Rejected with a readable message |
| A-09 | F | Submit an empty sign-up form | Readable validation message; no crash |
| A-10 | F | Sign in with a wrong password | "Invalid credentials" |
| A-11 | S | Teacher account on the student sign-in page | Refused: "This is a teacher account…"; no token stored |
| A-12 | S | Student account on the teacher sign-in page | Refused: "This is a student account…" |
| A-13 | H | Switching student/teacher keeps `?redirect=` | URL path changes, query string kept |
| A-14 | H | Sign out | Header shows signed-out state; `/input` redirects to sign-in |
| A-15 | H | Open `/input` signed out, then sign in | Redirect to `/login?redirect=%2Finput`, then back to `/input` |
| A-16 | S | `/login?redirect=//evil.example` | After sign-in stays on this site (`/input`) |
| A-17 | F | Garbage token in localStorage | App treats the user as signed out, no crash |
| A-18 | S | API: register with `role: "admin"` | 422, no account created |
| A-19 | S | Username containing `<img src=x onerror=…>` | Shown as text, never executed |
| A-20 | B | Unicode username (`José_学生`) | Accepted or rejected cleanly; shown correctly if accepted |
| A-21 | B | Username / password with surrounding spaces | Handled consistently between sign-up and sign-in |

## Routing (`tests/routing.spec.ts`)

| ID | Type | Case | Expected |
|---|---|---|---|
| R-01 | F | Unknown route `/does-not-exist` | 404 page |
| R-02 | B | `/login/unknown-role` | Falls back to the student sign-in |
| R-03 | F | `/r/<random uuid>` while signed in | "Not found" style message, no crash |
| R-04 | B | Phone viewport (375×812) sign-in page | No horizontal scrolling; controls usable |
| R-05 | F | Expired access token with a valid refresh token | Silently refreshed; user stays signed in |
| R-06 | S | Sign out on a shared computer | Remembered video/slide job ids are cleared |
| R-07 | B | Home page buttons ("Watch Demo", "Start Your Journey", "Learn More") | Each does something |

## Generation (`tests/generation.spec.ts`, real Gemini)

| ID | Type | Case | Expected |
|---|---|---|---|
| G-01 | H | Summary from pasted text | Summary appears |
| G-02 | H | Quiz from text: answer all 10, finish | "Quiz Results", score "x/10" and "…% Score"; Previous disabled on Q1 |
| G-03 | B | Flashcards: navigate to both ends | "Card N of M" updates; Previous disabled on first, Next on last (cards have no flip) |
| G-04 | H | Mind map from text; Horizontal vs Vertical layout | Diagram renders; Horizontal is wider than Vertical |
| G-05 | B | Empty and whitespace-only text | Generate buttons disabled (or a clear message) |
| G-06 | B | One-word input | Graceful result or clear message, no crash |
| G-07 | B | Very long text (~200 KB) | Generates or shows a clear size error; no hang |
| G-08 | F | URL tab with an invalid URL | Clear error |
| G-09 | F | Upload an unsupported file type | Rejected before upload with a message |
| G-10 | F | Upload a file above the 50 MB limit | Rejected with a message |
| G-10b | H | Upload a small valid PDF | Listed under "Uploaded Files (1)" |
| G-11 | F | API returns 500 for a generation (mocked) | Error toast; page still usable |
| G-12 | F | Network failure during generation (mocked) | Error toast; page still usable |
| G-13 | H | Clear All after a result (mocked) | Inputs and results cleared |
| G-14 | S | Summary containing `<img onerror>` (mocked) | Shown as text; no script runs |
| G-15 | F | Regenerate after clearing the text (mocked) | "Input Required" message |
| G-16 | F | AI quota error: HTTP 200 with a 429 message in the body (mocked) | "Couldn't generate that" with a friendly quota message |

## Export (`tests/export.spec.ts`)

| ID | Type | Case | Expected |
|---|---|---|---|
| E-01 | H | Flashcards → Export → Anki deck | `.txt` download with Anki headers and one tab-separated note per card |
| E-02 | H | Quiz → Export → Anki cards | `.txt` download; back contains the correct answer |
| E-03 | B | Google Forms without `VITE_GOOGLE_CLIENT_ID` | Menu item disabled, labelled "not configured" |
| E-04 | B | Quiz whose correct answer is the option text, not a letter | Export and in-app scoring agree |

## Sharing to a class (`tests/sharing.spec.ts`)

| ID | Type | Case | Expected |
|---|---|---|---|
| S-01 | H | Teacher sees "Share to class"; student does not | Role-based visibility |
| S-02 | H | Teacher saves a quiz and enables the link; student opens `/r/<id>`, takes it | Server-graded score; answer key not sent before submitting |
| S-03 | S | Student calls `POST /library/resources` directly | 403 |
| S-04 | H | Signed-out visitor opens a shared link | Asked to sign in, then returned to the resource |
| S-05 | S | Saved but not shared resource opened by another user | Not found |
| S-06 | S | Non-owner toggles sharing | Not found |
| S-07 | B | Quiz attempt with too few / too many / null answers | Graded without errors |
| S-08 | F | Saving to the library fails (mocked 403) | Toast shows the server's reason, not "403" |
| S-09 | S | Shared summary containing `<img onerror>` opened by a student | No script runs |
| S-10 | H | Teacher saves through the dialog | Share link `/r/<uuid>` shown |

## API security (`tests/api-security.spec.ts`)

| ID | Type | Case | Expected |
|---|---|---|---|
| X-01 | S | Protected endpoints without a token | 401 |
| X-02 | S | Image proxy with a wrong key | 401 |
| X-03 | S | Ordinary user calls `POST /users/credits/add` | Should be refused (users must not grant themselves credits) |
| X-04 | S | Refresh endpoint with an access token / garbage | 401 |
| X-05 | B | Malformed JSON body on register | 4xx, not 500 |
| X-06 | S | Token signed with a different key | 401 |

## Slow: slide decks and explainer video (`tests/jobs.spec.ts`; real runs tagged `@slow`)

| ID | Type | Case | Expected |
|---|---|---|---|
| P-01 | H | Slide deck from text | Job completes; PPTX downloadable |
| P-02 | F | Slide job fails (mocked status) | Error shown with the server's message |
| V-01 | H | Explainer video from text | Job completes; MP4 plays and downloads |
| V-02 | F | Video job fails (mocked status) | Error shown; "Try Again" available |
| P-03 | F | Stale slide job id in the browser (404) | Polling stops |
