import { GoogleGenAI, Modality, Type } from "@google/genai";
import { DubbingSegment } from "../types";

// Initialize the client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to convert File to Base64
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      resolve({
        inlineData: {
          data: base64Data,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000): Blob => {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF chunk
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const dataView = new Uint8Array(buffer, headerSize);
  dataView.set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
};

export const decodeAudioData = (base64String: string): string => {
  const byteCharacters = atob(base64String);
  const byteNumbers = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const wavBlob = pcmToWav(byteNumbers);
  return URL.createObjectURL(wavBlob);
};

// Internal type for the raw JSON response from Gemini
interface RawScriptSegment {
  timestamp: string; // "MM:SS"
  text: string;
  character_note?: string; 
}

// Helper to select a prebuilt voice based on description
const selectVoice = (note?: string): string => {
  if (!note) return 'Puck'; // Default Male
  const n = note.toLowerCase();

  // Voice Mapping Logic
  // Kore: Female, Calm/Standard
  // Puck: Male, Standard
  // Charon: Male, Deep
  // Fenrir: Male, Intense/Rough
  // Zephyr: Female, Soft (if available, fallback to Kore)

  if (n.match(/\b(girl|woman|female|she|lady|mother|mom|sister|daughter|aunt|grandma|soft|sweet|high|child|queen|princess)\b/)) {
    return 'Kore'; 
  }
  
  if (n.match(/\b(deep|low|gruff|monster|giant|evil|demon|tough|strong|bass)\b/)) {
    return 'Fenrir';
  }

  if (n.match(/\b(old|grandpa|wise|narrator|slow|calm|father|dad)\b/)) {
    return 'Charon';
  }

  // Default for boys, men, standard narration
  return 'Puck';
};

// Step 1: Generate Structured Script from Video
const generateScriptSegments = async (videoPart: any, instructions: string): Promise<RawScriptSegment[]> => {
  const modelId = "gemini-2.5-flash"; 
  
  // Relaxed prompt to allow creativity and narration if no direct text/dialogue exists
  const prompt = `
    You are a creative dubbing director. 
    Analyze the video and output a list of spoken lines synchronized to when they should appear.
    
    USER INSTRUCTIONS: ${instructions}

    GUIDELINES:
    1. **TEXT ON SCREEN**: Always read out any visible text clearly.
    2. **DIALOGUE**: If characters are present (people, animals, mascots), invent suitable dialogue for them based on their expressions and the User Instructions. 
       - e.g., if a cat meows, write "I'm so hungry!" if the style permits.
    3. **NARRATION**: If the instructions ask for narration or if there is no dialogue/text, describe the action or story in an engaging way.
    4. **TIMING**: Ensure the timestamp (MM:SS) matches the visual cue.
    5. **STYLE**: Do NOT act as a technical commentator (e.g., "The camera moves left"). Act as the voice of the characters or a narrator telling a story.
    6. **CHARACTER NOTES**: Critically important. You MUST specify the GENDER and TONE in the 'character_note' field so the correct voice is selected (e.g., 'soft female voice', 'deep male voice', 'energetic boy').

    Example Output format:
    [
      { "timestamp": "00:01", "text": "Hello world!", "character_note": "excited young boy" },
      { "timestamp": "00:05", "text": "I wonder where the red dot went...", "character_note": "confused soft female cat" }
    ]
  `;

  const response = await ai.models.generateContent({
    model: modelId,
    contents: {
      parts: [
        videoPart,
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            timestamp: { type: Type.STRING },
            text: { type: Type.STRING },
            character_note: { type: Type.STRING, description: "Mandatory voice instruction. Keywords: 'female', 'male', 'girl', 'boy', 'deep', 'soft', 'monster', etc." }
          },
          required: ["timestamp", "text", "character_note"]
        }
      }
    }
  });

  const jsonText = response.text;
  if (!jsonText) throw new Error("No script generated.");
  
  try {
    const parsed = JSON.parse(jsonText) as RawScriptSegment[];
    if (!Array.isArray(parsed)) throw new Error("Invalid script format");
    return parsed;
  } catch (e) {
    console.error("Failed to parse script JSON", jsonText);
    throw new Error("Failed to parse the script generated by the model.");
  }
};

// Helper to parse MM:SS to seconds
const parseTimestamp = (timeStr: string): number => {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  return 0;
};

// Helper for delay to prevent rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Step 2: Generate Audio for a single segment
const generateSegmentAudio = async (text: string, note?: string): Promise<string> => {
  const modelId = "gemini-2.5-flash-preview-tts";
  
  // Select the appropriate voice based on the note
  const selectedVoice = selectVoice(note);
  
  // Example: "Say in a soft little girl voice: Hello world"
  const prefix = note ? `Say in a ${note}: ` : "Say clearly: ";
  const prompt = `${prefix}${text}`;

  // console.log(`Generating audio: "${text}" | Voice: ${selectedVoice} | Note: ${note}`);

  const response = await ai.models.generateContent({
    model: modelId,
    contents: {
      parts: [{ text: prompt }]
    },
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: selectedVoice }
        }
      }
    }
  });

  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) throw new Error("TTS failed");
  
  const audioPart = candidates[0].content?.parts?.find(p => p.inlineData);
  if (!audioPart || !audioPart.inlineData) throw new Error("No audio data");

  return decodeAudioData(audioPart.inlineData.data);
};

export const generateDubbingTimeline = async (
  videoFile: File, 
  instructions: string
): Promise<DubbingSegment[]> => {
  try {
    const videoPart = await fileToGenerativePart(videoFile);

    // 1. Get the script with timestamps
    const rawSegments = await generateScriptSegments(videoPart, instructions);
    
    if (!rawSegments || rawSegments.length === 0) {
       throw new Error("No dialogue or narration lines were generated. Try adding more specific instructions like 'Narrate the scene'.");
    }

    // 2. Process TTS for each segment SEQUENTIALLY to avoid Rate Limits
    const validSegments = rawSegments.filter(s => s.text && s.text.trim().length > 0);
    const processedSegments: DubbingSegment[] = [];

    for (const seg of validSegments) {
        try {
            // Add a small delay between requests to be gentle on the API Rate Limiter
            await delay(500);
            
            const audioUrl = await generateSegmentAudio(seg.text, seg.character_note);
            processedSegments.push({
                startTime: parseTimestamp(seg.timestamp),
                text: seg.text,
                audioUrl: audioUrl
            });
        } catch (e) {
            console.error(`Skipping failed segment: "${seg.text}"`, e);
            // Continue to next segment so partial results are returned
        }
    }

    if (processedSegments.length === 0) {
        throw new Error("Audio generation failed for all segments. Please check API quota or model availability.");
    }

    return processedSegments;

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    let errorMessage = error.message || "Failed to generate dubbing.";
    
    if (errorMessage.includes("404")) {
       errorMessage += " (Model missing. Ensure API access to gemini-2.5-flash)";
    } else if (errorMessage.includes("429")) {
       errorMessage += " (Rate limit exceeded. Try a shorter video.)";
    }
    
    throw new Error(errorMessage);
  }
};
