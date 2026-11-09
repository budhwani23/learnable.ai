// api.ts
// API client for backend communication

import { API_CONFIG, API_ENDPOINTS, ERROR_MESSAGES } from './constants';
import type {
  Role,
  ApiResponse,
  SummarizeTextInput,
  SummarizeTextOutput,
  MindmapInput,
  MindmapMultimediaInput,
  MindmapOutput,
  MCQQuizInput,
  MCQQuizMultimediaInput,
  MCQQuizOutput,
  FlashcardInput,
  FlashcardMultimediaInput,
  FlashcardOutput,
  ExplainerJob,
  ExplainerJobResponse,
  PresentationJob,
  PresentationJobResponse,
  PresentationOptions,
  ApiError
} from './types';

class ApiClient {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    this.baseUrl = API_CONFIG.BASE_URL;
    this.timeout = API_CONFIG.TIMEOUT;
  }

  // =====================
  // Auth token management
  // =====================
  private ACCESS_KEY = 'auth_access';
  private REFRESH_KEY = 'auth_refresh';

  private getAccess() { return localStorage.getItem(this.ACCESS_KEY) || ''; }
  private getRefresh() { return localStorage.getItem(this.REFRESH_KEY) || ''; }
  private setTokens(access: string, refresh: string) {
    localStorage.setItem(this.ACCESS_KEY, access);
    localStorage.setItem(this.REFRESH_KEY, refresh);
  }
  private clearTokens() {
    localStorage.removeItem(this.ACCESS_KEY);
    localStorage.removeItem(this.REFRESH_KEY);
  }
  private buildAuthHeaders(): HeadersInit {
    const access = this.getAccess();
    return access ? { Authorization: `Bearer ${access}` } : {};
  }

  private async refreshTokensOnce(): Promise<boolean> {
    const refresh = this.getRefresh();
    if (!refresh) return false;
    try {
      const res = await fetch(`${this.baseUrl}${API_ENDPOINTS.AUTH_REFRESH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.access && data?.refresh) {
        this.setTokens(data.access, data.refresh);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    auth: boolean = false
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const defaultOptions: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? this.buildAuthHeaders() : {}),
        ...options.headers,
      },
    };

    const finalOptions = { ...defaultOptions, ...options };

    const doFetch = async (): Promise<T> => {
      const response = await fetch(url, finalOptions);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const data = await response.json();
      if ((data as any).error) {
        throw new Error((data as any).error);
      }
      return data as T;
    };

    try {
      return await doFetch();
    } catch (error: any) {
      // If unauthorized on an auth-required call, try refresh once
      if (auth && error instanceof Error && error.message === '401') {
        const refreshed = await this.refreshTokensOnce();
        if (refreshed) {
          const retryOptions: RequestInit = {
            ...finalOptions,
            headers: {
              ...finalOptions.headers as HeadersInit,
              ...this.buildAuthHeaders(),
            },
          };
          const retryRes = await fetch(url, retryOptions);
          if (!retryRes.ok) throw new Error(String(retryRes.status));
          return await retryRes.json();
        }
        this.clearTokens();
      }
      console.error('API request failed:', error);
      throw this.handleError(error);
    }
  }

  private async makeFileRequest<T>(
    endpoint: string,
    formData: FormData,
    onProgress?: (progress: number) => void,
    auth: boolean = false
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    console.log('makeFileRequest called with URL:', url);
    
    try {
      const xhr = new XMLHttpRequest();
      
      return new Promise((resolve, reject) => {
        // Set longer timeout for file uploads (5 minutes)
        xhr.timeout = 300000; // 5 minutes
        
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && onProgress) {
            const progress = (event.loaded / event.total) * 100;
            onProgress(progress);
          }
        });

        xhr.addEventListener('load', () => {
          console.log('XHR load event - status:', xhr.status);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              console.log('XHR response data:', data);
              if (data.error) {
                reject(new Error(data.error));
              } else {
                resolve(data);
              }
            } catch (error) {
              console.error('XHR JSON parse error:', error);
              reject(new Error('Invalid JSON response'));
            }
          } else {
            console.error('XHR HTTP error - status:', xhr.status, 'response:', xhr.responseText);
            reject(new Error(`HTTP error! status: ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          console.error('XHR error occurred');
          reject(new Error('Network error occurred'));
        });

        xhr.addEventListener('timeout', () => {
          console.error('XHR timeout occurred');
          reject(new Error('Request timed out. Please try with a smaller file or check your connection.'));
        });

        xhr.addEventListener('abort', () => {
          console.error('XHR request was aborted');
          reject(new Error('Request was aborted'));
        });

        xhr.open('POST', url, true);

        // Attach Authorization header when required
        if (auth) {
          const access = this.getAccess();
          if (access) {
            xhr.setRequestHeader('Authorization', `Bearer ${access}`);
          }
        }
        
        // Don't set Content-Type header for FormData - let the browser set it with boundary
        console.log('Sending XHR request to:', url);
        xhr.send(formData);
      });
    } catch (error) {
      console.error('File upload failed:', error);
      throw this.handleError(error);
    }
  }

  private handleError(error: any): Error {
    if (error instanceof Error) {
      return error;
    }
    
    if (typeof error === 'string') {
      return new Error(error);
    }
    
    return new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  // Public auth helpers
  /** POST an auth form and surface the server's `detail` message on failure. */
  private async authPost(endpoint: string, body: object, fallback: string) {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : null;
      throw new Error(detail || (res.status === 422 ? 'Please check the details you entered.' : fallback));
    }
    this.setTokens(data.access, data.refresh);
    return data as { access: string; refresh: string };
  }

  async login(username: string, password: string, role?: Role) {
    return this.authPost(API_ENDPOINTS.AUTH_LOGIN, { username, password, role }, 'Invalid credentials');
  }

  async register(username: string, email: string, password: string, role: Role) {
    return this.authPost(API_ENDPOINTS.AUTH_REGISTER, { username, email, password, role }, 'Registration failed');
  }

  async me() {
    return this.makeRequest<{ id: number; username: string; email: string; credits: number; role: Role }>(
      API_ENDPOINTS.AUTH_ME,
      { method: 'GET' },
      true
    );
  }

  // NEW: Generic authorized request helper using access token in localStorage
  async authorizedRequest<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    route: string,
    payload?: any
  ): Promise<T> {
    const options: RequestInit = { method };
    if (payload !== undefined && method !== 'GET') {
      options.body = JSON.stringify(payload);
    }
    return this.makeRequest<T>(route, options, true);
  }

  // =====================
  // Health check
  // =====================
  async healthCheck(): Promise<ApiResponse> {
    return this.makeRequest<ApiResponse>(API_ENDPOINTS.HEALTH_CHECK);
  }

  // =====================
  // Text summarization (AUTH)
  // =====================
  async summarizeText(input: SummarizeTextInput): Promise<SummarizeTextOutput> {
    return this.makeRequest<SummarizeTextOutput>(
      API_ENDPOINTS.SUMMARIZE_CONTENT,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      true
    );
  }

  // File-based summarization (AUTH)
  async summarizeFile(
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<SummarizeTextOutput> {
    const formData = new FormData();
    formData.append('file', file);
    
    return this.makeFileRequest<SummarizeTextOutput>(
      API_ENDPOINTS.SUMMARIZE_CONTENT,
      formData,
      onProgress,
      true
    );
  }

  // Multimedia summarization (AUTH)
  async summarizeMultimedia(
    audioFile?: File,
    videoFile?: File,
    documentFile?: File,
    text?: string,
    onProgress?: (progress: number) => void
  ): Promise<SummarizeTextOutput> {
    const formData = new FormData();
    
    if (text && text.trim()) {
      formData.append('data', JSON.stringify({ text }));
    }
    if (audioFile) {
      formData.append('audio_file', audioFile);
    }
    if (videoFile) {
      formData.append('video_file', videoFile);
    }
    if (documentFile) {
      formData.append('document_file', documentFile);
    }
    
    return this.makeFileRequest<SummarizeTextOutput>(
      API_ENDPOINTS.SUMMARIZE_CONTENT,
      formData,
      onProgress,
      true
    );
  }

  // Mindmap generation (text only) (AUTH)
  async generateMindmap(input: MindmapInput): Promise<MindmapOutput> {
    return this.makeRequest<MindmapOutput>(
      API_ENDPOINTS.GENERATE_MINDMAP,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      true
    );
  }

  // Mindmap generation (multimedia) (AUTH)
  async generateMindmapMultimedia(
    audioFile?: File,
    videoFile?: File,
    documentFile?: File,
    topic?: string,
    onProgress?: (progress: number) => void
  ): Promise<MindmapOutput> {
    const formData = new FormData();
    
    if (topic && topic.trim()) {
      formData.append('data', JSON.stringify({ topic }));
    } else if (audioFile || videoFile || documentFile) {
      // Send empty data object when files are present but no topic
      formData.append('data', JSON.stringify({}));
    }
    if (audioFile) {
      formData.append('audio_file', audioFile);
    }
    if (videoFile) {
      formData.append('video_file', videoFile);
    }
    if (documentFile) {
      formData.append('document_file', documentFile);
    }
    
    return this.makeFileRequest<MindmapOutput>(
      API_ENDPOINTS.GENERATE_MINDMAP_MULTIMEDIA,
      formData,
      onProgress,
      true
    );
  }

  // MCQ Quiz generation (text only) (AUTH)
  async generateMCQQuiz(input: MCQQuizInput): Promise<MCQQuizOutput> {
    console.log('API Client - generateMCQQuiz input:', input);
    console.log('API Client - JSON body:', JSON.stringify(input));
    return this.makeRequest<MCQQuizOutput>(
      API_ENDPOINTS.GENERATE_MCQ_QUIZ,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      true
    );
  }

  // MCQ Quiz generation (multimedia) (AUTH)
  async generateMCQQuizMultimedia(
    audioFile?: File,
    videoFile?: File,
    documentFile?: File,
    content?: string,
    numQuestions: number = 10,
    onProgress?: (progress: number) => void
  ): Promise<MCQQuizOutput> {
    const formData = new FormData();
    
    if (content && content.trim()) {
      formData.append('data', JSON.stringify({ content, num_questions: numQuestions }));
    } else {
      formData.append('data', JSON.stringify({ num_questions: numQuestions }));
    }
    if (audioFile) {
      formData.append('audio_file', audioFile);
    }
    if (videoFile) {
      formData.append('video_file', videoFile);
    }
    if (documentFile) {
      formData.append('document_file', documentFile);
    }
    
    return this.makeFileRequest<MCQQuizOutput>(
      API_ENDPOINTS.GENERATE_MCQ_QUIZ_MULTIMEDIA,
      formData,
      onProgress,
      true
    );
  }

  // Flashcard generation (text only) (AUTH)
  async generateFlashcards(input: FlashcardInput): Promise<FlashcardOutput> {
    return this.makeRequest<FlashcardOutput>(
      API_ENDPOINTS.GENERATE_FLASHCARDS,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      true
    );
  }

  // Flashcard generation (multimedia) (AUTH)
  async generateFlashcardsMultimedia(
    audioFile?: File,
    videoFile?: File,
    documentFile?: File,
    content?: string,
    onProgress?: (progress: number) => void
  ): Promise<FlashcardOutput> {
    console.log('generateFlashcardsMultimedia called with:', { audioFile, videoFile, documentFile, content });
    const formData = new FormData();
    
    if (content && content.trim()) {
      formData.append('data', JSON.stringify({ content }));
    } else if (audioFile || videoFile || documentFile) {
      // Send empty data object when files are present but no content
      formData.append('data', JSON.stringify({}));
    }
    if (audioFile) {
      formData.append('audio_file', audioFile);
    }
    if (videoFile) {
      formData.append('video_file', videoFile);
    }
    if (documentFile) {
      formData.append('document_file', documentFile);
    }
    
    console.log('FormData contents:');
    for (let [key, value] of formData.entries()) {
      console.log(key, value);
    }
    
    return this.makeFileRequest<FlashcardOutput>(
      API_ENDPOINTS.GENERATE_FLASHCARDS_MULTIMEDIA,
      formData,
      onProgress,
      true
    );
  }

  // =====================
  // AI explainer video (AUTH) — long-running background job
  // =====================
  async startExplainerVideo(
    audioFile?: File,
    videoFile?: File,
    documentFile?: File,
    text?: string,
    focus?: string,
    onProgress?: (progress: number) => void
  ): Promise<ExplainerJob> {
    const formData = new FormData();
    formData.append('data', JSON.stringify({
      ...(text && text.trim() ? { text } : {}),
      ...(focus && focus.trim() ? { focus } : {}),
    }));
    if (audioFile) formData.append('audio_file', audioFile);
    if (videoFile) formData.append('video_file', videoFile);
    if (documentFile) formData.append('document_file', documentFile);

    const res = await this.makeFileRequest<ExplainerJobResponse>(
      API_ENDPOINTS.EXPLAINER_JOBS,
      formData,
      onProgress,
      true
    );
    return res.job;
  }

  async getExplainerJob(jobId: string): Promise<ExplainerJob> {
    const res = await this.makeRequest<ExplainerJobResponse>(
      `${API_ENDPOINTS.EXPLAINER_JOBS}/${encodeURIComponent(jobId)}`,
      { method: 'GET' },
      true
    );
    return res.job;
  }

  // Authenticated binary download (a <video>/<iframe> can't send the Authorization header).
  private async fetchAuthorizedBlob(path: string, what: string): Promise<Blob> {
    const url = `${this.baseUrl}${path}`;
    let res = await fetch(url, { headers: this.buildAuthHeaders() });
    if (res.status === 401 && (await this.refreshTokensOnce())) {
      res = await fetch(url, { headers: this.buildAuthHeaders() });
    }
    if (!res.ok) throw new Error(`Could not load the ${what} (status ${res.status})`);
    return res.blob();
  }

  async fetchExplainerVideo(jobId: string): Promise<Blob> {
    return this.fetchAuthorizedBlob(
      `${API_ENDPOINTS.EXPLAINER_JOBS}/${encodeURIComponent(jobId)}/video`, 'video'
    );
  }

  // =====================
  // Presentations / slide decks (AUTH) — background job via self-hosted Presenton
  // =====================
  async getPresentationOptions(): Promise<PresentationOptions> {
    return this.makeRequest<PresentationOptions>(API_ENDPOINTS.PRESENTATION_OPTIONS, { method: 'GET' }, true);
  }

  async startPresentation(
    params: {
      audioFile?: File;
      videoFile?: File;
      documentFile?: File;
      text?: string;
      focus?: string;
      nSlides: number;
      template: string;
      tone: string;
    },
    onProgress?: (progress: number) => void
  ): Promise<PresentationJob> {
    const { audioFile, videoFile, documentFile, text, focus, nSlides, template, tone } = params;
    const formData = new FormData();
    formData.append('data', JSON.stringify({
      ...(text && text.trim() ? { text } : {}),
      ...(focus && focus.trim() ? { focus } : {}),
      n_slides: nSlides,
      template,
      tone,
    }));
    if (audioFile) formData.append('audio_file', audioFile);
    if (videoFile) formData.append('video_file', videoFile);
    if (documentFile) formData.append('document_file', documentFile);

    const res = await this.makeFileRequest<PresentationJobResponse>(
      API_ENDPOINTS.PRESENTATION_JOBS, formData, onProgress, true
    );
    return res.job;
  }

  async getPresentationJob(jobId: string): Promise<PresentationJob> {
    const res = await this.makeRequest<PresentationJobResponse>(
      `${API_ENDPOINTS.PRESENTATION_JOBS}/${encodeURIComponent(jobId)}`, { method: 'GET' }, true
    );
    return res.job;
  }

  async fetchPresentationFile(jobId: string, format: 'pptx' | 'pdf'): Promise<Blob> {
    return this.fetchAuthorizedBlob(
      `${API_ENDPOINTS.PRESENTATION_JOBS}/${encodeURIComponent(jobId)}/file?format=${format}`,
      format === 'pdf' ? 'PDF preview' : 'presentation'
    );
  }

  // Process all types (summary, mindmap, quiz, flashcards) from multimedia
  async processMultimedia(
    audioFile?: File,
    videoFile?: File,
    documentFile?: File,
    text?: string,
    onProgress?: (progress: number) => void
  ): Promise<{
    summary: SummarizeTextOutput;
    mindmap: MindmapOutput;
    quiz: MCQQuizOutput;
    flashcards: FlashcardOutput;
  }> {
    const results = await Promise.all([
      this.summarizeMultimedia(audioFile, videoFile, documentFile, text, onProgress),
      this.generateMindmapMultimedia(audioFile, videoFile, documentFile, text, onProgress),
      this.generateMCQQuizMultimedia(audioFile, videoFile, documentFile, text, 10, onProgress),
      this.generateFlashcardsMultimedia(audioFile, videoFile, documentFile, text, onProgress),
    ]);

    return {
      summary: results[0],
      mindmap: results[1],
      quiz: results[2],
      flashcards: results[3],
    };
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default apiClient; 