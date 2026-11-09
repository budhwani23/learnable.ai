import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FileText, HelpCircle, BookOpen, Brain, Download, Share2, Copy, Loader2, CheckCircle, XCircle, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useProcessing } from "@/hooks/useProcessing";
import { useToast } from "@/hooks/use-toast";
import type { ProcessingResults } from "@/lib/types";
import { useState, useEffect, useRef } from "react";
import MermaidDiagram from "@/components/MermaidDiagram";
import { convertMindmapToMermaid } from "@/utils/mindmapToMermaid";
import MindmapViewer from "@/components/MindmapViewer";
import ShareToClassButton from "@/components/ShareToClassButton";
import ExportMenu from "@/components/ExportMenu";
import { useAuth } from "@/hooks/useAuth";
import { defaultTitle, payloadFor, type ResourceType } from "@/lib/library";
import type { MCQQuestion } from "@/lib/types";

interface ResultsSectionProps {
  results?: ProcessingResults | null;
  activeTab?: string;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
  /** Show "Share to class" (saving to the library). Off when viewing an already-shared resource. */
  allowShare?: boolean;
}

// Quiz state interface
interface QuizState {
  currentQuestion: number;
  userAnswers: (string | null)[];
  showResults: boolean;
  score: number;
}

// Quiz result state interface
interface QuizResultState {
  currentQuestion: number;
}

// Flashcard state interface
interface FlashcardState {
  currentCard: number;
}

// Mindmap state interface for zoom functionality
interface MindmapState {
  zoomLevel: number;
}

// Markdown renderer component
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  // Simple markdown parser for basic formatting
  const renderMarkdown = (text: string) => {
    return text
      // Headers
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2 text-foreground">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-6 mb-3 text-foreground">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-8 mb-4 text-foreground">$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      // Lists
      .replace(/^\* (.*$)/gim, '<li class="ml-4 mb-1">$1</li>')
      .replace(/^- (.*$)/gim, '<li class="ml-4 mb-1">$1</li>')
      // Wrap lists in ul tags (simple approach)
      .replace(/(<li.*<\/li>)/gs, '<ul class="list-disc space-y-1 my-3">$1</ul>')
      // Code blocks
      .replace(/```([\s\S]*?)```/g, '<pre class="bg-muted p-3 rounded-lg my-3 overflow-x-auto"><code class="text-sm">$1</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary hover:underline" target="_blank" rel="noopener noreferrer">$1</a>')
      // Line breaks
      .replace(/\n\n/g, '</p><p class="mb-3">')
      .replace(/\n/g, '<br>')
      // Wrap in paragraph tags
      .replace(/^(?!<[h|u|p|pre])(.*)/gim, '<p class="mb-3 leading-relaxed">$1')
      .replace(/(.*?)(?=<h[1-3]|$)/gs, (match) => {
        if (match.trim() && !match.startsWith('<')) {
          return `<p class="mb-3 leading-relaxed">${match}</p>`;
        }
        return match;
      });
  };

  return (
    <div 
      className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-code:text-foreground prose-pre:bg-muted prose-pre:text-foreground"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
};

