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
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  // Tracking
  const triggeredSegmentsRef = useRef<Set<number>>(new Set());
  const activeSegmentIndexRef = useRef<number | null>(null);
  const isVideoPausedForDubRef = useRef(false);
  const isExportingRef = useRef(false);

  // --- Initialization & Audio Loading ---

  useEffect(() => {
    const initAudio = async () => {
      // Create context but don't resume yet (must be user initiated on iOS)
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      audioContextRef.current = ctx;

      destinationNodeRef.current = ctx.createMediaStreamDestination();

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

  // Robust Audio Unlock for iOS
  const ensureAudioContext = () => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    // 1. Resume context
    if (ctx.state === 'suspended') {
      ctx.resume().catch(e => console.error("Audio resume failed", e));
    }

    // 2. Play silent buffer (iOS Wake-up)
    // This needs to happen immediately on click
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (e) {
      // ignore
    }
  };

  const togglePlay = async () => {
    // CRITICAL: Call this synchronously at the start of the event handler
    ensureAudioContext();

    if (!isPlaying) {
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && !isVideoPausedForDubRef.current) {
      // Ensure video is muted so it doesn't conflict with Web Audio
      video.muted = true; 
      video.play().catch(e => {
        console.error("Video play failed", e);
        setIsPlaying(false);
      });
    } else if (!isPlaying) {
      video.pause();
      stopAllAudio();
    }
  }, [isPlaying]);

  const stopAllAudio = () => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore */ }
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
    
    // Connect to recorder destination if it exists
    if (destinationNodeRef.current) {
      source.connect(destinationNodeRef.current);
    }

    source.start(0);
    activeSourcesRef.current.push(source);
    activeSegmentIndexRef.current = index;

    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      
      if (activeSegmentIndexRef.current === index) {
        activeSegmentIndexRef.current = null;
        if (isVideoPausedForDubRef.current && isPlaying) {
          isVideoPausedForDubRef.current = false;
          videoRef.current?.play();
        }
      }
    };
  };

  // --- Synchronization ---

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);
    
    // 1. Trigger Audio
    segments.forEach((seg, index) => {
      if (time >= seg.startTime && time < seg.startTime + 0.3) {
        if (!triggeredSegmentsRef.current.has(index)) {
          triggeredSegmentsRef.current.add(index);
          playSegmentAudio(index);
        }
      }
    });

    // 2. Smart Pause
    if (activeSegmentIndexRef.current !== null) {
      const nextSeg = segments[activeSegmentIndexRef.current + 1];
      if (nextSeg) {
        const timeToNext = nextSeg.startTime - time;
        if (timeToNext <= 0.2 && timeToNext > -0.5) { 
           if (!isVideoPausedForDubRef.current && !videoRef.current.paused) {
             isVideoPausedForDubRef.current = true;
             videoRef.current.pause();
           }
        }
      }
    }

    // 3. Captions
    const activeSegment = segments.reduce((prev: DubbingSegment | null, current: DubbingSegment) => {
      if (time >= current.startTime) {
         if (!prev || current.startTime > prev.startTime) {
           const nextOne = segments[segments.indexOf(current) + 1];
           const endTime = nextOne ? nextOne.startTime : current.startTime + 5;
           if (time < endTime) return current;
         }
      }
      return prev;
    }, null as DubbingSegment | null);

    setCurrentCaption(activeSegment ? activeSegment.text : null);

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
    setRecordedBlob(null); // Clear previous recording if user seeks
  };

  // --- Export (Record Phase) ---

  const handleStartExport = async () => {
    if (!videoRef.current || !audioContextRef.current || !destinationNodeRef.current) return;
    
    ensureAudioContext();
    
    setRecordedBlob(null); // Reset
    setIsExporting(true);
    isExportingRef.current = true;
    setIsPlaying(true);
    triggeredSegmentsRef.current.clear();
    stopAllAudio();
    
    const video = videoRef.current;
    
    // Canvas Setup
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      alert("Browser does not support video capture.");
      setIsExporting(false);
      isExportingRef.current = false;
      return;
    }

    // Draw Loop
    let animationFrameId: number;
    const draw = () => {
      if (!isExportingRef.current) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      animationFrameId = requestAnimationFrame(draw);
    };
    draw();
    
    // MIME Selection
    let mimeType = 'video/webm';
    if (typeof MediaRecorder.isTypeSupported === 'function') {
      if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
      }
    }
    
    try {
      // Capture Streams
      const canvasStream = (canvas as any).captureStream(30); 
      const audioStream = destinationNodeRef.current.stream;
      
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioStream.getAudioTracks()
      ]);
      
      const recorder = new MediaRecorder(combinedStream, { mimeType });
      const chunks: Blob[] = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        cancelAnimationFrame(animationFrameId);
        isExportingRef.current = false;
        
        const blob = new Blob(chunks, { type: mimeType });
        setRecordedBlob(blob); // Save to state
        
        setIsExporting(false);
        setIsPlaying(false);
        setExportProgress(0);
        video.currentTime = 0; 
        triggeredSegmentsRef.current.clear();
      };

      recorder.start();
      video.currentTime = 0;
      video.muted = true;
      await video.play();

      const onEndedHandler = () => {
        recorder.stop();
        video.removeEventListener('ended', onEndedHandler);
        setIsPlaying(false);
      };
      video.addEventListener('ended', onEndedHandler);

    } catch (e) {
      console.error("Export error:", e);
      alert("Export failed.");
      setIsExporting(false);
      isExportingRef.current = false;
      cancelAnimationFrame(animationFrameId!);
    }
  };

  // --- Share / Save Phase ---

  const handleShareOrSave = async () => {
    if (!recordedBlob) return;
    
    // Determine extension based on MIME type of blob
    const ext = recordedBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const fileName = `dubbed_video.${ext}`;
    const file = new File([recordedBlob], fileName, { type: recordedBlob.type });

    // Use Web Share API if available (iOS Safari supports this for files)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Dubbed Video',
          text: 'Check out my AI dubbed video created with DubAI!'
        });
      } catch (err) {
        if ((err as any).name !== 'AbortError') {
          console.error("Share failed", err);
          alert("Share failed, falling back to download.");
          downloadFallback(recordedBlob, fileName);
        }
      }
    } else {
      // Desktop Fallback
      downloadFallback(recordedBlob, fileName);
    }
  };

  const downloadFallback = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
        
        {/* Caption */}
        {currentCaption && (
          <div className="absolute bottom-8 left-0 right-0 text-center px-4 pointer-events-none z-10">
            <span className="inline-block bg-black/70 text-white text-lg md:text-xl font-medium px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm">
              {currentCaption}
            </span>
          </div>
        )}

        {/* Play Button Overlay */}
        {!isPlaying && !isExporting && !recordedBlob && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-black/40 cursor-pointer z-20"
            onClick={togglePlay}
          >
            <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 shadow-lg hover:scale-105 transition-transform">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}

        {/* Export Progress Overlay */}
        {isExporting && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30">
              <div className="text-emerald-400 font-bold text-xl mb-2">Recording Video...</div>
              <div className="w-64 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-200"
                  style={{ width: `${exportProgress}%` }}
                ></div>
              </div>
              <p className="text-slate-400 text-sm mt-2">Do not close this tab.</p>
           </div>
        )}

        {/* Save/Share Overlay (Post-Export) */}
        {recordedBlob && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-30 backdrop-blur-sm">
             <div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 shadow-2xl flex flex-col items-center gap-4 max-w-sm mx-4">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mb-1">
                  <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white">Video Ready!</h3>
                <p className="text-slate-400 text-center text-sm">
                  Save the video to your device. On iPhone, click 'Share' then select 'Save Video' to add it to your Photos.
                </p>
                
                <div className="flex flex-col gap-3 w-full mt-2">
                  <button 
                    onClick={handleShareOrSave}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    Share / Save
                  </button>
                  <button 
                    onClick={() => setRecordedBlob(null)}
                    className="w-full py-2 text-slate-400 hover:text-white text-sm"
                  >
                    Back to Preview
                  </button>
                </div>
             </div>
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
              onClick={togglePlay}
              disabled={isExporting || !!recordedBlob}
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

               {!recordedBlob && (
                 <button
                   onClick={handleStartExport}
                   disabled={isExporting || segments.length === 0}
                   className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                   </svg>
                   Create Video
                 </button>
               )}
            </div>
        </div>
      </div>
    </div>
  );
};
