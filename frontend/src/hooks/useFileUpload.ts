// useFileUpload.ts
// Custom hook for file upload functionality

import { useState, useCallback, useRef } from 'react';
import { SUPPORTED_FILE_TYPES, API_CONFIG, ERROR_MESSAGES } from '@/lib/constants';
import type { UploadedFile, FileValidationResult } from '@/lib/types';
import { toast } from '@/hooks/use-toast';

export const useFileUpload = () => {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validate file type and size
  const validateFile = useCallback((file: File): FileValidationResult => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    if (!SUPPORTED_FILE_TYPES.ALL.includes(extension)) {
      return {
        isValid: false,
        error: ERROR_MESSAGES.UNSUPPORTED_FILE_TYPE,
      };
    }

    if (file.size > API_CONFIG.MAX_FILE_SIZE) {
      return {
        isValid: false,
        error: ERROR_MESSAGES.FILE_TOO_LARGE,
      };
    }

    return { isValid: true };
  }, []);

  // Create uploaded file object
  const createUploadedFile = useCallback((file: File): UploadedFile => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    return {
      file,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      size: file.size,
      type: file.type,
      extension,
      uploadProgress: 0,
      status: 'pending',
    };
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback((files: FileList | File[]) => {
  const fileArray = Array.from(files);

  if (fileArray.length === 0) return;

  const firstFile = fileArray[0];
  const validation = validateFile(firstFile);

  if (validation.isValid) {
    const uploadedFile = createUploadedFile(firstFile);
    setUploadedFiles([uploadedFile]); // ✅ Replace instead of appending
  } else {
    // Tell the user why the file was ignored instead of failing silently.
    toast({
      title: `Can't use "${firstFile.name}"`,
      description: validation.error || 'This file could not be added.',
      variant: 'destructive',
    });
  }
}, [validateFile, createUploadedFile]);


  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
  }, [handleFileSelect]);

  // Remove file
  const removeFile = useCallback((fileId: string) => {
    setUploadedFiles(prev => prev.filter(file => file.id !== fileId));
  }, []);

  // Clear all files
  const clearFiles = useCallback(() => {
    setUploadedFiles([]);
  }, []);

  // Update file status
  const updateFileStatus = useCallback((
    fileId: string, 
    status: UploadedFile['status'], 
    progress?: number,
    error?: string
  ) => {
    setUploadedFiles(prev => 
      prev.map(file => 
        file.id === fileId 
          ? { 
              ...file, 
              status, 
              uploadProgress: progress ?? file.uploadProgress,
              error: error ?? file.error 
            }
          : file
      )
    );
  }, []);

  // Trigger file input
  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle file input change
const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  const files = e.target.files;
  if (files && files.length > 0) {
    const firstFile = files[0];
    handleFileSelect([firstFile]); // Pass only the first file as an array
  }
  // Reset input value to allow selecting the same file again
  e.target.value = '';
}, [handleFileSelect]);

  // Get files by type
  const getFilesByType = useCallback((type: 'audio' | 'video' | 'document') => {
    const typeExtensions = {
      audio: SUPPORTED_FILE_TYPES.AUDIO,
      video: SUPPORTED_FILE_TYPES.VIDEO,
      document: SUPPORTED_FILE_TYPES.DOCUMENTS,
    };

    return uploadedFiles.filter(file => 
      typeExtensions[type].includes(file.extension)
    );
  }, [uploadedFiles]);

  // Get total file size
  const getTotalFileSize = useCallback(() => {
    return uploadedFiles.reduce((total, file) => total + file.size, 0);
  }, [uploadedFiles]);

  // Check if files are valid
  const areFilesValid = useCallback(() => {
    return uploadedFiles.every(file => file.status !== 'error');
  }, [uploadedFiles]);

  return {
    uploadedFiles,
    isDragOver,
    fileInputRef,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileInputChange,
    removeFile,
    clearFiles,
    updateFileStatus,
    triggerFileInput,
    getFilesByType,
    getTotalFileSize,
    areFilesValid,
    validateFile,
  };
}; 