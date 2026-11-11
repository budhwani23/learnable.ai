import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { FlashcardOutput, MCQQuizOutput } from "@/lib/types";
import { downloadText, fileNameFor, flashcardsToAnki, quizToAnki } from "@/lib/exporters";
import { exportQuizToGoogleForms } from "@/lib/googleForms";
import { GOOGLE_CLIENT_ID, loadGis } from "@/lib/gis";

type ExportMenuProps =
  | { type: "flashcards"; title: string; data: FlashcardOutput }
  | { type: "quiz"; title: string; data: MCQQuizOutput };

/** "Export" dropdown for flashcards (Anki) and quizzes (Google Forms, Anki). */
export default function ExportMenu(props: ExportMenuProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const formsAvailable = props.type === "quiz" && !!GOOGLE_CLIENT_ID;

  // Load Google's script up front so the consent popup opens straight from the click.
  useEffect(() => {
    if (formsAvailable) loadGis().catch(() => { /* reported on click */ });
  }, [formsAvailable]);

  const exportAnki = () => {
    const text = props.type === "flashcards"
      ? flashcardsToAnki(props.data.flashcards, props.title)
      : quizToAnki(props.data.quiz, props.title);
    downloadText(fileNameFor(props.title, "txt"), text);
    toast({
      title: "Anki file downloaded",
      description: "In Anki choose File → Import and pick the file. It's set up as a Basic deck with tags.",
    });
  };

  const exportForms = async () => {
    if (props.type !== "quiz") return;
    setBusy(true);
    // Open the tab now so popup blockers allow it; point it at the form once it exists.
    const tab = window.open("about:blank", "_blank");
    try {
      const form = await exportQuizToGoogleForms(props.title, props.data.quiz);
      if (tab) tab.location.href = form.editUrl;
      toast({
        title: "Google Forms quiz created",
        description: form.skipped
          ? `${form.skipped} question(s) without a clear correct answer were left out. Check the form before sharing it.`
          : "It's self-grading, with explanations shown after students submit. Send it from the Forms editor.",
      });
    } catch (e) {
      tab?.close();
      toast({
        title: "Couldn't create the Google Form",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Export
          <ChevronDown className="h-4 w-4 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Export {props.type === "quiz" ? "quiz" : "flashcards"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {props.type === "quiz" && (
          <DropdownMenuItem onSelect={exportForms} disabled={!formsAvailable}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            {formsAvailable ? "Google Forms quiz" : "Google Forms (not configured)"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={exportAnki}>
          <Download className="h-4 w-4 mr-2" />
          {props.type === "quiz" ? "Anki cards (.txt)" : "Anki deck (.txt)"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
