// useProcessing.ts
// Custom hook for processing state management

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useFileUpload } from './useFileUpload';
import apiClient from '@/lib/api';
import { PROCESSING_STATES } from '@/lib/constants';
import type { 
  ProcessingStatus, 
  ProcessingResults, 
  MindmapInput,
  MCQQuizInput,
  FlashcardInput,
  UploadedFile
} from '@/lib/types';

export const useProcessing = (uploadedFiles: UploadedFile[] = []) => {
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    state: PROCESSING_STATES.IDLE,
    progress: 0,
    message: '',
  });

  const [results, setResults] = useState<ProcessingResults | null>(null);
  const { updateFileStatus } = useFileUpload();

  // Update processing status
  const updateStatus = useCallback((
    state: ProcessingStatus['state'],
    progress?: number,
    message?: string,
    error?: string
  ) => {
    setProcessingStatus(prev => ({
      ...prev,
      state,
      progress: progress ?? prev.progress,
      message: message ?? prev.message,
      error,
    }));
  }, []);

  // Reset processing state
  const resetProcessing = useCallback(() => {
    setProcessingStatus({
      state: PROCESSING_STATES.IDLE,
      progress: 0,
      message: '',
    });
    setResults(null);
  }, []);



  // Multimedia processing mutation
  const processMultimediaMutation = useMutation({
    mutationFn: async (text?: string) => {
      const audioFiles = uploadedFiles.filter(f => 
        ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'].includes(f.extension)
      );
      const videoFiles = uploadedFiles.filter(f => 
        ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'].includes(f.extension)
      );
      const documentFiles = uploadedFiles.filter(f => 
        ['.pdf', '.docx', '.doc'].includes(f.extension)
      );

      if (audioFiles.length === 0 && videoFiles.length === 0 && documentFiles.length === 0 && !text) {
        throw new Error('No files or text provided for processing');
      }

      updateStatus(PROCESSING_STATES.PROCESSING, 0, 'Processing your content...');

      const audioFile = audioFiles[0]?.file;
      const videoFile = videoFiles[0]?.file;
      const documentFile = documentFiles[0]?.file;

      return apiClient.processMultimedia(
        audioFile,
        videoFile,
        documentFile,
        text,
        (progress) => {
          updateStatus(PROCESSING_STATES.PROCESSING, progress, 'Processing your content...');
        }
      );
    },
    onSuccess: (data) => {
      setResults(prev => ({
        ...prev,
        summary: data.summary,
        mindmap: data.mindmap,
        quiz: data.quiz,
        flashcards: data.flashcards,
        content_type: data.summary.content_type,
        original_file: uploadedFiles[0] || undefined,
      }));
      updateStatus(PROCESSING_STATES.SUCCESS, 100, 'All resources generated successfully!');
    },
    onError: (error: Error) => {
      updateStatus(PROCESSING_STATES.ERROR, 0, '', error.message);
    },
  });

  // Individual processing mutations
  const summarizeMultimediaMutation = useMutation({
    mutationFn: async (text?: string) => {
      updateStatus(PROCESSING_STATES.PROCESSING, 0, 'Generating summary...');
      
      const audioFile = uploadedFiles.find(f => 
        ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'].includes(f.extension)
      )?.file;
      const videoFile = uploadedFiles.find(f => 
        ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'].includes(f.extension)
      )?.file;
      const documentFile = uploadedFiles.find(f => 
        ['.pdf', '.docx', '.doc'].includes(f.extension)
      )?.file;

      return apiClient.summarizeMultimedia(
        audioFile,
        videoFile,
        documentFile,
        text,
        (progress) => {
          updateStatus(PROCESSING_STATES.PROCESSING, progress, 'Generating summary...');
        }
      );
    },
    onSuccess: (data) => {
      console.log('summarizeMultimediaMutation success:', data);
      setResults(prev => ({
        ...prev,
        summary: data,
        content_type: data.content_type,
      }));
      updateStatus(PROCESSING_STATES.SUCCESS, 100, 'Summary generated successfully!');
    },
    onError: (error: Error) => {
      updateStatus(PROCESSING_STATES.ERROR, 0, '', error.message);
    },
  });

  const generateMindmapMutation = useMutation({
    mutationFn: async (input: MindmapInput | string | undefined) => {
      updateStatus(PROCESSING_STATES.PROCESSING, 0, 'Generating mindmap...');
      
      // Always use multimedia endpoint
      const audioFile = uploadedFiles.find(f => 
        ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'].includes(f.extension)
      )?.file;
      const videoFile = uploadedFiles.find(f => 
        ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'].includes(f.extension)
      )?.file;
      const documentFile = uploadedFiles.find(f => 
        ['.pdf', '.docx', '.doc'].includes(f.extension)
      )?.file;

      // Extract topic from input
      const topic = typeof input === 'object' ? input.topic : input;

      return apiClient.generateMindmapMultimedia(
        audioFile,
        videoFile,
        documentFile,
        topic,
        (progress) => {
          updateStatus(PROCESSING_STATES.PROCESSING, progress, 'Generating mindmap...');
        }
      );
    },
    onSuccess: (data) => {
      setResults(prev => ({
        ...prev,
        mindmap: data,
        content_type: prev?.content_type || data.content_type,
      }));
      updateStatus(PROCESSING_STATES.SUCCESS, 100, 'Mindmap generated successfully!');
    },
    onError: (error: Error) => {
      updateStatus(PROCESSING_STATES.ERROR, 0, '', error.message);
    },
  });

  const generateQuizMutation = useMutation({
    mutationFn: async (input: MCQQuizInput | { content?: string; numQuestions: number }) => {
      updateStatus(PROCESSING_STATES.PROCESSING, 0, 'Generating quiz questions...');
      
      // Always use multimedia endpoint
      const audioFile = uploadedFiles.find(f => 
        ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'].includes(f.extension)
      )?.file;
      const videoFile = uploadedFiles.find(f => 
        ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'].includes(f.extension)
      )?.file;
      const documentFile = uploadedFiles.find(f => 
        ['.pdf', '.docx', '.doc'].includes(f.extension)
      )?.file;

      const content = 'content' in input ? input.content : undefined;
      const numQuestions = 'numQuestions' in input ? input.numQuestions : 10;

      return apiClient.generateMCQQuizMultimedia(
        audioFile,
        videoFile,
        documentFile,
        content,
        numQuestions,
        (progress) => {
          updateStatus(PROCESSING_STATES.PROCESSING, progress, 'Generating quiz questions...');
        }
      );
    },
    onSuccess: (data) => {
      setResults(prev => ({
        ...prev,
        quiz: data,
        content_type: prev?.content_type || data.content_type,
      }));
      updateStatus(PROCESSING_STATES.SUCCESS, 100, 'Quiz generated successfully!');
    },
    onError: (error: Error) => {
      updateStatus(PROCESSING_STATES.ERROR, 0, '', error.message);
    },
  });

  const generateFlashcardsMutation = useMutation({
    mutationFn: async (input: FlashcardInput | string) => {
      console.log('generateFlashcardsMutation called with input:', input);
      updateStatus(PROCESSING_STATES.PROCESSING, 0, 'Generating flashcards...');
      
      // Always use multimedia endpoint
      const audioFile = uploadedFiles.find(f => 
        ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'].includes(f.extension)
      )?.file;
      const videoFile = uploadedFiles.find(f => 
        ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'].includes(f.extension)
      )?.file;
      const documentFile = uploadedFiles.find(f => 
        ['.pdf', '.docx', '.doc'].includes(f.extension)
      )?.file;

      // Extract content from input
      const content = typeof input === 'string' ? input : (input && 'content' in input ? input.content : undefined);

      return apiClient.generateFlashcardsMultimedia(
        audioFile,
        videoFile,
        documentFile,
        content,
        (progress) => {
          updateStatus(PROCESSING_STATES.PROCESSING, progress, 'Generating flashcards...');
        }
      );
    },
    onSuccess: (data) => {
      setResults(prev => ({
        ...prev,
        flashcards: data,
        content_type: prev?.content_type || data.content_type,
      }));
      updateStatus(PROCESSING_STATES.SUCCESS, 100, 'Flashcards generated successfully!');
    },
    onError: (error: Error) => {
      updateStatus(PROCESSING_STATES.ERROR, 0, '', error.message);
    },
  });

  // Cancel processing
  const cancelProcessing = useCallback(() => {
    updateStatus(PROCESSING_STATES.IDLE, 0, 'Processing cancelled');
  }, [updateStatus]);

  return {
    processingStatus,
    results,
    updateStatus,
    resetProcessing,
    cancelProcessing,
    processMultimediaMutation,
    summarizeMultimediaMutation,
    generateMindmapMutation,
    generateQuizMutation,
    generateFlashcardsMutation,
  };
}; 