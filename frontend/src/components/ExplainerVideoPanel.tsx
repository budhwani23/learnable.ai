import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreditNote } from "@/components/CreditBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Clapperboard, Download, Loader2, RotateCcw, AlertCircle, ScrollText } from "lucide-react";
import type { ExplainerVideoState } from "@/hooks/useExplainerVideo";
import ShareToClassButton from "@/components/ShareToClassButton";
import { useAuth } from "@/hooks/useAuth";

interface ExplainerVideoPanelProps {
  explainer: ExplainerVideoState;
  hasContent: boolean;
  disabled?: boolean;
  onGenerate: (focus: string) => void;
}

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  extracting: "Reading content",
  planning: "Planning",
  storyboard: "Storyboarding",
  narration: "Recording narration",
  animating: "Writing animation",
  rendering: "Rendering",
  reviewing: "Quality review",
  finalizing: "Final render",
  done: "Done",
  failed: "Failed",
};

const ExplainerVideoPanel: React.FC<ExplainerVideoPanelProps> = ({
  explainer,
  hasContent,
  disabled,
  onGenerate,
}) => {
  const [focus, setFocus] = useState("");
  const { isTeacher, creditsLeft } = useAuth();
  const noCredits = creditsLeft("video") === 0;
  const { job, videoUrl, isStarting, isActive, uploadProgress, error, reset } = explainer;

  const fileName = `${(job?.title || "explainer").replace(/[^\w\- ]+/g, "").trim() || "explainer"}.mp4`;

  // ── Finished ──────────────────────────────────────────────
  if (job?.status === "succeeded") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-lg font-semibold text-gray-800">{job.title || "Your explainer video"}</h4>
          <Badge variant="secondary" className="capitalize">{job.source_type}</Badge>
        </div>

        {videoUrl ? (
          <video src={videoUrl} controls className="w-full rounded-lg bg-black aspect-video" />
        ) : (
          <div className="flex items-center justify-center aspect-video rounded-lg bg-gray-100">
            {error || job.has_video === false ? (
              <p className="text-sm text-red-600 px-4 text-center">
                {error || "The video finished without a playable file. Please try creating it again."}
              </p>
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            )}
          </div>
        )}

        {job.transcript?.length > 0 && (
          <details className="rounded-lg border border-gray-200 p-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-700 flex items-center gap-2">
              <ScrollText className="h-4 w-4" /> Narration transcript
            </summary>
            <ol className="mt-3 space-y-2 list-decimal list-inside text-sm text-gray-700">
              {job.transcript.map(beat => (
                <li key={beat.id}>{beat.narration}</li>
              ))}
            </ol>
          </details>
        )}

        <div className="flex justify-end gap-2">
          {isTeacher && (
            <ShareToClassButton type="video" explainerJobId={job.id} defaultTitle={job.title || "Explainer video"} />
          )}
          {videoUrl && (
            <Button variant="secondary" asChild>
              <a href={videoUrl} download={fileName}>
                <Download className="h-4 w-4 mr-2" /> Download
              </a>
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4 mr-2" /> New video
          </Button>
        </div>
      </div>
    );
  }

  // ── In progress ───────────────────────────────────────────
  if (isStarting || isActive) {
    const pct = isStarting ? Math.round(uploadProgress * 0.02) : job?.progress ?? 0;
    const stage = isStarting ? "Uploading" : STAGE_LABELS[job?.stage ?? ""] ?? job?.stage;
    return (
      <div className="text-center p-8 space-y-4">
        <Loader2 className="h-10 w-10 mx-auto animate-spin text-emerald-600" />
        <div>
          <h4 className="text-lg font-semibold">Creating your explainer video</h4>
          <p className="text-sm text-muted-foreground">
            This usually takes 5–15 minutes. You can keep studying — we'll keep checking.
          </p>
        </div>
        <Progress value={pct} className="h-2" />
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span className="font-medium">{stage}</span>
          <span>{pct}%</span>
        </div>
        <p className="text-sm text-gray-700">
          {isStarting ? "Uploading your content..." : job?.message}
        </p>
      </div>
    );
  }

  // ── Idle / failed ─────────────────────────────────────────
  const failure = job?.status === "failed" ? job.error : error;
  return (
    <div className="text-center p-8">
      <Clapperboard className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
      <h4 className="text-lg font-semibold mb-2">Generate Explainer Video</h4>
      <p className="text-sm text-muted-foreground mb-6">
        Turn your notes, document, audio, video or YouTube link into a narrated, animated
        explainer video that walks through the key idea step by step.
      </p>

      <div className="text-left space-y-2 mb-6">
        <Label htmlFor="explainer-focus" className="text-gray-700 text-sm">
          What should the video focus on? <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="explainer-focus"
          placeholder="e.g. why the Calvin cycle needs ATP"
          value={focus}
          maxLength={300}
          onChange={e => setFocus(e.target.value)}
          disabled={disabled}
        />
      </div>

      {failure && (
        <div className="flex items-start gap-2 text-left text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{failure}</span>
        </div>
      )}

      <Button
        size="lg"
        onClick={() => onGenerate(focus)}
        disabled={disabled || !hasContent || noCredits}
        className="w-full bg-emerald-600 text-white"
      >
        <Clapperboard className="h-4 w-4 mr-2" />
        {failure ? "Try Again" : "Generate Video"}
      </Button>
      <CreditNote type="video" />
    </div>
  );
};

export default ExplainerVideoPanel;
