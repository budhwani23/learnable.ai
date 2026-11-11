// useExplainerVideo.ts
// Starts an AI explainer-video job, polls its progress, and loads the finished video.

import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api';
import type { ExplainerJob } from '@/lib/types';
import { useJobPolling } from './useJobPolling';

export interface StartExplainerInput {
  audioFile?: File;
  videoFile?: File;
  documentFile?: File;
  text?: string;
  focus?: string;
}

const startJob = (input: StartExplainerInput, onProgress: (p: number) => void) =>
  apiClient.startExplainerVideo(
    input.audioFile, input.videoFile, input.documentFile, input.text, input.focus, onProgress
  );
const getJob = (id: string) => apiClient.getExplainerJob(id);

export const useExplainerVideo = () => {
  const polling = useJobPolling<ExplainerJob, StartExplainerInput>({
    storageKey: 'explainer_active_job',
    getJob,
    startJob,
  });
  const { job, setError } = polling;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);

  const setBlobUrl = (url: string | null) => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = url;
    setVideoUrl(url);
  };

  // Load the video once the job succeeds.
  useEffect(() => {
    if (!job || job.status !== 'succeeded' || !job.has_video || videoUrlRef.current) return;
    let cancelled = false;
    apiClient.fetchExplainerVideo(job.id)
      .then(blob => { if (!cancelled) setBlobUrl(URL.createObjectURL(blob)); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load video'); });
    return () => { cancelled = true; };
  }, [job, setError]);

  useEffect(() => () => { if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current); }, []);

  const start = useCallback(async (input: StartExplainerInput) => {
    setBlobUrl(null);
    await polling.start(input);
  }, [polling]);

  const reset = useCallback(() => {
    setBlobUrl(null);
    polling.reset();
  }, [polling]);

  return { ...polling, videoUrl, start, reset };
};

export type ExplainerVideoState = ReturnType<typeof useExplainerVideo>;
