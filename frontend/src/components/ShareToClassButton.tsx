import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Check, Copy, GraduationCap, Loader2, School, Share2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  classroomShareUrl, library, resourceUrl, type LearningResourceSummary, type ResourceType,
} from "@/lib/library";

interface ShareToClassButtonProps {
  type: ResourceType;
  defaultTitle: string;
  /** Generated result to save (summary / mindmap / quiz / flashcards). */
  payload?: unknown;
  /** For videos: the finished explainer job. */
  explainerJobId?: string;
}

/**
 * Saves a generated result to the library and offers the ways to put it in front of a class:
 * Google Classroom (share link), Moodle / Canvas / other LTI platforms (activity picker), or a plain link.
 */
const ShareToClassButton: React.FC<ShareToClassButtonProps> = ({ type, defaultTitle, payload, explainerJobId }) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [saved, setSaved] = useState<LearningResourceSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      setSaved(await library.save(type, title, payload ?? {}, explainerJobId));
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // Link sharing must be on for Classroom / plain links (LMS launches don't need it).
  const ensureShared = async (r: LearningResourceSummary) => {
    if (r.share_enabled) return r;
    const updated = await library.setSharing(r.id, true);
    setSaved(updated);
    return updated;
  };

  const shareToClassroom = async () => {
    if (!saved) return;
    // Open synchronously so popup blockers allow it, then point it at Google once sharing is on.
    const win = window.open("about:blank", "_blank");
    try {
      await ensureShared(saved);
      if (win) win.location.href = classroomShareUrl(saved.id, saved.title);
    } catch (e) {
      win?.close();
      toast({ title: "Couldn't enable sharing", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const copyLink = async () => {
    if (!saved) return;
    try {
      await ensureShared(saved);
      await navigator.clipboard.writeText(resourceUrl(saved.id));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast({ title: "Couldn't copy link", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setCopied(false); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="h-4 w-4 mr-2" /> Share to class
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share to your class</DialogTitle>
          <DialogDescription>
            Save this {type === "video" ? "video" : type} to your library, then add it to Google Classroom,
            Moodle, Canvas or any LTI-enabled platform.
          </DialogDescription>
        </DialogHeader>

        {!saved ? (
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700" htmlFor="share-title">Title students will see</label>
            <Input id="share-title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} />
            <Button className="w-full bg-emerald-600 text-white" onClick={save} disabled={busy || !title.trim()}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save to library
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2 font-medium"><GraduationCap className="h-4 w-4" /> Google Classroom</div>
              <p className="text-sm text-muted-foreground">
                Post it as material or an assignment. Students open it and sign in with Google.
              </p>
              <Button size="sm" onClick={shareToClassroom}>Share to Google Classroom</Button>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2 font-medium"><School className="h-4 w-4" /> Moodle, Canvas, Blackboard, Brightspace</div>
              <p className="text-sm text-muted-foreground">
                In your course, add a <strong>learnable.ai</strong> activity (external tool) and pick
                <strong> “{saved.title}”</strong>. Students open it without a separate login
                {type === "quiz" ? ", and quiz scores go straight to your gradebook." : "."}
              </p>
            </div>

            <div className="flex gap-2">
              <Input readOnly value={resourceUrl(saved.id)} className="text-xs" />
              <Button variant="secondary" size="sm" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ShareToClassButton;
