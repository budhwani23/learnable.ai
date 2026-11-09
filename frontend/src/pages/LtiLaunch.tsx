import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clapperboard, FileText, BookOpen, Brain, HelpCircle, Loader2, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  currentLaunch, exchangeLtiCode, library, submitDeepLink, type LearningResourceSummary,
} from "@/lib/library";

/** /lti — landing page after an LMS launch: trade the one-time code for a session, then route. */
export function LtiBridge() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke: the code is single-use
    started.current = true;
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) { setError("Missing launch code. Open the activity from your course again."); return; }
    exchangeLtiCode(code)
      .then(async launch => {
        await refreshUser();
        navigate(launch.mode === "pick" ? "/lti/pick" : `/r/${launch.resource_id}`, { replace: true });
      })
      .catch(e => setError(e.message));
  }, [navigate, refreshUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-emerald-50 p-4">
      {error ? <p className="text-red-600 text-center max-w-md">{error}</p>
             : <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />}
    </div>
  );
}

const ICONS = { summary: FileText, mindmap: Brain, quiz: HelpCircle, flashcards: BookOpen, video: Clapperboard };

/** /lti/pick — instructor chooses which saved resource to add to their course (LTI Deep Linking). */
export function LtiPicker() {
  const launch = currentLaunch();
  const [resources, setResources] = useState<LearningResourceSummary[] | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setResources(null);
    library.list().then(setResources).catch(e => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (!launch || launch.mode !== "pick") {
    return <p className="p-8 text-center">Open this page by adding a learnable.ai activity in your course.</p>;
  }

  const choose = async (r: LearningResourceSummary) => {
    setSubmitting(r.id);
    setError(null);
    try {
      await submitDeepLink(launch.id, r.id); // navigates back to the LMS
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the activity");
      setSubmitting(null);
    }
  };

  return (
    <div className="min-h-screen bg-emerald-50 py-8 px-4">
      <Card className="max-w-3xl mx-auto p-6 shadow-lg border-0 space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            learnable.ai{launch.context_title ? ` · ${launch.context_title}` : ""}
          </p>
          <h1 className="text-2xl font-bold text-gray-800">Add to your course</h1>
          <p className="text-sm text-muted-foreground">
            Pick something from your library. Quizzes get a gradebook column automatically.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            {/* Opens the generator in a new tab; save with "Share to class", then refresh here. */}
            <a href="/input" target="_blank" rel="noopener"><Plus className="h-4 w-4 mr-2" /> Create new</a>
          </Button>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-2" /> Refresh</Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!resources ? (
          <Loader2 className="h-6 w-6 mx-auto animate-spin text-emerald-600" />
        ) : resources.length === 0 ? (
          <p className="text-sm text-center text-muted-foreground py-8">
            Your library is empty. Create a summary, quiz, flashcards or video and use “Share to class” to save it.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {resources.map(r => {
              const Icon = ICONS[r.type] ?? FileText;
              return (
                <li key={r.id} className="flex items-center gap-3 p-3">
                  <Icon className="h-5 w-5 text-emerald-700 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>
                  </div>
                  <Badge variant="secondary" className="capitalize">{r.type}</Badge>
                  <Button size="sm" className="bg-emerald-600 text-white" disabled={!!submitting} onClick={() => choose(r)}>
                    {submitting === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
