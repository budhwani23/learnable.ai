import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { library, type QuizAttemptResult } from "@/lib/library";

interface StudentQuizProps {
  resourceId: string;
  questions: { question: string; options: string[] }[];
  /** Set when opened from an LMS, so the score is sent to its gradebook. */
  ltiLaunchId?: string;
}

/** Quiz for students: answers are graded by the server (the answer key is never sent up front). */
const StudentQuiz: React.FC<StudentQuizProps> = ({ resourceId, questions, ltiLaunchId }) => {
  const [answers, setAnswers] = useState<(string | null)[]>(() => questions.map(() => null));
  const [current, setCurrent] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = questions[current];
  const answeredAll = answers.every(a => a !== null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      setResult(await library.submitQuiz(resourceId, answers, ltiLaunchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the quiz");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const pct = result.max_score ? Math.round((100 * result.score) / result.max_score) : 0;
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold">{result.score} / {result.max_score}</h3>
          <Progress value={pct} className="h-2" />
          {ltiLaunchId && (
            <p className={`text-sm ${result.grade_synced ? "text-emerald-700" : "text-amber-700"}`}>
              {result.grade_synced ? "Your score was sent to your course gradebook."
                : result.grade_sync_error || "Your score was saved but not sent to the gradebook."}
            </p>
          )}
        </div>
        <ol className="space-y-4">
          {questions.map((question, i) => {
            const key = result.answer_key[i];
            const idx = key ? key.correct_answer.toUpperCase().charCodeAt(0) - 65 : -1;
            const correctText = question.options[idx];
            const ok = answers[i] === correctText;
            return (
              <li key={i} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-start gap-2 font-medium">
                  {ok ? <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                      : <XCircle className="h-5 w-5 text-red-600 shrink-0" />}
                  <span>{i + 1}. {question.question}</span>
                </div>
                {!ok && <p className="text-sm text-red-700">Your answer: {answers[i] ?? "—"}</p>}
                <p className="text-sm text-emerald-800">Correct: {correctText}</p>
                {key?.explanation && <p className="text-sm text-muted-foreground">{key.explanation}</p>}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Question {current + 1} of {questions.length}</span>
        <span>{answers.filter(a => a !== null).length} answered</span>
      </div>
      <h3 className="text-lg font-semibold">{q.question}</h3>
      <div className="space-y-2">
        {q.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setAnswers(prev => prev.map((a, j) => (j === current ? opt : a)))}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              answers[current] === opt ? "border-emerald-600 bg-emerald-50" : "hover:bg-gray-50"}`}
          >
            <span className="font-medium mr-2">{String.fromCharCode(65 + i)}.</span>{opt}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-between">
        <Button variant="outline" disabled={current === 0} onClick={() => setCurrent(c => c - 1)}>Previous</Button>
        {current < questions.length - 1 ? (
          <Button onClick={() => setCurrent(c => c + 1)}>Next</Button>
        ) : (
          <Button className="bg-emerald-600 text-white" disabled={!answeredAll || submitting} onClick={submit}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Submit quiz
          </Button>
        )}
      </div>
    </div>
  );
};

export default StudentQuiz;
