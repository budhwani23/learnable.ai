// library.ts
// Saved learning resources, sharing to classes (LTI / Google Classroom) and LMS launches.

import apiClient from './api';
import { API_CONFIG } from './constants';
import type { ProcessingResults } from './types';

export type ResourceType = 'summary' | 'mindmap' | 'quiz' | 'flashcards' | 'video';

export interface LearningResourceSummary {
  id: string;
  type: ResourceType;
  title: string;
  created_at: string;
  share_enabled: boolean;
  is_owner: boolean;
  max_score: number;
}

export interface LearningResource extends LearningResourceSummary {
  /** Saved API output for the type; quizzes viewed by students carry questions without answers. */
  payload: Record<string, unknown> & { quiz?: { question: string; options: string[] }[] };
}

export interface LtiLaunchInfo {
  id: string;
  mode: 'pick' | 'view';
  resource_id: string | null;
  is_instructor: boolean;
  context_title: string;
}

export interface QuizAttemptResult {
  score: number;
  max_score: number;
  grade_synced: boolean;
  grade_sync_error: string | null;
  answer_key: { correct_answer: string; explanation: string }[];
}

const LAUNCH_KEY = 'lti_launch';
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const req = <T,>(method: Method, route: string, payload?: unknown) =>
  apiClient.authorizedRequest<T>(method, route, payload);

export const library = {
  save: (type: ResourceType, title: string, payload: unknown, explainerJobId?: string) =>
    req<{ resource: LearningResourceSummary }>('POST', '/library/resources', {
      type, title, payload, explainer_job_id: explainerJobId,
    }).then(r => r.resource),

  list: (type?: ResourceType) =>
    req<{ resources: LearningResourceSummary[] }>(
      'GET', `/library/resources${type ? `?type=${type}` : ''}`
    ).then(r => r.resources),

  get: (id: string) =>
    req<{ resource: LearningResource }>('GET', `/library/resources/${encodeURIComponent(id)}`)
      .then(r => r.resource),

  setSharing: (id: string, shareEnabled: boolean) =>
    req<{ resource: LearningResourceSummary }>(
      'PATCH', `/library/resources/${encodeURIComponent(id)}/sharing`, { share_enabled: shareEnabled }
    ).then(r => r.resource),

  submitQuiz: (id: string, answers: (string | null)[], ltiLaunchId?: string) =>
    req<QuizAttemptResult>('POST', `/library/resources/${encodeURIComponent(id)}/attempts`, {
      answers, lti_launch_id: ltiLaunchId,
    }),

  async fetchVideo(id: string): Promise<Blob> {
    const url = `${API_CONFIG.BASE_URL}/library/resources/${encodeURIComponent(id)}/video`;
    const doFetch = () => fetch(url, {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_access') || ''}` },
    });
    let res = await doFetch();
    if (res.status === 401) {
      await apiClient.me().catch(() => undefined); // triggers the client's token refresh
      res = await doFetch();
    }
    if (!res.ok) throw new Error(`Could not load the video (status ${res.status})`);
    return res.blob();
  },
};

/** Public link to a saved resource (what gets shared to a class). */
export const resourceUrl = (id: string) => `${window.location.origin}/r/${id}`;

/** Google's free "Share to Classroom" flow for a link. */
export const classroomShareUrl = (id: string, title: string) =>
  `https://classroom.google.com/share?url=${encodeURIComponent(resourceUrl(id))}` +
  `&title=${encodeURIComponent(title)}`;

/** Convert a generated result into the saved payload for its type. */
export const payloadFor = (type: ResourceType, results: ProcessingResults | null | undefined) => {
  switch (type) {
    case 'summary': return results?.summary;
    case 'mindmap': return results?.mindmap;
    case 'quiz': return results?.quiz;
    case 'flashcards': return results?.flashcards;
    default: return undefined;
  }
};

export const defaultTitle = (type: ResourceType, results: ProcessingResults | null | undefined) => {
  const label = { summary: 'Summary', mindmap: 'Mindmap', quiz: 'Quiz', flashcards: 'Flashcards', video: 'Video' }[type];
  const topic = results?.mindmap?.topic || results?.summary?.original_text || '';
  const clean = topic.replace(/^(Document|Audio|Video) file:\s*/i, '').slice(0, 80);
  return clean ? `${label}: ${clean}` : label;
};

// ── LTI launch bridge ─────────────────────────────────────────────

export async function exchangeLtiCode(code: string): Promise<LtiLaunchInfo> {
  const res = await fetch(`${API_CONFIG.BASE_URL}/lti/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Launch failed (status ${res.status})`);
  localStorage.setItem('auth_access', data.access);
  localStorage.setItem('auth_refresh', data.refresh);
  try { sessionStorage.setItem(LAUNCH_KEY, JSON.stringify(data.launch)); } catch { /* optional */ }
  return data.launch as LtiLaunchInfo;
}

/** The LMS launch this tab was opened from, if any (scoped to the tab). */
export const currentLaunch = (): LtiLaunchInfo | null => {
  try {
    const raw = sessionStorage.getItem(LAUNCH_KEY);
    return raw ? (JSON.parse(raw) as LtiLaunchInfo) : null;
  } catch { return null; }
};

export async function submitDeepLink(launchId: string, resourceId: string): Promise<void> {
  const res = await req<{ return_url: string; jwt: string }>('POST', '/lti/deep-link', {
    launch_id: launchId, resource_id: resourceId,
  });
  // Post the signed response back to the LMS, which closes the picker and adds the activity.
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = res.return_url;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'JWT';
  input.value = res.jwt;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

/** Google Sign-In (shared links). Returns true once tokens are stored. */
export async function googleLogin(credential: string): Promise<void> {
  const res = await fetch(`${API_CONFIG.BASE_URL}/users/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Google sign-in failed');
  localStorage.setItem('auth_access', data.access);
  localStorage.setItem('auth_refresh', data.refresh);
}
