// Create a self-grading Google Forms quiz from a generated MCQ quiz (Google Forms API, called from the browser).
import type { MCQQuestion } from "@/lib/types";
import { correctIndex } from "@/lib/exporters";
import { requestAccessToken } from "@/lib/gis";

/** Lets the app create forms and edit only the forms it created. */
export const FORMS_SCOPE = "https://www.googleapis.com/auth/forms.body";
const API = "https://forms.googleapis.com/v1/forms";

export interface CreatedForm {
  formId: string;
  editUrl: string;
  responderUrl: string;
  skipped: number;
}

async function call<T>(token: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg: string = data?.error?.message || `Google Forms request failed (status ${res.status})`;
    if (res.status === 403 && /has not been used|is disabled/i.test(msg)) {
      throw new Error("The Google Forms API isn't enabled for this app's Google Cloud project.");
    }
    throw new Error(msg);
  }
  return data as T;
}

/** Google Forms rejects empty or duplicate choices, so tidy the options first. */
function choiceItem(q: MCQQuestion, index: number) {
  const idx = correctIndex(q);
  if (idx < 0) return null;
  const seen = new Set<string>();
  const options: { value: string }[] = [];
  q.options.forEach(o => {
    const v = o.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      options.push({ value: v });
    }
  });
  const answer = q.options[idx].trim();
  if (options.length < 2 || !answer) return null;
  const feedback = q.explanation?.trim() ? { text: q.explanation.trim() } : undefined;
  return {
    createItem: {
      location: { index },
      item: {
        title: q.question.trim(),
        questionItem: {
          question: {
            required: true,
            choiceQuestion: { type: "RADIO", options },
            grading: {
              pointValue: 1,
              correctAnswers: { answers: [{ value: answer }] },
              ...(feedback ? { whenRight: feedback, whenWrong: feedback } : {}),
            },
          },
        },
      },
    },
  };
}

export async function exportQuizToGoogleForms(title: string, questions: MCQQuestion[]): Promise<CreatedForm> {
  const token = await requestAccessToken(FORMS_SCOPE);
  const form = await call<{ formId: string; responderUri: string }>(token, API, {
    info: { title: title.slice(0, 300), documentTitle: title.slice(0, 300) },
  });

  const items = questions.map((q, i) => choiceItem(q, i)).filter(Boolean) as object[];
  // Re-number locations after skipping unusable questions.
  items.forEach((it, i) => ((it as { createItem: { location: { index: number } } }).createItem.location.index = i));

  await call(token, `${API}/${form.formId}:batchUpdate`, {
    requests: [
      { updateSettings: { settings: { quizSettings: { isQuiz: true } }, updateMask: "quizSettings.isQuiz" } },
      {
        updateFormInfo: {
          info: { description: "Made with learnable.ai. Answers and explanations are shown after submitting." },
          updateMask: "description",
        },
      },
      ...items,
    ],
  });

  return {
    formId: form.formId,
    editUrl: `https://docs.google.com/forms/d/${form.formId}/edit`,
    responderUrl: form.responderUri,
    skipped: questions.length - items.length,
  };
}
