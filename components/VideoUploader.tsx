import React, { useCallback } from 'react';

interface VideoUploaderProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
}

export const VideoUploader: React.FC<VideoUploaderProps> = ({ onFileSelect, selectedFile }) => {
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('video/')) {
          onFileSelect(file);
        } else {
          alert('Please upload a video file.');
        }
      }
    },
    [onFileSelect]
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div 
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
        ${selectedFile ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-600 hover:border-slate-400 hover:bg-slate-800/50'}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onClick={() => document.getElementById('fileInput')?.click()}
    >
      <input 
        type="file" 
        id="fileInput" 
        accept="video/*" 
        className="hidden" 
        onChange={handleChange} 
      />
      
      {selectedFile ? (
        <div className="flex flex-col items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-emerald-400 mb-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <p className="font-semibold text-emerald-300 truncate max-w-xs">{selectedFile.name}</p>
          <p className="text-xs text-emerald-400/70 mt-1">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-slate-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-slate-300 font-medium text-lg">Drop your video here</p>
          <p className="text-slate-500 text-sm mt-2">or click to browse (MP4, WEBM)</p>
          <p className="text-slate-500 text-xs mt-4">Max size recommended: 20MB</p>
        </div>
      )}
    </div>
  );
};