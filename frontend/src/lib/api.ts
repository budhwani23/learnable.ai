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
  Me,
  ApiError
} from './types';

const FIELD_MESSAGES: Record<string, string> = {
  username: 'Username must be 3 to 150 characters.',
  email: 'Enter a valid email address, like name@example.com.',
  password: 'Password must be at least 8 characters.',
  role: 'Choose student or teacher.',
};

/** Turn a 422 validation error list ([{loc: [..., "username"], msg}]) into plain sentences. */
function validationMessage(detail: unknown): string {
  if (!Array.isArray(detail)) return 'Please check the details you entered.';
  const fields = new Set<string>();
  for (const item of detail) {
    const loc = Array.isArray(item?.loc) ? item.loc : [];
    const field = String(loc[loc.length - 1] ?? '');
    if (field) fields.add(field);
  }
  const lines = [...fields].map((f) => FIELD_MESSAGES[f]).filter(Boolean);
  return lines.length ? lines.join(' ') : 'Please check the details you entered.';
}

/** An Error carrying the HTTP status, with the server's own reason as the message. */
export class HttpError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/**
 * Build an HttpError from a failed response, using the body's `error`/`detail` string when present
 * and a friendly per-status fallback (401, 403, 404, other) otherwise.
 */
async function httpError(res: Response): Promise<HttpError> {
  let reason = '';
  try {
    const body = await res.clone().json();
    if (typeof body?.error === 'string') reason = body.error;
    else if (typeof body?.detail === 'string') reason = body.detail;
  } catch { /* not JSON */ }
  const fallback = res.status === 401 ? 'Your session has expired. Please sign in again.'
    : res.status === 403 ? "You don't have permission to do that."
    : res.status === 404 ? "That couldn't be found. It may have been deleted or not shared with you."
    : `The server couldn't complete this request (error ${res.status}). Please try again.`;
  return new HttpError(reason || fallback, res.status);
}

/**
 * HTTP client for the backend: stores JWT access/refresh tokens in localStorage, attaches them to
 * authenticated calls, retries once after a token refresh on 401, and wraps every API endpoint.
 */
class ApiClient {
  private baseUrl: string;
  private timeout: number;

  /** Read the base URL and timeout from API_CONFIG. */
  constructor() {
    this.baseUrl = API_CONFIG.BASE_URL;
    this.timeout = API_CONFIG.TIMEOUT;
  }

  // =====================
  // Auth token management
  // =====================
  private ACCESS_KEY = 'auth_access';
  private REFRESH_KEY = 'auth_refresh';

  /** Stored access token, or "" when signed out. */
  private getAccess() { return localStorage.getItem(this.ACCESS_KEY) || ''; }
  /** Stored refresh token, or "" when signed out. */
  private getRefresh() { return localStorage.getItem(this.REFRESH_KEY) || ''; }
  /** Save a new access/refresh token pair to localStorage. */
  private setTokens(access: string, refresh: string) {
    localStorage.setItem(this.ACCESS_KEY, access);
    localStorage.setItem(this.REFRESH_KEY, refresh);
  }
  /** Remove both tokens from localStorage. */
  private clearTokens() {
    localStorage.removeItem(this.ACCESS_KEY);
    localStorage.removeItem(this.REFRESH_KEY);
  }
  /** `Authorization: Bearer <access>` header, or no headers when there is no access token. */
  private buildAuthHeaders(): HeadersInit {
    const access = this.getAccess();
    return access ? { Authorization: `Bearer ${access}` } : {};
  }

  /**
   * Exchange the refresh token for a new token pair and store it.
   * @returns true on success; false when there is no refresh token or the refresh fails.
   */
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

  /**
   * Send a JSON request and parse the JSON response, throwing HttpError on non-2xx or an Error when the
   * body has an `error` field. With `auth`, sends the bearer token and on 401 refreshes the tokens and
   * retries once, clearing the tokens if the refresh fails.
   */
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

