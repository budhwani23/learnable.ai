import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import ResultsSection from "@/components/ResultsSection";
import StudentQuiz from "@/components/StudentQuiz";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { useAuth } from "@/hooks/useAuth";
import { currentLaunch, library, type LearningResource } from "@/lib/library";
import type { ProcessingResults } from "@/lib/types";

/**
 * A single saved resource, as a student sees it — opened from Google Classroom,
 * a shared link, or inside an LMS iframe (LTI launch).
 */
export default function ResourceView() {
  const { id = "" } = useParams();
  const { isAuthenticated, refreshUser } = useAuth();
  const [resource, setResource] = useState<LearningResource | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const launch = currentLaunch();
  const ltiLaunchId = launch && launch.resource_id === id ? launch.id : undefined;

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    library.get(id)
      .then(r => { if (!cancelled) setResource(r); })
      .catch(() => { if (!cancelled) setError("This resource doesn't exist or hasn't been shared with you."); });
    return () => { cancelled = true; };
  }, [id, isAuthenticated]);

  useEffect(() => {
    if (resource?.type !== "video") return;
    let url: string | null = null;
    library.fetchVideo(resource.id)
      .then(blob => { url = URL.createObjectURL(blob); setVideoUrl(url); })
      .catch(e => setError(e.message));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [resource]);

  const onGoogleSignedIn = useCallback(() => { refreshUser(); }, [refreshUser]);

  if (!isAuthenticated) {
    return (
      <Shell>
        <div className="text-center space-y-4 py-6">
          <h2 className="text-xl font-semibold">Sign in to open this lesson</h2>
          <p className="text-sm text-muted-foreground">Your teacher shared this with you on learnable.ai.</p>
          <GoogleSignInButton onSignedIn={onGoogleSignedIn} />
          <Button asChild variant="outline">
            <Link to={`/login?redirect=${encodeURIComponent(`/r/${id}`)}`}>Sign in with username</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (error) return <Shell><p className="text-center text-red-600 py-10">{error}</p></Shell>;
  if (!resource) return <Shell><Loader2 className="h-8 w-8 mx-auto my-10 animate-spin text-emerald-600" /></Shell>;

  const results = { [resource.type]: resource.payload } as unknown as ProcessingResults;

  return (
    <Shell title={resource.title} subtitle={launch?.context_title}>
      {resource.type === "video" ? (
        videoUrl ? <video src={videoUrl} controls className="w-full rounded-lg bg-black aspect-video" />
                 : <Loader2 className="h-8 w-8 mx-auto my-10 animate-spin text-emerald-600" />
      ) : resource.type === "quiz" && !resource.is_owner ? (
        <StudentQuiz resourceId={resource.id} questions={resource.payload.quiz || []} ltiLaunchId={ltiLaunchId} />
      ) : (
        <ResultsSection results={results} activeTab={resource.type} />
      )}
    </Shell>
  );
}

function Shell({ children, title, subtitle }: { children: React.ReactNode; title?: string; subtitle?: string }) {
  return (
    <div className="min-h-screen bg-emerald-50 py-8 px-4">
      <Card className="max-w-4xl mx-auto p-6 shadow-lg border-0">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            learnable.ai{subtitle ? ` · ${subtitle}` : ""}
          </p>
          {title && <h1 className="text-2xl font-bold text-gray-800">{title}</h1>}
        </div>
        {children}
      </Card>
    </div>
  );
}
