// file-upload.tsx
// Reusable file upload component

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Upload, 
  FileText, 
  Music, 
  Video, 
  File, 
  X, 
  CheckCircle, 
  AlertCircle,
  Loader2 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FILE_TYPE_LABELS, API_CONFIG } from '@/lib/constants';
import type { UploadedFile, FileUploadProps } from '@/lib/types';

interface FileUploadComponentProps extends FileUploadProps {
  uploadedFiles: UploadedFile[];
  isDragOver: boolean;
  onRemoveFile: (fileId: string) => void;
  onClearFiles: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const FileUpload: React.FC<FileUploadComponentProps> = ({
  uploadedFiles,
  isDragOver,
  onRemoveFile,
  onClearFiles,
  onDragOver,
  onDragLeave,
  onDrop,
  fileInputRef,
  onFileInputChange,
  acceptedTypes = [],
  maxSize = API_CONFIG.MAX_FILE_SIZE,
  multiple = true,
  disabled = false,
}) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (extension: string) => {
    if (['.pdf', '.docx', '.doc'].includes(extension)) {
      return <FileText className="h-4 w-4" />;
    }
    if (['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'].includes(extension)) {
      return <Music className="h-4 w-4" />;
    }
    if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'].includes(extension)) {
      return <Video className="h-4 w-4" />;
    }
    return <File className="h-4 w-4" />;
  };

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'uploading':
        return <Loader2 className="h-4 w-4 text-emerald-600 animate-spin" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: UploadedFile['status']) => {
    switch (status) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'uploading':
        return 'bg-emerald-50 border-emerald-400';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        accept={acceptedTypes.join(',')}
        onChange={onFileInputChange}
        className="hidden"
        disabled={disabled}
      />

      {/* Upload area */}
      <div
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
          isDragOver
            ? 'border-green-700 bg-green-400/5'
            : 'border-border hover:border-green-500',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Upload className={cn(
          'h-12 w-12 mx-auto mb-4',
          isDragOver ? 'text-primary' : 'text-muted-foreground'
        )} />
        
        <h3 className="text-lg text-gray-600 font-semibold mb-2">
          {isDragOver ? 'Drop files here' : 'Upload your files'}
        </h3>
        
        <p className="text-muted-foreground mb-4">
          Supports PDF and Word documents, audio (MP3, WAV, M4A…) and video (MP4, MOV, WEBM…), up to {formatFileSize(maxSize)}
        </p>
        
        <Button 
          className='bg-emerald-600 text-white hover:bg-emerald-500'
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          <FileText className="h-4 w-4 mr-2" />
          Choose File
        </Button>
        
        {acceptedTypes.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Accepted types: {acceptedTypes.join(', ')}
          </p>
        )}
      </div>

      {/* File list */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Uploaded Files ({uploadedFiles.length})</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFiles}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear All
            </Button>
          </div>
          
          <div className="space-y-2">
            {uploadedFiles.map((file) => (
              <Card
                key={file.id}
                className={cn(
                  'p-3 border transition-colors',
                  getStatusColor(file.status)
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    {getFileIcon(file.extension)}
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <Badge variant="secondary" className="text-xs">
                          {FILE_TYPE_LABELS[file.extension as keyof typeof FILE_TYPE_LABELS] || 'Unknown'}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                        <span>{formatFileSize(file.size)}</span>
                        {file.status === 'uploading' && (
                          <span>{Math.round(file.uploadProgress)}%</span>
                        )}
                        {file.error && (
                          <span className="text-red-500">{file.error}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {getStatusIcon(file.status)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveFile(file.id)}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                
                {file.status === 'uploading' && (
                  <Progress 
                    value={file.uploadProgress} 
                    className="mt-2 h-1" 
                  />
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUpload; 