    /** Perform the request once and return the parsed body; throws on HTTP errors or an `error` field. */
    const doFetch = async (): Promise<T> => {
      const response = await fetch(url, finalOptions);
      if (!response.ok) {
        throw await httpError(response);
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
      if (auth && (error as HttpError)?.status === 401) {
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
          if (!retryRes.ok) throw await httpError(retryRes);
          const retryData = await retryRes.json();
          if (retryData?.error) throw new Error(retryData.error);
          return retryData as T;
        }
        this.clearTokens();
      }
      console.error('API request failed:', error);
      throw this.handleError(error);
    }
  }

  /**
   * POST multipart form data via XMLHttpRequest (5-minute timeout) so upload progress can be reported
   * through `onProgress` (0-100). Rejects with the server's `error`/`detail` message, or a friendly
   * message on network errors, timeouts and aborts. Does not retry after a token refresh.
   */
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
            // Prefer the server's own reason ({error} or {detail}) over a bare status code.
            let reason = '';
            try {
              const body = JSON.parse(xhr.responseText);
              reason = typeof body?.error === 'string' ? body.error : typeof body?.detail === 'string' ? body.detail : '';
            } catch { /* not JSON */ }
            reject(new Error(reason || (xhr.status === 401
              ? 'Your session has expired. Please sign in again.'
              : `The server couldn't complete this request (error ${xhr.status}). Please try again.`)));
          }
        });

        xhr.addEventListener('error', () => {
          console.error('XHR error occurred');
          reject(new Error("Couldn't reach the server. Check your connection and try again."));
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

  /** Normalise any thrown value into an Error (strings become the message; anything else is a network error). */
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
      throw new Error(detail || (res.status === 422 ? validationMessage(data.detail) : fallback));
    }
    this.setTokens(data.access, data.refresh);
    return data as { access: string; refresh: string };
  }

  /** Sign in and store the returned tokens; optionally sends the role the user is signing in as. */
  async login(username: string, password: string, role?: Role) {
    return this.authPost(API_ENDPOINTS.AUTH_LOGIN, { username, password, role }, 'Invalid credentials');
  }

  /** Create an account with the given role and store the returned tokens. */
  async register(username: string, email: string, password: string, role: Role) {
    return this.authPost(API_ENDPOINTS.AUTH_REGISTER, { username, email, password, role }, 'Registration failed');
  }

  /** Fetch the signed-in user's profile (role, approval status and credits). */
  async me() {
    return this.makeRequest<Me>(
      API_ENDPOINTS.AUTH_ME,
      { method: 'GET' },
      true
    );
  }

  // NEW: Generic authorized request helper using access token in localStorage
  /** Authenticated JSON request to any API route; `payload` is sent as the body for non-GET methods. */
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
  /** Call the backend health-check endpoint (no auth). */
  async healthCheck(): Promise<ApiResponse> {
    return this.makeRequest<ApiResponse>(API_ENDPOINTS.HEALTH_CHECK);
  }

  // =====================
  // Text summarization (AUTH)
  // =====================
  /** Summarise text content (JSON body, authenticated). */
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
  /** Upload a single file for summarisation, reporting upload progress. */
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
  /** Summarise any combination of audio, video, document and text in one multipart upload. */
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
  /** Generate a mindmap from text input (JSON body, authenticated). */
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
  /** Generate a mindmap from uploaded audio/video/document files and/or a topic or text. */
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
  /** Generate a multiple-choice quiz from text input (JSON body, authenticated). */
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
  /** Generate a multiple-choice quiz of `numQuestions` (default 10) from uploaded files and/or text. */
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
  /** Generate flashcards from text input (JSON body, authenticated). */
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
  /** Generate flashcards from uploaded audio/video/document files and/or text. */
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
  /**
   * Start a background explainer-video job from the given files/text and optional focus.
   * @returns The created job (poll it with getExplainerJob).
   */
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

  /** Fetch the current status of an explainer-video job. */
  async getExplainerJob(jobId: string): Promise<ExplainerJob> {
    const res = await this.makeRequest<ExplainerJobResponse>(
      `${API_ENDPOINTS.EXPLAINER_JOBS}/${encodeURIComponent(jobId)}`,
      { method: 'GET' },
      true
    );
    return res.job;
  }

  // Authenticated binary download (a <video>/<iframe> can't send the Authorization header).
  /**
   * GET a binary file with the bearer token, retrying once after a token refresh on 401.
   * @param what Human-readable name used in the error message.
   */
  private async fetchAuthorizedBlob(path: string, what: string): Promise<Blob> {
    const url = `${this.baseUrl}${path}`;
    let res = await fetch(url, { headers: this.buildAuthHeaders() });
    if (res.status === 401 && (await this.refreshTokensOnce())) {
      res = await fetch(url, { headers: this.buildAuthHeaders() });
    }
    if (!res.ok) throw new Error(`Could not load the ${what} (status ${res.status})`);
    return res.blob();
  }

  /** Download a finished explainer video as a Blob. */
  async fetchExplainerVideo(jobId: string): Promise<Blob> {
    return this.fetchAuthorizedBlob(
      `${API_ENDPOINTS.EXPLAINER_JOBS}/${encodeURIComponent(jobId)}/video`, 'video'
    );
  }

  // =====================
  // Presentations / slide decks (AUTH) — background job via self-hosted Presenton
  // =====================
  /** Fetch the available slide templates and tones. */
  async getPresentationOptions(): Promise<PresentationOptions> {
    return this.makeRequest<PresentationOptions>(API_ENDPOINTS.PRESENTATION_OPTIONS, { method: 'GET' }, true);
  }

  /**
   * Start a background slide-deck job from the given files/text with slide count, template, tone and focus.
   * @returns The created job (poll it with getPresentationJob).
   */
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

  /** Fetch the current status of a slide-deck job. */
  async getPresentationJob(jobId: string): Promise<PresentationJob> {
    const res = await this.makeRequest<PresentationJobResponse>(
      `${API_ENDPOINTS.PRESENTATION_JOBS}/${encodeURIComponent(jobId)}`, { method: 'GET' }, true
    );
    return res.job;
  }

  /** Download a finished deck as PPTX or its PDF preview as a Blob. */
  async fetchPresentationFile(jobId: string, format: 'pptx' | 'pdf'): Promise<Blob> {
    return this.fetchAuthorizedBlob(
      `${API_ENDPOINTS.PRESENTATION_JOBS}/${encodeURIComponent(jobId)}/file?format=${format}`,
      format === 'pdf' ? 'PDF preview' : 'presentation'
    );
  }

  // Process all types (summary, mindmap, quiz, flashcards) from multimedia
  /** Generate summary, mindmap, quiz (10 questions) and flashcards in parallel from the same input. */
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