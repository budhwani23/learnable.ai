// useExplainerVideo.ts
// Starts an AI explainer-video job, polls its progress, and loads the finished video.

import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api';
import type { ExplainerJob } from '@/lib/types';

const POLL_INTERVAL_MS = 4000;
const STORAGE_KEY = 'explainer_active_job';

export interface StartExplainerInput {
  audioFile?: File;
  videoFile?: File;
  documentFile?: File;
  text?: string;
  focus?: string;
}

const readStoredJobId = (): string | null => {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
};
const storeJobId = (id: string | null) => {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable — polling just won't survive a reload */ }
};

export const useExplainerVideo = () => {
  const [job, setJob] = useState<ExplainerJob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);

  const isActive = !!job && (job.status === 'queued' || job.status === 'running');

  const setBlobUrl = (url: string | null) => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = url;
    setVideoUrl(url);
  };

  // Resume a job that was in flight before a page reload.
  useEffect(() => {
    const id = readStoredJobId();
    if (!id) return;
    apiClient.getExplainerJob(id).then(setJob).catch(() => storeJobId(null));
  }, []);

  // Poll while the job is queued/running.
  useEffect(() => {
    if (!job || !isActive) return;
    const timer = window.setTimeout(async () => {
      try {
        setJob(await apiClient.getExplainerJob(job.id));
      } catch (e) {
        // transient network error: keep the job and try again on the next tick
        setJob(prev => (prev ? { ...prev } : prev));
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [job, isActive]);

  // Load the video once the job succeeds.
  useEffect(() => {
    if (!job || job.status !== 'succeeded' || !job.has_video || videoUrlRef.current) return;
    let cancelled = false;
    apiClient.fetchExplainerVideo(job.id)
      .then(blob => { if (!cancelled) setBlobUrl(URL.createObjectURL(blob)); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load video'); });
    return () => { cancelled = true; };
  }, [job]);

  useEffect(() => () => { if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current); }, []);

  const start = useCallback(async (input: StartExplainerInput) => {
    setError(null);
    setBlobUrl(null);
    setIsStarting(true);
    setUploadProgress(0);
    try {
      const newJob = await apiClient.startExplainerVideo(
        input.audioFile, input.videoFile, input.documentFile, input.text, input.focus,
        setUploadProgress
      );
      setJob(newJob);
      storeJobId(newJob.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start video generation');
    } finally {
      setIsStarting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setJob(null);
    setError(null);
    setBlobUrl(null);
    storeJobId(null);
  }, []);

  return { job, videoUrl, isStarting, isActive, uploadProgress, error, start, reset };
};

export type ExplainerVideoState = ReturnType<typeof useExplainerVideo>;
