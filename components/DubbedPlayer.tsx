import React, { useRef, useState, useEffect } from 'react';
import { DubbingSegment } from '../types';

interface DubbedPlayerProps {
  videoUrl: string;
  segments: DubbingSegment[];
}

export const DubbedPlayer: React.FC<DubbedPlayerProps> = ({ videoUrl, segments }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBuffersRef = useRef<{ [index: number]: AudioBuffer }>({});
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const destinationNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  
  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentCaption, setCurrentCaption] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Tracking
  const triggeredSegmentsRef = useRef<Set<number>>(new Set());
  const activeSegmentIndexRef = useRef<number | null>(null);
  const isVideoPausedForDubRef = useRef(false);

  // --- Initialization & Audio Loading ---

  useEffect(() => {
    // Initialize Audio Context on user interaction usually, but here on mount for simplicity
    const initAudio = async () => {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      audioContextRef.current = ctx;

      // Create destination for recording
      destinationNodeRef.current = ctx.createMediaStreamDestination();

      // Load all audio segments into buffers
      const buffers: { [index: number]: AudioBuffer } = {};
      
      await Promise.all(segments.map(async (seg, i) => {
        try {
          const response = await fetch(seg.audioUrl);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          buffers[i] = audioBuffer;
        } catch (e) {
          console.error("Error loading audio segment", i, e);
        }
      }));
      
      audioBuffersRef.current = buffers;
    };

    if (segments.length > 0) {
      initAudio();
    }

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [segments]);

  // --- Playback Controls ---

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && !isVideoPausedForDubRef.current) {
      video.play().catch(e => {
        console.error("Video play failed", e);
        setIsPlaying(false);
      });
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
    } else if (!isPlaying) {
      video.pause();
      stopAllAudio();
    }
  }, [isPlaying]);

  const stopAllAudio = () => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore already stopped */ }
    });
    activeSourcesRef.current = [];
    activeSegmentIndexRef.current = null;
    isVideoPausedForDubRef.current = false;
  };

  const playSegmentAudio = (index: number) => {
    const ctx = audioContextRef.current;
    const buffer = audioBuffersRef.current[index];
    
    if (!ctx || !buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    
    // Connect to speakers
    source.connect(ctx.destination);
    // Connect to recorder destination
    if (destinationNodeRef.current) {
      source.connect(destinationNodeRef.current);
    }

    source.start(0);
    activeSourcesRef.current.push(source);
    activeSegmentIndexRef.current = index;

    source.onended = () => {
      // Clean up current source tracking
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      
      // If this was the main tracked segment
      if (activeSegmentIndexRef.current === index) {
        activeSegmentIndexRef.current = null;
        
        // Resume video if it was paused waiting for this segment
        if (isVideoPausedForDubRef.current && isPlaying) {
          console.log("Audio finished, resuming video for next segment");
          isVideoPausedForDubRef.current = false;
          videoRef.current?.play();
        }
      }
    };
  };

  // --- Synchronization Logic ---

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);
    
    // 1. Trigger Audio Segments
    segments.forEach((seg, index) => {
      // Small window to trigger audio
      if (time >= seg.startTime && time < seg.startTime + 0.3) {
        if (!triggeredSegmentsRef.current.has(index)) {
          triggeredSegmentsRef.current.add(index);
          playSegmentAudio(index);
        }
      }
    });

    // 2. Smart Pause: If audio is still playing and we are about to hit the NEXT segment, pause video.
    // This holds the visual on the current scene until the narration finishes.
    if (activeSegmentIndexRef.current !== null) {
      const nextSeg = segments[activeSegmentIndexRef.current + 1];
      if (nextSeg) {
        const timeToNext = nextSeg.startTime - time;
        
        // If we are approaching the start time of the next segment (e.g., within 0.2s)
        // AND the audio for the current segment is still playing...
        if (timeToNext <= 0.2 && timeToNext > -0.5) { 
           if (!isVideoPausedForDubRef.current && !videoRef.current.paused) {
             console.log(`Smart Pause: Holding frame for segment ${activeSegmentIndexRef.current} to finish.`);
             isVideoPausedForDubRef.current = true;
             videoRef.current.pause();
           }
        }
      }
    }

    // 3. Captions
    const activeSegment = segments.reduce((prev: DubbingSegment | null, current: DubbingSegment) => {
      // Show caption starting at startTime
      // Keep showing until next segment starts OR 5 seconds passed
      if (time >= current.startTime) {
         // If a later segment also matches (it started), replace prev
         if (!prev || current.startTime > prev.startTime) {
           // Check duration limit (heuristic: 5s or until next start)
           const nextOne = segments[segments.indexOf(current) + 1];
           const endTime = nextOne ? nextOne.startTime : current.startTime + 5;
           
           if (time < endTime) return current;
         }
      }
      return prev;
    }, null as DubbingSegment | null);

    setCurrentCaption(activeSegment ? activeSegment.text : null);

    // Update progress for export if needed
    if (isExporting && duration > 0) {
      setExportProgress(Math.round((time / duration) * 100));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
    triggeredSegmentsRef.current.clear();
    stopAllAudio();
  };

  // --- Export / Download ---

  const handleExport = async () => {
    if (!videoRef.current || !audioContextRef.current || !destinationNodeRef.current) return;
    
    setIsExporting(true);
    setIsPlaying(true);
    triggeredSegmentsRef.current.clear();
    stopAllAudio();
    
    const video = videoRef.current;
    
    // Determine supported MIME type
    const getSupportedMimeType = () => {
      const types = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm'
      ];
      for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
      }
      return 'video/webm'; // Fallback
    };
    
    const mimeType = getSupportedMimeType();
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    console.log(`Exporting using MIME type: ${mimeType}`);

    // Capture the video stream
    const videoStream = (video as any).captureStream ? (video as any).captureStream() : (video as any).mozCaptureStream();
    const audioStream = destinationNodeRef.current.stream;
    
    // Combine tracks: Video from canvas/element + Audio from WebAudio destination
    const combinedTracks = [
      ...videoStream.getVideoTracks(),
      ...audioStream.getAudioTracks()
    ];
    const combinedStream = new MediaStream(combinedTracks);
    
    const recorder = new MediaRecorder(combinedStream, {
      mimeType: mimeType
    });
    
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dubbed_video.${ext}`;
      a.click();
      
      setIsExporting(false);
      setIsPlaying(false);
      setExportProgress(0);
      video.currentTime = 0; // Reset
      video.muted = true; // Ensure original is muted
      triggeredSegmentsRef.current.clear();
    };

    // Start recording
    recorder.start();
    
    // Reset video to start and play
    video.currentTime = 0;
    video.muted = true; // Mute the video element output so it doesn't double up or feedback. The stream still captures audio from destinationNode.

    try {
      await video.play();
    } catch (e) {
      console.error("Export play failed", e);
      setIsExporting(false);
    }

    // We need to wait for video to end to stop recording
    video.onended = () => {
      recorder.stop();
      // Remove this temporary listener
      video.onended = () => setIsPlaying(false);
    };
  };

  return (
    <div className="flex flex-col bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-700">
      <div className="relative aspect-video bg-black group">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          muted 
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
          onEnded={() => setIsPlaying(false)}
        />
        
        {/* Caption Overlay */}
        {currentCaption && (
          <div className="absolute bottom-8 left-0 right-0 text-center px-4 pointer-events-none z-10">
            <span className="inline-block bg-black/70 text-white text-lg md:text-xl font-medium px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm transition-all duration-300">
              {currentCaption}
            </span>
          </div>
        )}

        {/* Overlay Play Button */}
        {!isPlaying && !isExporting && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-black/40 cursor-pointer transition-opacity hover:bg-black/30 z-20"
            onClick={() => setIsPlaying(true)}
          >
            <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 shadow-lg group-hover:scale-105 transition-transform">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}

        {/* Exporting Overlay */}
        {isExporting && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30">
              <div className="text-emerald-400 font-bold text-xl mb-2">Generating Video...</div>
              <div className="w-64 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-200"
                  style={{ width: `${exportProgress}%` }}
                ></div>
              </div>
              <p className="text-slate-400 text-sm mt-2">Please wait while we record the output.</p>
           </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-4 space-y-3 bg-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}</span>
          <span>{Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}</span>
        </div>
        
        <input
          type="range"
          min="0"
          max={duration || 0}
          value={currentTime}
          onChange={handleSeek}
          disabled={isExporting}
          className="w-full h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 disabled:opacity-50"
        />

        <div className="flex items-center justify-between">
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={isExporting}
              className="text-white hover:text-emerald-400 transition-colors disabled:opacity-50"
            >
              {isPlaying ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              )}
            </button>

            <div className="flex items-center gap-4">
               {isVideoPausedForDubRef.current && (
                 <span className="text-xs text-yellow-500 animate-pulse font-medium">Syncing Voice...</span>
               )}

               <button
                 onClick={handleExport}
                 disabled={isExporting || segments.length === 0}
                 className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                 </svg>
                 Export Video
               </button>
            </div>
        </div>
      </div>
    </div>
  );
};