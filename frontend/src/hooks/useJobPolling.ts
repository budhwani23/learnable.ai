// useJobPolling.ts
// Generic state for a long-running backend job: start it, persist its id so a
// reload resumes tracking, and poll its status until it finishes.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface PollableJob {
  id: string;
  status: JobStatus;
}

interface Options<J extends PollableJob, I> {
  storageKey: string;
  getJob: (id: string) => Promise<J>;
  startJob: (input: I, onUploadProgress: (p: number) => void) => Promise<J>;
  intervalMs?: number;
}

/** Read a stored job id from localStorage; returns null if missing or storage is unavailable. */
const readStored = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
/** Save a job id to localStorage, or remove it when `id` is null. Storage errors are ignored. */
const writeStored = (key: string, id: string | null) => {
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch { /* storage unavailable: polling just won't survive a reload */ }
};

/**
 * Track a long-running backend job: start it, remember its id in localStorage under `storageKey` so a
 * reload resumes it, poll `getJob` every `intervalMs` while queued/running, and refresh the user's
 * credits when a job starts or finishes.
 * @returns The current job, starting/active flags, upload progress, error state, and `start`/`reset`.
 */
export function useJobPolling<J extends PollableJob, I>({
  storageKey,
  getJob,
  startJob,
  intervalMs = 4000,
}: Options<J, I>) {
  const [job, setJob] = useState<J | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { refreshUser } = useAuth();

  const isActive = !!job && (job.status === 'queued' || job.status === 'running');

  // Resume a job that was in flight before a page reload.
  useEffect(() => {
    const id = readStored(storageKey);
    if (!id) return;
    getJob(id).then(setJob).catch(() => writeStored(storageKey, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // A failed job's credit is refunded on the server: refresh the balance when a job ends.
  const finished = !!job && (job.status === 'failed' || job.status === 'succeeded');
  useEffect(() => {
    if (finished) refreshUser();
  }, [finished, refreshUser]);

  // Poll while the job is queued/running.
  useEffect(() => {
    if (!job || !isActive) return;
    const timer = window.setTimeout(async () => {
      try {
        setJob(await getJob(job.id));
      } catch {
        // transient network error: re-arm the poll with the same job
        setJob(prev => (prev ? { ...prev } : prev));
      }
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [job, isActive, getJob, intervalMs]);

  /** Start a new job with `input`, tracking upload progress, persisting its id and capturing any start error. */
  const start = useCallback(async (input: I) => {
    setError(null);
    setIsStarting(true);
    setUploadProgress(0);
    try {
      const newJob = await startJob(input, setUploadProgress);
      setJob(newJob);
      writeStored(storageKey, newJob.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start generation');
    } finally {
      setIsStarting(false);
      refreshUser(); // starting a job uses a credit
    }
  }, [startJob, storageKey, refreshUser]);

  /** Forget the current job and error and remove the stored job id. */
  const reset = useCallback(() => {
    setJob(null);
    setError(null);
    writeStored(storageKey, null);
  }, [storageKey]);

  return { job, isStarting, isActive, uploadProgress, error, setError, start, reset };
}
