import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Upload, 
  Link, 
  Type, 
  Play, 
  FileText, 
  AlertTriangle, 
  Loader2, 
  X, 
  File, 
  Brain, 
  HelpCircle, 
  BookOpen,
  Trash2,
  Plus
} from "lucide-react";
import { ArrowRight, Video, Headphones, Target, Menu,


  Wand2,


  Map,
  
  Share2,
  Download,
  Check,
  Star,
  Zap,
  Heart, } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useApiKey } from "@/hooks/useApiKey";
import FileUpload from "@/components/ui/file-upload";
import { SUPPORTED_FILE_TYPES } from "@/lib/constants";
import type { useFileUpload } from "@/hooks/useFileUpload";
import type { useProcessing } from "@/hooks/useProcessing";
import type { ProcessingResults } from "@/lib/types";
import ResultsSection from "@/components/ResultsSection";
import ExplainerVideoPanel from "@/components/ExplainerVideoPanel";
import { useExplainerVideo } from "@/hooks/useExplainerVideo";
import { Clapperboard } from "lucide-react";

type InputSectionProps = ReturnType<typeof useFileUpload> &
  Omit<ReturnType<typeof useProcessing>, 'summarizeTextMutation'> &
  { results: ProcessingResults | null };

const InputSection: React.FC<InputSectionProps> = ({
  uploadedFiles,
  isDragOver,
  fileInputRef,
  handleFileSelect,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleFileInputChange,
  removeFile,
  clearFiles,
  processingStatus,
  processMultimediaMutation,
  summarizeMultimediaMutation,
  generateMindmapMutation,
  generateQuizMutation,
  generateFlashcardsMutation,
  results,
}) => {
  const [activeTab, setActiveTab] = useState("summary");
  const [textInput, setTextInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [inputMethod, setInputMethod] = useState<"text" | "file" | "url">("text");
  const { toast } = useToast();
  const explainer = useExplainerVideo();

  // Start an AI explainer-video job from whichever input method is active
  const handleGenerateVideo = (focus: string) => {
    const findFile = (exts: string[]) => uploadedFiles.find(f => exts.includes(f.extension))?.file;
    const useFiles = inputMethod === "file";
    explainer.start({
      audioFile: useFiles ? findFile(SUPPORTED_FILE_TYPES.AUDIO) : undefined,
      videoFile: useFiles ? findFile(SUPPORTED_FILE_TYPES.VIDEO) : undefined,
      documentFile: useFiles ? findFile(SUPPORTED_FILE_TYPES.DOCUMENTS) : undefined,
      text: inputMethod === "text" ? textInput : inputMethod === "url" ? urlInput : undefined,
      focus,
    });
  };
  
  // Custom hooks
  const { hasApiKey, validateApiKey } = useApiKey();

  // Check if processing is in progress
  const isProcessing = processingStatus.state === 'processing' || processingStatus.state === 'uploading';

  // Handle content generation based on active tab and input method
  const handleGenerateContent = () => {
    if (!hasApiKey) {
      toast({
        title: "API Key Required",
        description: "Please configure your Gemini API key in Settings.",
        variant: "destructive",
      });
      return;
    }

    try {
      validateApiKey();
      
      switch (activeTab) {
        case "summary":
          if ((inputMethod === "text" && textInput.trim()) || (inputMethod === "file" && uploadedFiles.length > 0) || (inputMethod === "url" && urlInput.trim())) {
            const textContent = inputMethod === "text" ? textInput : inputMethod === "url" ? urlInput : "";
            summarizeMultimediaMutation.mutate(textContent);
          } else {
            toast({
              title: "Input Required",
              description: "Please provide text, upload files, or enter a URL to generate a summary.",
              variant: "destructive",
            });
          }
          break;
          
        case "mindmap":
          if ((inputMethod === "text" && textInput.trim()) || (inputMethod === "file" && uploadedFiles.length > 0) || (inputMethod === "url" && urlInput.trim())) {
            const textContent = inputMethod === "text" ? textInput : inputMethod === "url" ? urlInput : "";
            generateMindmapMutation.mutate(textContent);
          } else {
            toast({
              title: "Input Required",
              description: "Please provide text, upload files, or enter a URL to create a mindmap.",
              variant: "destructive",
            });
          }
          break;
          
        case "quiz":
          if ((inputMethod === "text" && textInput.trim()) || (inputMethod === "file" && uploadedFiles.length > 0) || (inputMethod === "url" && urlInput.trim())) {
            const textContent = inputMethod === "text" ? textInput : inputMethod === "url" ? urlInput : "";
            generateQuizMutation.mutate({ content: textContent, numQuestions: 10 });
          } else {
            toast({
              title: "Input Required",
              description: "Please provide text, upload files, or enter a URL to generate a quiz.",
              variant: "destructive",
            });
          }
          break;
          
        case "flashcards":
          console.log('Flashcards case triggered');
          console.log('inputMethod:', inputMethod);
          console.log('textInput:', textInput);
          console.log('uploadedFiles:', uploadedFiles);
          console.log('urlInput:', urlInput);
          
          if ((inputMethod === "text" && textInput.trim()) || (inputMethod === "file" && uploadedFiles.length > 0) || (inputMethod === "url" && urlInput.trim())) {
            const textContent = inputMethod === "text" ? textInput : inputMethod === "url" ? urlInput : "";
            console.log('Calling generateFlashcardsMutation with:', textContent);
            generateFlashcardsMutation.mutate(textContent);
          } else {
            console.log('No content found for flashcards');
            toast({
              title: "Input Required",
              description: "Please provide text, upload files, or enter a URL to generate flashcards.",
              variant: "destructive",
            });
          }
          break;
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  // Check if current input method has content
  const hasContent = () => {
    switch (inputMethod) {
      case "text":
        return textInput.trim().length > 0;
      case "file":
        return uploadedFiles.length > 0;
      case "url":
        return urlInput.trim().length > 0;
      default:
        return false;
    }
  };

  const hasResultsForTab = () => {
    if (!results) return false;
    switch (activeTab) {
      case "summary":
        return !!results.summary;
      case "mindmap":
        return !!results.mindmap;
      case "quiz":
        return !!results.quiz;
      case "flashcards":
        return !!results.flashcards;
      default:
        return false;
    }
  };

  // Get loading state for current tab
  const getLoadingState = () => {
    switch (activeTab) {
      case "summary":
        return summarizeMultimediaMutation.isPending;
      case "mindmap":
        return generateMindmapMutation.isPending;
      case "quiz":
        return generateQuizMutation.isPending;
      case "flashcards":
        return generateFlashcardsMutation.isPending;
      default:
        return false;
    }
  };
      const handleClearAll = () => {
        clearFiles();                // Clear uploaded files
        setTextInput("");            // Clear text input
        setUrlInput("");             // Clear URL input
        setActiveTab("summary");     // Optional: Reset to summary tab
        if (!explainer.isActive) explainer.reset(); // keep tracking a video that is still rendering
        // Optionally clear processing status if needed
        // Reset results
        if (results) {
          results.summary = undefined;
          results.mindmap = undefined;
          results.quiz = undefined;
          results.flashcards = undefined;
        }
      };
  return (
<section className="py-16 bg-emerald-50">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12 ">
          <h2 className="text-3xl font-bold mb-4 text-foreground">Create Learning Resources</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Upload your content and generate different types of learning materials on demand.
          </p>
         < div className="text-center py-8">
          <div className="inline-flex items-center gap-6 bg-card rounded-2xl p-6 shadow-card">
            <div className="flex items-center gap-2">
              <Video className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">Video</span>
            </div>
            <div className="flex items-center gap-2">
              <Headphones className="h-5 w-5 text-secondary" />
              <span className="text-sm font-medium">Audio</span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-accent" />
              <span className="text-sm font-medium">Text</span>
            </div>
          </div>
        </div>
        </div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Side - File Upload & Input */}
          <Card className="p-6 shadow-xl border-0">
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-4 text-gray-700">Input Content</h3>
              
              {/* Input Method Tabs */}
              <Tabs value={inputMethod} onValueChange={(value) => setInputMethod(value as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-6 bg-emerald-600">
                  <TabsTrigger value="text" className=" mr-1 flex items-center gap-2 text-white focus:text-gray-700">
                    <Type className="h-4 w-4" />
                    <div className="">Text</div>
                  </TabsTrigger>
                  <TabsTrigger value="file" className="flex items-center gap-2 text-white">
                    <Upload className="h-4 w-4" />
                    Files
                  </TabsTrigger>
                  <TabsTrigger value="url" className="ml-1 flex items-center gap-2 text-white">
                    <Link className="h-4 w-4" />
                    URL
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="text" className="space-y-4">
                  <Label htmlFor="text-input" className="text-gray-900 font-medium">
                    
                  </Label>
                  <Textarea
                    id="text-input"
                    placeholder="Paste your text content, lecture notes, or any educational material here..."
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    className="min-h-[300px] text-gray-900 resize-none border-white"
                    disabled={isProcessing}
                  />
                </TabsContent>

                <TabsContent value="file" className="space-y-4">
                  <Label className="text-base font-medium"></Label>
                  <FileUpload
                    uploadedFiles={uploadedFiles}
                    isDragOver={isDragOver}
                    onRemoveFile={removeFile}
                    onClearFiles={clearFiles}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    fileInputRef={fileInputRef}
                    onFileInputChange={handleFileInputChange}
                    acceptedTypes={SUPPORTED_FILE_TYPES.ALL}
                    multiple={false}
                    disabled={isProcessing}
                  />
                </TabsContent>

                <TabsContent value="url" className="space-y-4">
                  <Label htmlFor="url-input" className="text-gray-600 font-medium">
                    Enter URL
                  </Label>
                  <Input
                    id="url-input"
                    type="url"
                    placeholder="https://youtube.com/watch?v=... or any educational link"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="text-base"
                  />
                  <p className="text-sm text-muted-foreground">
                    Supports YouTube videos, educational websites, and online documents
                  </p>
                </TabsContent>
              </Tabs>
            </div>

            {!hasApiKey && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <p className="text-sm text-amber-800">
                  <strong>API Key Required:</strong> Please configure your Gemini API key in Settings.
                </p>
              </div>
            )}
          </Card>

          {/* Right Side - Content Generation */}
          <Card className="p-6 bg-card shadow-lg border-0">
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-4 text-gray-700">Generate Content</h3>
              
              {/* Content Type Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-5 mb-6 bg-emerald-600">
                  <TabsTrigger value="summary" className="flex items-center gap-2 text-white">
                    <FileText className="h-4 w-4" />
                    <div className="text-sm mr-2">Summary</div>
                  </TabsTrigger>
                  <TabsTrigger value="mindmap" className="flex items-center gap-2 text-white">
                    <Brain className="h-4 w-4" />
                    <div className="text-sm mr-2">Mindmap</div>
                  </TabsTrigger>
                  <TabsTrigger value="quiz" className="flex items-center gap-2 text-white">
                    <HelpCircle className="h-4 w-4" />
                   <div className="text-sm mr-2">Quiz</div>
                  </TabsTrigger>
                  <TabsTrigger value="flashcards" className="flex items-center gap-2 text-white">
                    <BookOpen className="h-4 w-4 " />
                    <div className="text-sm mr-1">Flashcards</div>
                  </TabsTrigger>
                  <TabsTrigger value="video" className="flex items-center gap-2 text-white">
                    <Clapperboard className="h-4 w-4" />
                    <div className="text-sm mr-1">Video</div>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="space-y-4">
                  {hasResultsForTab() ? (
                          <>
                   <div className="space-y-4">
  <ResultsSection allowShare
    results={results} 
    activeTab="summary" 
    onRegenerate={handleGenerateContent}
    isRegenerating={getLoadingState()}
  />

  <div className="flex justify-end gap-2">
    <Button variant="secondary" onClick={handleGenerateContent}>
      <FileText className="h-4 w-4 mr-2" />
      Regenerate
    </Button>
    <Button variant="outline" onClick={handleClearAll}>
      <Trash2 className="h-4 w-4 mr-2" />
      Clear All
    </Button>
  </div>
</div>

                  </>

                  ) : (
                    <div className="text-center p-8">
                      <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <h4 className="text-lg font-semibold mb-2">Generate Summary</h4>
                      <p className="text-sm text-muted-foreground mb-6">
                        Create a concise summary of your content with key points and insights.
                      </p>
                      <Button
                        
                        size="lg"
                        onClick={handleGenerateContent}
                        disabled={!hasApiKey || isProcessing || !hasContent() || getLoadingState()}
                        className="px-6 py-2 w-full rounded text-white 
                        bg-emerald-600"
                      >
                        {getLoadingState() ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4 mr-2" />
                        )}
                        Generate Summary
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="mindmap" className="space-y-4">
                  {hasResultsForTab() ? (
                    <ResultsSection allowShare
                      results={results} 
                      activeTab="mindmap" 
                      onRegenerate={handleGenerateContent}
                      isRegenerating={getLoadingState()}
                    />
                  ) : (
                    <div className="text-center p-8">
                      <Brain className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <h4 className="text-lg font-semibold mb-2">Create Mindmap</h4>
                      <p className="text-sm text-muted-foreground mb-6">
                        Visualize the main concepts and their relationships in your content.
                      </p>
                      <Button
                       
                        size="lg"
                        onClick={handleGenerateContent}
                        disabled={!hasApiKey || isProcessing || !hasContent() || getLoadingState()}
                        className="w-full bg-emerald-600 text-white"
                      >
                        {getLoadingState() ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Brain className="h-4 w-4 mr-2" />
                        )}
                        Create Mindmap
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="quiz" className="space-y-4">
                  {hasResultsForTab() ? (
                    <ResultsSection allowShare
                      results={results} 
                      activeTab="quiz" 
                      onRegenerate={handleGenerateContent}
                      isRegenerating={getLoadingState()}
                    />
                  ) : (
                    <div className="text-center p-8">
                      <HelpCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <h4 className="text-lg font-semibold mb-2">Generate Quiz</h4>
                      <p className="text-sm text-muted-foreground mb-6">
                        Test your knowledge with interactive multiple-choice questions.
                      </p>
                      <Button
                       
                        size="lg"
                        onClick={handleGenerateContent}
                        disabled={!hasApiKey || isProcessing || !hasContent() || getLoadingState()}
                        className="w-full bg-emerald-600 text-white"
                      >
                        {getLoadingState() ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <HelpCircle className="h-4 w-4 mr-2" />
                        )}
                        Generate Quiz
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="flashcards" className="space-y-4">
                  {hasResultsForTab() ? (
                    <ResultsSection allowShare
                      results={results} 
                      activeTab="flashcards" 
                      onRegenerate={handleGenerateContent}
                      isRegenerating={getLoadingState()}
                    />
                  ) : (
                    <div className="text-center p-8">
                      <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <h4 className="text-lg font-semibold mb-2">Create Flashcards</h4>
                      <p className="text-sm text-muted-foreground mb-6">
                        Build study cards with key terms and concepts for effective memorization.
                      </p>
                      <Button
                        
                        size="lg"
                        onClick={handleGenerateContent}
                        disabled={!hasApiKey || isProcessing || !hasContent() || getLoadingState()}
                        className="w-full bg-emerald-600 text-white"
                      >
                        {getLoadingState() ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <BookOpen className="h-4 w-4 mr-2" />
                        )}
                        Create Flashcards
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="video" className="space-y-4">
                  <ExplainerVideoPanel
                    explainer={explainer}
                    hasContent={hasContent()}
                    disabled={isProcessing}
                    onGenerate={handleGenerateVideo}
                  />
                </TabsContent>

              </Tabs>
            </div>

            {/* Processing Status */}
            {isProcessing && (
              <div className="bg-emerald-50 border border-emerald-400 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-emerald-600 animate-spin" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">Processing...</p>
                    <p className="text-xs text-emerald-700">{processingStatus.message}</p>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
};

export default InputSection;