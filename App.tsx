import React, { useState, useEffect } from 'react';
import { VideoUploader } from './components/VideoUploader';
import { DubbedPlayer } from './components/DubbedPlayer';
import { generateDubbingTimeline } from './services/geminiService';
import { AppState, DubbingSegment } from './types';

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  
  // Initialize from localStorage if available
  const [instructions, setInstructions] = useState<string>(() => {
    return localStorage.getItem('dubai_instructions') || "";
  });

  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [dubbingSegments, setDubbingSegments] = useState<DubbingSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Persist instructions whenever they change
  useEffect(() => {
    localStorage.setItem('dubai_instructions', instructions);
  }, [instructions]);

  const handleFileSelect = (file: File) => {
    // Limit to 20MB to ensure reliable API transmission without timeouts
    if (file.size > 20 * 1024 * 1024) { 
      setError("File size exceeds 20MB limit. Please upload a shorter or more compressed video.");
      return;
    }
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoPreviewUrl(url);
    
    // Reset state
    setAppState(AppState.IDLE);
    setDubbingSegments([]);
    setError(null);
  };

  const handleGenerate = async () => {
    if (!videoFile) return;

    try {
      setAppState(AppState.PROCESSING);
      setError(null);

      // Robust default instruction that encourages content generation even for silent videos
      const finalInstructions = instructions.trim() || "Read visible text. If there is no text, narrate the key actions in an engaging way.";

      const segments = await generateDubbingTimeline(videoFile, finalInstructions);
      
      setDubbingSegments(segments);
      setAppState(AppState.COMPLETED);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong during generation.");
      setAppState(AppState.ERROR);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 selection:bg-emerald-500/30">
      
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-10 w-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-teal-300">
            DubAI
          </h1>
          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-xs border border-slate-700 font-medium">
            Beta
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          
          {/* Left Column: Controls */}
          <div className="space-y-8">
            
            <section>
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-sm text-emerald-400 border border-slate-700">1</span>
                Input Video
              </h2>
              <VideoUploader 
                onFileSelect={handleFileSelect} 
                selectedFile={videoFile} 
              />
            </section>

            <section className={!videoFile ? "opacity-50 pointer-events-none transition-opacity" : "transition-opacity"}>
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                 <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-sm text-emerald-400 border border-slate-700">2</span>
                Voice Instructions
              </h2>
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                <label className="block text-sm text-slate-400 mb-2">
                  Describe voices or specific character instructions.
                </label>
                <textarea
                  className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg p-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all resize-none"
                  placeholder="e.g. Blue cat: soft little girl voice. Yellow dog: deep grumpy voice. Narrate the scene enthusiastically."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
                <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                  <button 
                    onClick={() => setInstructions(prev => prev + " Narrate in a British documentary style.")}
                    className="whitespace-nowrap px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  >
                    + Documentary
                  </button>
                  <button 
                    onClick={() => setInstructions(prev => prev + " Use funny cartoon voices for characters.")}
                    className="whitespace-nowrap px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  >
                    + Cartoon
                  </button>
                  <button 
                    onClick={() => setInstructions(prev => prev + " Read all on-screen text clearly.")}
                    className="whitespace-nowrap px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  >
                    + Read Text
                  </button>
                </div>
              </div>
            </section>

            <button
              onClick={handleGenerate}
              disabled={!videoFile || appState === AppState.PROCESSING}
              className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all transform
                ${!videoFile 
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                  : appState === AppState.PROCESSING 
                    ? 'bg-emerald-600/50 text-white cursor-wait'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:shadow-emerald-500/25 hover:scale-[1.02] active:scale-[0.98]'
                }`}
            >
              {appState === AppState.PROCESSING ? (
                <div className="flex items-center justify-center gap-3">
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Processing Segments...</span>
                </div>
              ) : (
                "Generate Dubbing"
              )}
            </button>

            {error && (
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/50 text-red-400 text-sm">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>

          {/* Right Column: Preview / Result */}
          <div className="bg-slate-800/30 rounded-2xl border border-slate-700/50 p-6 flex flex-col h-fit">
             <h2 className="text-xl font-semibold text-white mb-6 flex items-center justify-between">
                <span>Output Studio</span>
                {appState === AppState.COMPLETED && (
                  <span className="text-xs font-normal text-emerald-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Ready
                  </span>
                )}
             </h2>

             <div className="flex-1 flex items-center justify-center min-h-[300px]">
                {appState === AppState.COMPLETED && videoPreviewUrl && dubbingSegments.length > 0 ? (
                  <div className="w-full animation-fade-in">
                    <DubbedPlayer videoUrl={videoPreviewUrl} segments={dubbingSegments} />
                    <p className="text-center text-slate-500 text-sm mt-4">
                      Audio synced with video timeline.
                    </p>
                  </div>
                ) : videoPreviewUrl ? (
                  <div className="w-full relative opacity-50 grayscale-[0.5] hover:grayscale-0 transition-all">
                    <div className="aspect-video bg-black rounded-lg overflow-hidden border border-slate-700">
                      <video src={videoPreviewUrl} className="w-full h-full object-contain" controls />
                    </div>
                    <div className="absolute top-4 right-4 bg-black/60 px-3 py-1 rounded-full text-xs text-white backdrop-blur-md">
                      Original Preview
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-slate-600">
                    <div className="w-24 h-24 bg-slate-800 rounded-full mx-auto mb-4 flex items-center justify-center">
                       <svg className="w-10 h-10 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                       </svg>
                    </div>
                    <p>Waiting for input...</p>
                  </div>
                )}
             </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;