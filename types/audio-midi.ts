export interface TranscribedNote {
  id: string;
  pitch: number;             // MIDI note number (0-127)
  startTime: number;         // seconds from t=0
  duration: number;          // seconds
  velocity: number;          // 0.0 - 1.0
  pitchBend?: number[];      // Microtonal pitch bend values
  pitchBendCents?: number[]; // Microtonal deviation, -100..+100 cents
  muted?: boolean;           // Muted note (silenced from playback and export)
}

export type ProcessingMode = 'voice' | 'instrument';
export type SensitivityLevel = 'low' | 'mid' | 'high';
export type SnapIntensity = 'off' | 'soft' | 'perfect';
export type GridDivision = 'off' | '1/8' | '1/16' | '1/32';
export type ExecutionProvider = 'webgpu' | 'wasm' | 'unknown';

export interface ConverterSettings {
  mode: ProcessingMode;
  sensitivity: SensitivityLevel;
  keyRoot: string;      // 'C' | 'C#' | ... | 'B' | 'auto'
  scaleMode: string;    // 'major' | 'minor' | 'harmonicMinor' | 'dorian' | 'mixolydian' | 'pentatonic' | 'chromatic'
  snapIntensity: SnapIntensity;
  gridDivision: GridDivision;
  tempoBpm: number;     // 40 - 240
  octaveOffset: number; // -2 .. +2
}

export interface KeyDetectionResult {
  root: string;
  scaleMode: string;
  confidence: number;
}

export interface TempoDetectionResult {
  bpm: number;
  bpmExact: number;
  confidence: number;
}

/* ---------------- Worker protocol ---------------- */
export interface TranscribeRequest {
  type: 'transcribe';
  samples: Float32Array;
  sampleRate: number;
  settings: ConverterSettings;
}

export type WorkerRequest = TranscribeRequest;

export type WorkerResponse =
  | { type: 'progress'; value: number }
  | { type: 'provider'; provider: ExecutionProvider }
  | { type: 'result'; notes: TranscribedNote[] }
  | { type: 'error'; message: string };