const ResultsSection: React.FC<ResultsSectionProps> = ({ results, activeTab, onRegenerate, isRegenerating = false, allowShare: allowShareProp = false }) => {
  // Sharing to a class is for teacher accounts only.
  const { isTeacher } = useAuth();
  const allowShare = allowShareProp && isTeacher;
  const { toast } = useToast();
  const [quizState, setQuizState] = useState<QuizState>({
    currentQuestion: 0,
    userAnswers: [],
    showResults: false,
    score: 0,
  });

  const [quizResultState, setQuizResultState] = useState<QuizResultState>({
    currentQuestion: 0,
  });

  const [flashcardState, setFlashcardState] = useState<FlashcardState>({
    currentCard: 0,
  });

  // New state for mindmap zoom
  const [mindmapState, setMindmapState] = useState<MindmapState>({
    zoomLevel: 1,
  });

  // Reference to mindmap container for scrolling
  const mindmapContainerRef = useRef<HTMLDivElement>(null);

  // Helper function to get correct answer text from letter
  const getCorrectAnswerText = (question: MCQQuestion) => {
    const letterIndex = question.correct_answer.charCodeAt(0) - 65; // Convert A=0, B=1, C=2, D=3
    return question.options[letterIndex];
  };

  // Helper function to check if answer is correct
  const isAnswerCorrect = (question: MCQQuestion, userAnswer: string | null) => {
    if (!userAnswer) return false;
    const correctAnswerText = getCorrectAnswerText(question);
    return userAnswer === correctAnswerText;
  };

  // Debug logging
  useEffect(() => {
    console.log('ResultsSection received results:', results);
    if (results?.summary) {
      console.log('Summary data:', results.summary);
    }
  }, [results]);

  // Initialize quiz state when results change
  useEffect(() => {
    if (results?.quiz?.quiz) {
      setQuizState({
        currentQuestion: 0,
        userAnswers: new Array(results.quiz.quiz.length).fill(null),
        showResults: false,
        score: 0,
      });
    }
  }, [results?.quiz]);

  // Initialize flashcard state when results change
  useEffect(() => {
    if (results?.flashcards?.flashcards) {
      setFlashcardState({
        currentCard: 0,
      });
    }
  }, [results?.flashcards]);

  // Reset mindmap zoom when results change
  useEffect(() => {
    if (results?.mindmap) {
      setMindmapState({
        zoomLevel: 1,
      });
    }
  }, [results?.mindmap]);

  // Zoom in function
  const handleZoomIn = () => {
    setMindmapState(prev => ({
      ...prev,
      zoomLevel: Math.min(prev.zoomLevel + 0.1, 2.0), // Limit max zoom to 2x
    }));
  };

  // Zoom out function
  const handleZoomOut = () => {
    setMindmapState(prev => ({
      ...prev,
      zoomLevel: Math.max(prev.zoomLevel - 0.1, 0.5), // Limit min zoom to 0.5x
    }));
  };

  // Reset zoom function
  const handleResetZoom = () => {
    setMindmapState({
      zoomLevel: 1,
    });
  };

  const handleAnswerSelect = (answer: string) => {
    if (results?.quiz?.quiz) {
      const newUserAnswers = [...quizState.userAnswers];
      newUserAnswers[quizState.currentQuestion] = answer;
      
      setQuizState(prev => ({
        ...prev,
        userAnswers: newUserAnswers,
      }));
    }
  };

  const handleNextQuestion = () => {
    if (results?.quiz?.quiz && quizState.currentQuestion < results.quiz.quiz.length - 1) {
      setQuizState(prev => ({
        ...prev,
        currentQuestion: prev.currentQuestion + 1,
      }));
    }
  };

  const handlePreviousQuestion = () => {
    if (quizState.currentQuestion > 0) {
      setQuizState(prev => ({
        ...prev,
        currentQuestion: prev.currentQuestion - 1,
      }));
    }
  };

  const handleFinishQuiz = () => {
    if (results?.quiz?.quiz) {
      let score = 0;
      results.quiz.quiz.forEach((question, index) => {
        if (isAnswerCorrect(question, quizState.userAnswers[index])) {
          score++;
        }
      });
      
      setQuizState(prev => ({
        ...prev,
        showResults: true,
        score,
      }));
      
      // Reset to first question for results display
      setQuizResultState({
        currentQuestion: 0,
      });
    }
  };

  const handleRestartQuiz = () => {
    if (results?.quiz?.quiz) {
      setQuizState({
        currentQuestion: 0,
        userAnswers: new Array(results.quiz.quiz.length).fill(null),
        showResults: false,
        score: 0,
      });
    }
  };

  const handleNextResult = () => {
    if (results?.quiz?.quiz && quizResultState.currentQuestion < results.quiz.quiz.length - 1) {
      setQuizResultState(prev => ({
        ...prev,
        currentQuestion: prev.currentQuestion + 1,
      }));
    }
  };

  const handlePreviousResult = () => {
    if (quizResultState.currentQuestion > 0) {
      setQuizResultState(prev => ({
        ...prev,
        currentQuestion: prev.currentQuestion - 1,
      }));
    }
  };

  // Flashcard navigation handlers
  const handleNextFlashcard = () => {
    if (results?.flashcards?.flashcards && flashcardState.currentCard < results.flashcards.flashcards.length - 1) {
      setFlashcardState(prev => ({
        ...prev,
        currentCard: prev.currentCard + 1,
      }));
    }
  };

  const handlePreviousFlashcard = () => {
    if (flashcardState.currentCard > 0) {
      setFlashcardState(prev => ({
        ...prev,
        currentCard: prev.currentCard - 1,
      }));
    }
  };

  // If no results, show empty state
  if (!results) {
    return (
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center">
            <h2 className="text-3xl font-bold mb-4 text-foreground">Your Learning Resources</h2>
            <p className="text-muted-foreground">
              Process some content to see your AI-generated learning resources here
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Check if we have any content to show
  const hasAnyContent = results.summary || results.mindmap || results.quiz || results.flashcards;

  if (!hasAnyContent) {
    return (
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center">
            <h2 className="text-3xl font-bold mb-4 text-foreground">Your Learning Resources</h2>
            <p className="text-muted-foreground">
              Generate some content to see your AI-generated learning resources here
            </p>
          </div>
        </div>
      </section>
    );
  }

  // If activeTab is provided, show only that specific content
  if (activeTab) {
    const renderActiveTabContent = () => {
      switch (activeTab) {
        case "summary":
          return results?.summary ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">Summary</h3>
                {onRegenerate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRegenerate}
                    disabled={isRegenerating}
                    className="flex items-center gap-2"
                  >
                    {isRegenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    Regenerate
                  </Button>
                )}
              </div>
              <div className="bg-background/50 p-6 rounded-lg border border-border/50 max-h-96 overflow-y-auto">
                <MarkdownRenderer content={results.summary.summary} />
              </div>
            </div>
          ) : (
            <Card className="p-8 bg-gradient-card shadow-card border-0">
              <div className="text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No summary available. Generate a summary to see it here.</p>
              </div>
            </Card>
          );

        case "mindmap":
          return results?.mindmap ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-foreground">Mindmap</h3>
                <div className="flex items-center space-x-2">
                  {onRegenerate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRegenerate}
                      disabled={isRegenerating}
                      className="flex items-center gap-2 mr-4"
                    >
                      {isRegenerating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      Regenerate
                    </Button>
                  )}
                  <div className="flex items-center border rounded-md overflow-hidden">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleZoomOut}
                      title="Zoom Out"
                      disabled={mindmapState.zoomLevel <= 0.5}
                      className="h-8 px-2 rounded-none"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleResetZoom}
                      title="Reset Zoom"
                      className="h-8 px-2 rounded-none border-l border-r border-border/30"
                    >
                      <span className="text-xs font-mono">{Math.round(mindmapState.zoomLevel * 100)}%</span>
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleZoomIn}
                      title="Zoom In"
                      disabled={mindmapState.zoomLevel >= 2.0}
                      className="h-8 px-2 rounded-none"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <div 
                ref={mindmapContainerRef}
                className="mindmap-container border border-border/50 rounded-lg"
                style={{
                  height: '500px',
                  overflow: 'auto',
                  position: 'relative',
                }}
              >
                <div 
                  style={{
                    transform: `scale(${mindmapState.zoomLevel})`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.2s ease',
                    width: '100%',
                    height: '100%',
                    padding: '20px',
                  }}
                >
                  <MindmapViewer mindmap={results.mindmap} />
                </div>
              </div>
            </div>
          ) : (
            <Card className="p-8 bg-gradient-card shadow-card border-0">
              <div className="text-center text-muted-foreground">
                <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No mindmap available. Process some content to generate a mindmap.</p>
              </div>
            </Card>
          );

        case "quiz":
          return results?.quiz ? (
            <div className="space-y-6">
              {!quizState.showResults ? (
                // Quiz Interface
                <Card className="p-8 bg-gradient-card shadow-card border-0">
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <h3 className="text-2xl font-bold text-foreground">Quiz</h3>
                        {onRegenerate && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={onRegenerate}
                            disabled={isRegenerating}
                            className="flex items-center gap-2"
                          >
                            {isRegenerating ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                            Regenerate
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-muted-foreground">
                          Question {quizState.currentQuestion + 1} of {results.quiz.quiz.length}
                        </span>
                        <div className="flex gap-1">
                          {results.quiz.quiz.map((_, index) => (
                            <div
                              key={index}
                              className={`w-2 h-2 rounded-full ${
                                index === quizState.currentQuestion
                                  ? 'bg-primary'
                                  : quizState.userAnswers[index] !== null
                                  ? 'bg-green-500'
                                  : 'bg-muted'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mb-6">
                      <h4 className="text-lg font-semibold mb-4 text-foreground">
                        {results.quiz.quiz[quizState.currentQuestion].question}
                      </h4>
                      <div className="space-y-3">
                        {results.quiz.quiz[quizState.currentQuestion].options.map((option, optIndex) => (
                          <button
                            key={optIndex}
                            onClick={() => handleAnswerSelect(option)}
                            className={`w-full p-4 rounded-lg border transition-all duration-200 text-left ${
                              quizState.userAnswers[quizState.currentQuestion] === option
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border hover:border-primary/50 hover:bg-muted/50'
                            }`}
                          >
                            <span className="font-medium mr-3">
                              {String.fromCharCode(65 + optIndex)}.
                            </span>
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-between">
                      <Button
                        variant="outline"
                        onClick={handlePreviousQuestion}
                        disabled={quizState.currentQuestion === 0}
                      >
                        Previous
                      </Button>

                      {quizState.currentQuestion === results.quiz.quiz.length - 1 ? (
                        <Button
                          variant="hero"
                          onClick={handleFinishQuiz}
                          disabled={quizState.userAnswers[quizState.currentQuestion] === null}
                        >
                          Finish Quiz
                        </Button>
                      ) : (
                        <Button
                          variant="hero"
                          onClick={handleNextQuestion}
                          disabled={quizState.userAnswers[quizState.currentQuestion] === null}
                        >
                          Next Question
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ) : (
                // Results Interface
                <Card className="p-8 bg-gradient-card shadow-card border-0">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                      <h3 className="text-2xl font-bold text-foreground">Quiz Results</h3>
                      <div className="text-2xl font-bold text-primary">
                        {quizState.score}/{results.quiz.quiz.length}
                      </div>
                      <div className="text-muted-foreground">
                        {Math.round((quizState.score / results.quiz.quiz.length) * 100)}% Score
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleRestartQuiz}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Retake Quiz
                    </Button>
                  </div>

                  <div className="space-y-6">
                    {(() => {
                      const question = results.quiz.quiz[quizResultState.currentQuestion];
                      const userAnswer = quizState.userAnswers[quizResultState.currentQuestion];
                      const correctAnswerText = getCorrectAnswerText(question);
                      const isCorrect = isAnswerCorrect(question, userAnswer);

                      return (
                        <Card className="p-6 bg-background/50 border border-border/50">
                          <div className="flex items-start gap-4">
                            <Badge
                              variant={isCorrect ? "default" : "destructive"}
                              className="mt-1"
                            >
                              {isCorrect ? (
                                <CheckCircle className="h-3 w-3 mr-1" />
                              ) : (
                                <XCircle className="h-3 w-3 mr-1" />
                              )}
                              Q{quizResultState.currentQuestion + 1}
                            </Badge>
                            <div className="flex-1">
                              <h4 className="text-lg font-semibold mb-4 text-foreground">
                                {question.question}
                              </h4>
                              <div className="space-y-2 mb-4">
                                {question.options.map((option, optIndex) => (
                                  <div
                                    key={optIndex}
                                    className={`p-3 rounded-lg border transition-colors ${
                                      option === correctAnswerText
                                        ? "border-green-500 bg-green-50 text-green-700"
                                        : option === userAnswer && !isCorrect
                                        ? "border-red-500 bg-red-50 text-red-700"
                                        : "border-border bg-muted/30"
                                    }`}
                                  >
                                    <span className="text-sm font-medium mr-3">
                                      {String.fromCharCode(65 + optIndex)}.
                                    </span>
                                    {option}
                                    {option === correctAnswerText && (
                                      <CheckCircle className="h-4 w-4 ml-2 inline text-green-600" />
                                    )}
                                    {option === userAnswer && !isCorrect && (
                                      <XCircle className="h-4 w-4 ml-2 inline text-red-600" />
                                    )}
                                  </div>
                                ))}
                              </div>
                              <div className="p-3 bg-muted/50 rounded-lg">
                                <p className="text-sm font-medium text-blue-600 mb-1">Explanation:</p>
                                <p className="text-sm text-muted-foreground">{question.explanation}</p>
                              </div>
                            </div>
                          </div>
                        </Card>
                      );
                    })()}
                  </div>

                  <div className="flex justify-between mt-6">
                    <Button
                      variant="outline"
                      onClick={handlePreviousResult}
                      disabled={quizResultState.currentQuestion === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="hero"
                      onClick={handleNextResult}
                      disabled={quizResultState.currentQuestion === results.quiz.quiz.length - 1}
                    >
                      Next
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          ) : (
            <Card className="p-8 bg-gradient-card shadow-card border-0">
              <div className="text-center text-muted-foreground">
                <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No quiz available. Process some content to generate quiz questions.</p>
              </div>
            </Card>
          );

        case "flashcards":
          return results?.flashcards ? (
            <div className="space-y-6">
              <Card className="p-8 bg-gradient-card shadow-card border-0">
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <h3 className="text-2xl font-bold text-foreground">Flashcards</h3>
                      {onRegenerate && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onRegenerate}
                          disabled={isRegenerating}
                          className="flex items-center gap-2"
                        >
                          {isRegenerating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                          Regenerate
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-muted-foreground">
                        Card {flashcardState.currentCard + 1} of {results.flashcards.flashcards.length}
                      </span>
                      <div className="flex gap-1">
                        {results.flashcards.flashcards.map((_, index) => (
                          <div
                            key={index}
                            className={`w-2 h-2 rounded-full ${
                              index === flashcardState.currentCard
                                ? 'bg-primary'
                                : 'bg-muted'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="text-center">
                    <div className="mb-6">
                      <div className="flex justify-center gap-2 mb-4">
                        <Badge variant="outline">
                          Card {flashcardState.currentCard + 1}
                        </Badge>
                        <Badge variant="secondary">
                          {results.flashcards.flashcards[flashcardState.currentCard].category}
                        </Badge>
                        <Badge variant="outline">
                          {results.flashcards.flashcards[flashcardState.currentCard].difficulty}
                        </Badge>
                      </div>
                      <h4 className="text-xl font-semibold text-foreground mb-6">
                        {results.flashcards.flashcards[flashcardState.currentCard].front}
                      </h4>
                      <div className="border-t pt-6">
                        <p className="text-lg text-muted-foreground leading-relaxed">
                          {results.flashcards.flashcards[flashcardState.currentCard].back}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <Button
                      variant="outline"
                      onClick={handlePreviousFlashcard}
                      disabled={flashcardState.currentCard === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="hero"
                      onClick={handleNextFlashcard}
                      disabled={flashcardState.currentCard === results.flashcards.flashcards.length - 1}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          ) : (
            <Card className="p-8 bg-gradient-card shadow-card border-0">
              <div className="text-center text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No flashcards available. Process some content to generate flashcards.</p>
              </div>
            </Card>
          );

        default:
          return null;
      }
    };

    const shareType = activeTab as ResourceType;
    const sharePayload = payloadFor(shareType, results);
    return (
      <div className="max-w-6xl mx-auto">
        {sharePayload && (allowShare || shareType === "quiz" || shareType === "flashcards") && (
          <div className="flex justify-end gap-2 mb-3">
            {shareType === "quiz" && results?.quiz?.quiz?.length ? (
              <ExportMenu type="quiz" title={defaultTitle("quiz", results)} data={results.quiz} />
            ) : null}
            {shareType === "flashcards" && results?.flashcards?.flashcards?.length ? (
              <ExportMenu type="flashcards" title={defaultTitle("flashcards", results)} data={results.flashcards} />
            ) : null}
            {allowShare && (
              <ShareToClassButton type={shareType} payload={sharePayload} defaultTitle={defaultTitle(shareType, results)} />
            )}
          </div>
        )}
        {renderActiveTabContent()}
      </div>
    );
  }

  return (
    <section className="py-16">
      <div className="container mx-auto px-4">

        <div className="max-w-6xl mx-auto">
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-8">
              <TabsTrigger value="summary" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Summary
              </TabsTrigger>
              <TabsTrigger value="quiz" className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4" />
                Quiz
              </TabsTrigger>
              <TabsTrigger value="flashcards" className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Flashcards
              </TabsTrigger>
              <TabsTrigger value="mindmap" className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Mind Map
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary">
              {results.summary ? (
                <div className="bg-background/50 p-6 rounded-lg border border-border/50 max-h-96 overflow-y-auto">
                  <MarkdownRenderer content={results.summary.summary} />
                </div>
              ) : (
                <Card className="p-8 bg-gradient-card shadow-card border-0">
                  <div className="text-center text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No summary available. Generate a summary to see it here.</p>
                  </div>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="quiz">
              {results.quiz ? (
                <div className="space-y-6">
                  {!quizState.showResults ? (
                    // Quiz Interface
                    <Card className="p-8 bg-gradient-card shadow-card border-0">
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-2xl font-bold text-foreground">Quiz</h3>
                          <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground">
                              Question {quizState.currentQuestion + 1} of {results.quiz.quiz.length}
                            </span>
                            <div className="flex gap-1">
                              {results.quiz.quiz.map((_, index) => (
                                <div
                                  key={index}
                                  className={`w-2 h-2 rounded-full ${
                                    index === quizState.currentQuestion
                                      ? 'bg-primary'
                                      : quizState.userAnswers[index] !== null
                                      ? 'bg-green-500'
                                      : 'bg-muted'
                                  }`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="mb-6">
                          <h4 className="text-lg font-semibold mb-4 text-foreground">
                            {results.quiz.quiz[quizState.currentQuestion].question}
                          </h4>
                          <div className="space-y-3">
                            {results.quiz.quiz[quizState.currentQuestion].options.map((option, optIndex) => (
                              <button
                                key={optIndex}
                                onClick={() => handleAnswerSelect(option)}
                                className={`w-full p-4 rounded-lg border transition-all duration-200 text-left ${
                                  quizState.userAnswers[quizState.currentQuestion] === option
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                                }`}
                              >
                                <span className="font-medium mr-3">
                                  {String.fromCharCode(65 + optIndex)}.
                                </span>
                                {option}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex justify-between">
                          <Button
                            variant="outline"
                            onClick={handlePreviousQuestion}
                            disabled={quizState.currentQuestion === 0}
                          >
                            Previous
                          </Button>

                          {quizState.currentQuestion === results.quiz.quiz.length - 1 ? (
                            <Button
                              variant="hero"
                              onClick={handleFinishQuiz}
                              disabled={quizState.userAnswers[quizState.currentQuestion] === null}
                            >
                              Finish Quiz
                            </Button>
                          ) : (
                            <Button
                              variant="hero"
                              onClick={handleNextQuestion}
                              disabled={quizState.userAnswers[quizState.currentQuestion] === null}
                            >
                              Next Question
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  ) : (
                    // Results Interface
                    <Card className="p-8 bg-gradient-card shadow-card border-0">
                      <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                          <h3 className="text-2xl font-bold text-foreground">Quiz Results</h3>
                          <div className="text-2xl font-bold text-primary">
                            {quizState.score}/{results.quiz.quiz.length}
                          </div>
                          <div className="text-muted-foreground">
                            {Math.round((quizState.score / results.quiz.quiz.length) * 100)}% Score
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          onClick={handleRestartQuiz}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Retake Quiz
                        </Button>
                      </div>

                      <div className="space-y-6">
                        {(() => {
                          const question = results.quiz.quiz[quizResultState.currentQuestion];
                          const userAnswer = quizState.userAnswers[quizResultState.currentQuestion];
                          const correctAnswerText = getCorrectAnswerText(question);
                          const isCorrect = isAnswerCorrect(question, userAnswer);

                          return (
                            <Card className="p-6 bg-background/50 border border-border/50">
                              <div className="flex items-start gap-4">
                                <Badge
                                  variant={isCorrect ? "default" : "destructive"}
                                  className="mt-1"
                                >
                                  {isCorrect ? (
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                  ) : (
                                    <XCircle className="h-3 w-3 mr-1" />
                                  )}
                                  Q{quizResultState.currentQuestion + 1}
                                </Badge>
                                <div className="flex-1">
                                  <h4 className="text-lg font-semibold mb-4 text-foreground">
                                    {question.question}
                                  </h4>
                                  <div className="space-y-2 mb-4">
                                    {question.options.map((option, optIndex) => (
                                      <div
                                        key={optIndex}
                                        className={`p-3 rounded-lg border transition-colors ${
                                          option === correctAnswerText
                                            ? "border-green-500 bg-green-50 text-green-700"
                                            : option === userAnswer && !isCorrect
                                            ? "border-red-500 bg-red-50 text-red-700"
                                            : "border-border bg-muted/30"
                                        }`}
                                      >
                                        <span className="text-sm font-medium mr-3">
                                          {String.fromCharCode(65 + optIndex)}.
                                        </span>
                                        {option}
                                        {option === correctAnswerText && (
                                          <CheckCircle className="h-4 w-4 ml-2 inline text-green-600" />
                                        )}
                                        {option === userAnswer && !isCorrect && (
                                          <XCircle className="h-4 w-4 ml-2 inline text-red-600" />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <div className="p-3 bg-muted/50 rounded-lg">
                                    <p className="text-sm font-medium text-blue-600 mb-1">Explanation:</p>
                                    <p className="text-sm text-muted-foreground">{question.explanation}</p>
                                  </div>
                                </div>
                              </div>
                            </Card>
                          );
                        })()}
                      </div>

                      <div className="flex justify-between mt-6">
                        <Button
                          variant="outline"
                          onClick={handlePreviousResult}
                          disabled={quizResultState.currentQuestion === 0}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="hero"
                          onClick={handleNextResult}
                          disabled={quizResultState.currentQuestion === results.quiz.quiz.length - 1}
                        >
                          Next
                        </Button>
                      </div>
                    </Card>
                  )}
                </div>
              ) : (
                <Card className="p-8 bg-gradient-card shadow-card border-0">
                  <div className="text-center text-muted-foreground">
                    <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No quiz available. Process some content to generate quiz questions.</p>
                  </div>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="flashcards">
              {results.flashcards ? (
                <div className="space-y-6">
                  <Card className="p-8 bg-gradient-card shadow-card border-0">
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-2xl font-bold text-foreground">Flashcards</h3>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-muted-foreground">
                            Card {flashcardState.currentCard + 1} of {results.flashcards.flashcards.length}
                          </span>
                          <div className="flex gap-1">
                            {results.flashcards.flashcards.map((_, index) => (
                              <div
                                key={index}
                                className={`w-2 h-2 rounded-full ${
                                  index === flashcardState.currentCard
                                    ? 'bg-primary'
                                    : 'bg-muted'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="text-center">
                        <div className="mb-6">
                          <div className="flex justify-center gap-2 mb-4">
                            <Badge variant="outline">
                              Card {flashcardState.currentCard + 1}
                            </Badge>
                            <Badge variant="secondary">
                              {results.flashcards.flashcards[flashcardState.currentCard].category}
                            </Badge>
                            <Badge variant="outline">
                              {results.flashcards.flashcards[flashcardState.currentCard].difficulty}
                            </Badge>
                          </div>
                          <h4 className="text-xl font-semibold text-foreground mb-6">
                            {results.flashcards.flashcards[flashcardState.currentCard].front}
                          </h4>
                          <div className="border-t pt-6">
                            <p className="text-lg text-muted-foreground leading-relaxed">
                              {results.flashcards.flashcards[flashcardState.currentCard].back}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-between">
                        <Button
                          variant="outline"
                          onClick={handlePreviousFlashcard}
                          disabled={flashcardState.currentCard === 0}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="hero"
                          onClick={handleNextFlashcard}
                          disabled={flashcardState.currentCard === results.flashcards.flashcards.length - 1}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </Card>
                </div>
              ) : (
                <Card className="p-8 bg-gradient-card shadow-card border-0">
                  <div className="text-center text-muted-foreground">
                    <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No flashcards available. Process some content to generate flashcards.</p>
                  </div>
                </Card>
              )}
            </TabsContent>

            
<TabsContent value="mindmap">
  {results.mindmap ? (
    <div className="space-y-4">
      {/* Header with title - NOT affected by zoom */}
      <div className="flex flex-col space-y-2">
        <h3 className="text-xl font-bold text-foreground">Mindmap</h3>
        <p className="text-muted-foreground">
          Visual representation of key concepts and their relationships
        </p>
      </div>

      {/* Zoom controls - NOT affected by zoom */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          {onRegenerate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRegenerate}
              disabled={isRegenerating}
              className="flex items-center gap-2 mr-4"
            >
              {isRegenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Regenerate
            </Button>
          )}
        </div>
        <div className="flex items-center border rounded-md overflow-hidden">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleZoomOut}
            title="Zoom Out"
            disabled={mindmapState.zoomLevel <= 0.5}
            className="h-8 px-2 rounded-none"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleResetZoom}
            title="Reset Zoom"
            className="h-8 px-2 rounded-none border-l border-r border-border/30"
          >
            <span className="text-xs font-mono">{Math.round(mindmapState.zoomLevel * 100)}%</span>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleZoomIn}
            title="Zoom In"
            disabled={mindmapState.zoomLevel >= 2.0}
            className="h-8 px-2 rounded-none"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Container with fixed height and scroll - contains the zoomable mindmap */}
      <div 
        ref={mindmapContainerRef}
        className="mindmap-container border border-border/50 rounded-lg bg-background/50"
        style={{
          height: '500px',
          overflow: 'auto',
          position: 'relative',
        }}
        
      >
        {/* MindmapViewer component with zoomLevel prop */}
        <MindmapViewer 
          mindmap={results.mindmap} 
          zoomLevel={mindmapState.zoomLevel} 
        />
      </div>
    </div>
  ) : (
    <Card className="p-8 bg-gradient-card shadow-card border-0">
      <div className="text-center text-muted-foreground">
        <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No mindmap available. Process some content to generate a mindmap.</p>
      </div>
    </Card>
  )}
</TabsContent>

          </Tabs>

          <div className="flex justify-center gap-4 mt-8">
            <Button variant="hero" size="lg">
              <Share2 className="h-5 w-5" />
              Share Results
            </Button>
            <Button variant="outline" size="lg">
              <Download className="h-5 w-5" />
              Export All
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
  
};

export default ResultsSection;
