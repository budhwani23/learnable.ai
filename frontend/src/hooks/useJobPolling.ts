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

const readStored = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writeStored = (key: string, id: string | null) => {
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch { /* storage unavailable: polling just won't survive a reload */ }
};

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

  const reset = useCallback(() => {
    setJob(null);
    setError(null);
    writeStored(storageKey, null);
  }, [storageKey]);

  return { job, isStarting, isActive, uploadProgress, error, setError, start, reset };
}
