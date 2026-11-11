// usePresentation.ts
// Starts a slide-deck job (Presenton), polls it, and loads the PDF preview.

import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api';
import type { PresentationJob, PresentationOption } from '@/lib/types';
import { useJobPolling } from './useJobPolling';

export interface StartPresentationInput {
  audioFile?: File;
  videoFile?: File;
  documentFile?: File;
  text?: string;
  focus?: string;
  nSlides: number;
  template: string;
  tone: string;
}

const startJob = (input: StartPresentationInput, onProgress: (p: number) => void) =>
  apiClient.startPresentation(input, onProgress);
const getJob = (id: string) => apiClient.getPresentationJob(id);

const FALLBACK_TEMPLATES: PresentationOption[] = [{ id: 'general', name: 'General' }];
const FALLBACK_TONES: PresentationOption[] = [{ id: 'educational', name: 'Educational' }];

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const usePresentation = () => {
  const polling = useJobPolling<PresentationJob, StartPresentationInput>({
    storageKey: 'presentation_active_job',
    getJob,
    startJob,
  });
  const { job, setError } = polling;
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [templates, setTemplates] = useState(FALLBACK_TEMPLATES);
  const [tones, setTones] = useState(FALLBACK_TONES);
  const [isDownloading, setIsDownloading] = useState(false);
  const pdfUrlRef = useRef<string | null>(null);

  const setBlobUrl = (url: string | null) => {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = url;
    setPdfUrl(url);
  };

  useEffect(() => {
    apiClient.getPresentationOptions()
      .then(o => { setTemplates(o.templates); setTones(o.tones); })
      .catch(() => { /* keep fallbacks */ });
  }, []);

  // Load the PDF preview once the deck is ready.
  useEffect(() => {
    if (!job || job.status !== 'succeeded' || !job.has_pdf || pdfUrlRef.current) return;
    let cancelled = false;
    apiClient.fetchPresentationFile(job.id, 'pdf')
      .then(blob => { if (!cancelled) setBlobUrl(URL.createObjectURL(blob)); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load preview'); });
    return () => { cancelled = true; };
  }, [job, setError]);

  useEffect(() => () => { if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current); }, []);

  const download = useCallback(async (format: 'pptx' | 'pdf') => {
    if (!job) return;
    setIsDownloading(true);
    try {
      const base = (job.title || 'presentation').replace(/[^\w\- ]+/g, '').trim() || 'presentation';
      saveBlob(await apiClient.fetchPresentationFile(job.id, format), `${base}.${format}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  }, [job, setError]);

  const start = useCallback(async (input: StartPresentationInput) => {
    setBlobUrl(null);
    await polling.start(input);
  }, [polling]);

  const reset = useCallback(() => {
    setBlobUrl(null);
    polling.reset();
  }, [polling]);

  return { ...polling, pdfUrl, templates, tones, isDownloading, download, start, reset };
};

export type PresentationState = ReturnType<typeof usePresentation>;
