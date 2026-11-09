// Export generated study material to other tools (Anki, Google Forms).
import type { Flashcard, MCQQuestion } from "@/lib/types";

/** Index of the correct option. correct_answer is usually a letter ("B"), sometimes the option text. */
export function correctIndex(q: MCQQuestion): number {
  const ans = (q.correct_answer || "").trim();
  const byText = q.options.findIndex(o => o.trim().toLowerCase() === ans.toLowerCase());
  if (byText >= 0) return byText;
  const letter = ans.match(/^\(?([A-Za-z])[).:]?(\s|$)/);
  if (letter) {
    const idx = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < q.options.length) return idx;
  }
  return -1;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One Anki field: HTML-escaped, tabs removed, newlines as <br>. */
const ankiField = (s: string | undefined) =>
  escapeHtml((s ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, " ").trim()).replace(/\n/g, "<br>");

/** Anki tags can't contain spaces. */
const ankiTag = (s: string | undefined) =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_:-]/gu, "");

const ankiHeader = (deck: string) =>
  [
    "#separator:tab",
    "#html:true",
    "#notetype:Basic",
    `#deck:${deck.replace(/[\r\n\t]/g, " ").trim() || "learnable.ai"}`,
    "#tags column:3",
  ].join("\n");

/**
 * Anki "Import File" text (Anki 2.1.55+): front, back, tags — one note per line.
 * Category and difficulty become tags so cards can be filtered in Anki.
 */
export function flashcardsToAnki(cards: Flashcard[], deck: string): string {
  const rows = cards.map(c => {
    const tags = ["learnable", ankiTag(c.category), ankiTag(c.difficulty)].filter(Boolean).join(" ");
    return [ankiField(c.front), ankiField(c.back), tags].join("\t");
  });
  return `${ankiHeader(deck)}\n${rows.join("\n")}\n`;
}

/** Quiz questions as Anki cards: question + lettered options on the front, answer + explanation on the back. */
export function quizToAnki(questions: MCQQuestion[], deck: string): string {
  const rows = questions.map(q => {
    const options = q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${ankiField(o)}`).join("<br>");
    const idx = correctIndex(q);
    const answer = idx >= 0 ? `${String.fromCharCode(65 + idx)}. ${ankiField(q.options[idx])}` : ankiField(q.correct_answer);
    const back = `<b>${answer}</b>${q.explanation ? `<br><br>${ankiField(q.explanation)}` : ""}`;
    return [`${ankiField(q.question)}<br><br>${options}`, back, "learnable quiz"].join("\t");
  });
  return `${ankiHeader(deck)}\n${rows.join("\n")}\n`;
}

/** A safe file name from a title. */
export const fileNameFor = (title: string, ext: string) =>
  `${(title.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "learnable")}.${ext}`;

export function downloadText(fileName: string, text: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
