// types.ts
// API Request/Response Types

// Base API Response
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// File Upload Types
export interface UploadedFile {
  file: File;
  id: string;
  name: string;
  size: number;
  type: string;
  extension: string;
  preview?: string;
  uploadProgress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

// Text Input Types
export interface TextInput {
  text: string;
}

// Summarization Types
export interface SummarizeTextInput {
  text: string;
}

export interface SummarizeTextOutput {
  success: boolean;
  original_text: string;
  summary: string;
  word_count_original: number;
  word_count_summary: number;
  content_type?: string;
}

// Mindmap Types
export interface MindmapNode {
  name: string;
  children?: MindmapNode[];
}

export interface MindmapInput {
  topic: string;
}

export interface MindmapMultimediaInput {
  topic?: string;
}

export interface MindmapOutput {
  success: boolean;
  topic: string;
  mindmap: MindmapNode;
  content_type?: string;
}

// MCQ Quiz Types
export interface MCQQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

export interface MCQQuizInput {
  content: string;
  num_questions: number;
}

export interface MCQQuizMultimediaInput {
  content?: string;
  num_questions: number;
}

export interface MCQQuizOutput {
  success: boolean;
  content: string;
  num_questions: number;
  quiz: MCQQuestion[];
  content_type?: string;
}

// Flashcard Types
export interface Flashcard {
  front: string;
  back: string;
  category: string;
  difficulty: string;
}

export interface FlashcardInput {
  content: string;
}

export interface FlashcardMultimediaInput {
  content?: string;
}

export interface FlashcardOutput {
  success: boolean;
  content: string;
  flashcards: Flashcard[];
  total_cards: number;
  content_type?: string;
}

// Explainer Video Types
export type ExplainerJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ExplainerTranscriptBeat {
  id: number;
  narration: string;
}

export interface ExplainerJob {
  id: string;
  status: ExplainerJobStatus;
  stage: string;
  progress: number;
  message: string;
  error?: string | null;
  title?: string | null;
  transcript: ExplainerTranscriptBeat[];
  source_type: string;
  source_label: string;
  focus?: string | null;
  created_at: number;
  updated_at: number;
  has_video: boolean;
}

export interface ExplainerJobResponse {
  success: boolean;
  job: ExplainerJob;
}

// Presentation (slide deck) Types
export interface PresentationJob {
  id: string;
  status: ExplainerJobStatus;
  stage: string;
  progress: number;
  message: string;
  error?: string | null;
  title?: string | null;
  source_type: string;
  source_label: string;
  focus?: string | null;
  n_slides: number;
  template: string;
  tone: string;
  slide_count: number;
  has_pptx: boolean;
  has_pdf: boolean;
  created_at: number;
  updated_at: number;
}

export interface PresentationJobResponse {
  success: boolean;
  job: PresentationJob;
}

export interface PresentationOption {
  id: string;
  name: string;
}

export interface PresentationOptions {
  success: boolean;
  templates: PresentationOption[];
  tones: PresentationOption[];
}

// Processing State Types
export type ProcessingState = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

export interface ProcessingStatus {
  state: ProcessingState;
  progress: number;
  message: string;
  error?: string;
}

// Results Types
export interface ProcessingResults {
  summary?: SummarizeTextOutput;
  mindmap?: MindmapOutput;
  quiz?: MCQQuizOutput;
  flashcards?: FlashcardOutput;
  content_type?: string;
  original_file?: UploadedFile;
}

// App State Types
export interface AppState {
  currentFile: UploadedFile | null;
  processingStatus: ProcessingStatus;
  results: ProcessingResults | null;
  hasApiKey: boolean;
}

// API Error Types
export interface ApiError {
  message: string;
  status?: number;
  code?: string;
}

// File Validation Types
export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

// Component Props Types
export interface FileUploadProps {
  onFileSelect?: (file: File) => void;
  onFileDrop?: (files: FileList) => void;
  acceptedTypes?: string[];
  maxSize?: number;
  multiple?: boolean;
  disabled?: boolean;
}

export interface ProcessingIndicatorProps {
  status: ProcessingStatus;
  onCancel?: () => void;
}

export interface ResultCardProps {
  title: string;
  content: any;
  type: 'summary' | 'mindmap' | 'quiz' | 'flashcards';
  onCopy?: () => void;
  onDownload?: () => void;
} 