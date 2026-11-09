import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Presentation, Download, FileDown, Loader2, RotateCcw, AlertCircle } from "lucide-react";
import type { PresentationState } from "@/hooks/usePresentation";

export interface PresentationSettings {
  focus: string;
  nSlides: number;
  template: string;
  tone: string;
}

interface PresentationPanelProps {
  presentation: PresentationState;
  hasContent: boolean;
  disabled?: boolean;
  onGenerate: (settings: PresentationSettings) => void;
}

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  extracting: "Reading content",
  generating: "Designing slides",
  exporting: "Exporting",
  done: "Done",
  failed: "Failed",
};

const PresentationPanel: React.FC<PresentationPanelProps> = ({
  presentation,
  hasContent,
  disabled,
  onGenerate,
}) => {
  const { job, pdfUrl, isStarting, isActive, uploadProgress, error, templates, tones,
    isDownloading, download, reset } = presentation;
  const [focus, setFocus] = useState("");
  const [nSlides, setNSlides] = useState(8);
  const [template, setTemplate] = useState("general");
  const [tone, setTone] = useState("educational");

  // ── Finished ──────────────────────────────────────────────
  if (job?.status === "succeeded") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-lg font-semibold text-gray-800">{job.title || "Your presentation"}</h4>
          <Badge variant="secondary">{job.slide_count || job.n_slides} slides</Badge>
        </div>

        {job.has_pdf ? (
          pdfUrl ? (
            <iframe
              src={pdfUrl}
              title="Presentation preview"
              className="w-full aspect-video rounded-lg border border-gray-200 bg-white"
            />
          ) : (
            <div className="flex items-center justify-center aspect-video rounded-lg bg-gray-100">
              {error ? (
                <p className="text-sm text-red-600 px-4 text-center">{error}</p>
              ) : (
                <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 aspect-video rounded-lg bg-emerald-50 text-emerald-800">
            <Presentation className="h-10 w-10" />
            <p className="text-sm">Preview unavailable. Download the PowerPoint to view your slides.</p>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button className="bg-emerald-600 text-white" onClick={() => download("pptx")} disabled={isDownloading}>
            {isDownloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Download PPTX
          </Button>
          {job.has_pdf && (
            <Button variant="secondary" onClick={() => download("pdf")} disabled={isDownloading}>
              <FileDown className="h-4 w-4 mr-2" /> Download PDF
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4 mr-2" /> New presentation
          </Button>
        </div>
      </div>
    );
  }

  // ── In progress ───────────────────────────────────────────
  if (isStarting || isActive) {
    const pct = isStarting ? Math.round(uploadProgress * 0.04) : job?.progress ?? 0;
    const stage = isStarting ? "Uploading" : STAGE_LABELS[job?.stage ?? ""] ?? job?.stage;
    return (
      <div className="text-center p-8 space-y-4">
        <Loader2 className="h-10 w-10 mx-auto animate-spin text-emerald-600" />
        <div>
          <h4 className="text-lg font-semibold">Building your presentation</h4>
          <p className="text-sm text-muted-foreground">
            This usually takes 1–5 minutes. You can keep studying, and we'll keep checking.
          </p>
        </div>
        <Progress value={pct} className="h-2" />
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span className="font-medium">{stage}</span>
          <span>{pct}%</span>
        </div>
        <p className="text-sm text-gray-700">{isStarting ? "Uploading your content..." : job?.message}</p>
      </div>
    );
  }

  // ── Idle / failed ─────────────────────────────────────────
  const failure = job?.status === "failed" ? job.error : error;
  return (
    <div className="p-8">
      <div className="text-center">
        <Presentation className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h4 className="text-lg font-semibold mb-2">Create Presentation</h4>
        <p className="text-sm text-muted-foreground mb-6">
          Turn your notes, document, audio, video or YouTube link into a ready-to-present slide deck
          you can download as PowerPoint or PDF.
        </p>
      </div>

      <div className="space-y-5 mb-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-gray-700 text-sm">Number of slides</Label>
            <span className="text-sm font-medium text-emerald-700">{nSlides}</span>
          </div>
          <Slider min={3} max={20} step={1} value={[nSlides]} onValueChange={v => setNSlides(v[0])} disabled={disabled} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-gray-700 text-sm">Template</Label>
            <Select value={template} onValueChange={setTemplate} disabled={disabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-gray-700 text-sm">Tone</Label>
            <Select value={tone} onValueChange={setTone} disabled={disabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {tones.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="presentation-focus" className="text-gray-700 text-sm">
            What should the slides focus on? <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="presentation-focus"
            placeholder="e.g. key formulas for the exam"
            value={focus}
            maxLength={300}
            onChange={e => setFocus(e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>

      {failure && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{failure}</span>
        </div>
      )}

      <Button
        size="lg"
        onClick={() => onGenerate({ focus, nSlides, template, tone })}
        disabled={disabled || !hasContent}
        className="w-full bg-emerald-600 text-white"
      >
        <Presentation className="h-4 w-4 mr-2" />
        {failure ? "Try Again" : "Create Presentation"}
      </Button>
    </div>
  );
};

export default PresentationPanel;
