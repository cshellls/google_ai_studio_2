export enum AppState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface DubbingSegment {
  startTime: number; // in seconds
  text: string;
  audioUrl: string;
}

export interface VoiceInstruction {
  character: string;
  voiceDescription: string;
}

export type ProcessingError = {
  message: string;
  details?: string;
}