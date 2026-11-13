'use client';

import { create } from 'zustand';
import type {
  ConverterSettings,
  ExecutionProvider,
  TranscribedNote,
  WorkerResponse,
} from '@/types/audio-midi';
import {
  decodeAudioFile,
  isSupportedAudioFile,
} from '@/lib/audio/resampler';
import { applyMusicalCorrections, detectKey, detectTempo } from '@/lib/dsp/quantizer';
import { getInferenceWorker, onWorkerMessage } from '@/lib/worker/client';
import { notesToMidiBytes, saveMidiFile } from '@/lib/audio/midiWriter';

export const DEFAULT_SETTINGS: ConverterSettings = {
  mode: 'voice',
  sensitivity: 'mid',
  keyRoot: 'auto',
  scaleMode: 'major',
  snapIntensity: 'soft',
  gridDivision: '1/16',
  tempoBpm: 120,
  octaveOffset: 0,
};

export type AppStatus =
  | 'idle'
  | 'decoding'
  | 'transcribing'
  | 'ready'
  | 'error';

interface ConverterState {
  /* data */
  fileName: string | null;
  audioUrl: string | null;
  audioDuration: number;
  privateSamples: Float32Array | null;
  baseNotes: TranscribedNote[]; // raw inference output
  notes: TranscribedNote[];     // corrected / edited notes
  settings: ConverterSettings;
  provider: ExecutionProvider;
  status: AppStatus;
  progress: number;
  error: string | null;
  selectedNoteId: string | null;
  detectedKeyLabel: string | null;
  detectedTempoLabel: string | null;

  /* actions */
  loadFile: (file: File) => Promise<void>;
  loadBlob: (blob: Blob, name?: string) => Promise<void>;
  transcribe: () => Promise<void>;
  updateSettings: (patch: Partial<ConverterSettings>) => void;
  autoDetectKey: () => void;
  autoDetectTempo: () => void;
  commitNotes: (notes: TranscribedNote[]) => void;
  selectNote: (id: string | null) => void;
  exportMidi: () => Promise<void>;
  reset: () => void;
}

let unsubscribeWorker: (() => void) | null = null;
/** Id of the transcription whose results are still wanted; 0 = none. */
let activeJob = 0;
let jobCounter = 0;

const formatKeyLabel = (r: { root: string; scaleMode: string; confidence: number }) =>
  `${r.root} ${r.scaleMode === 'major' ? 'Major' : 'Minor'} · ${Math.round(r.confidence * 100)}%`;

const formatTempoLabel = (r: { bpm: number; confidence: number }) =>
  `${r.bpm} BPM · ${Math.round(r.confidence * 100)}%`;

export const useConverterStore = create<ConverterState>((set, get) => {
  /* ---------------- worker wiring ---------------- */
  const bindWorker = () => {
    if (unsubscribeWorker) return;
    getInferenceWorker();
    unsubscribeWorker = onWorkerMessage((raw) => {
      const msg = raw as WorkerResponse;

      // Drop results of superseded or cancelled jobs (new file loaded, reset).
      if ('jobId' in msg && msg.jobId !== undefined && msg.jobId !== activeJob) {
        return;
      }

      switch (msg.type) {
        case 'progress':
          set({ progress: msg.value });
          break;
        case 'provider':
          set({ provider: msg.provider });
          break;
        case 'result': {
          const rawNotes = msg.notes;
          const currentSettings = get().settings;
          const samples = get().privateSamples;

          // 1. Auto Key Detection
          let keyRoot = currentSettings.keyRoot;
          let scaleMode = currentSettings.scaleMode;
          let detectedKeyLabel: string | null = null;

          if (rawNotes.length > 0) {
            const keyRes = detectKey(rawNotes);
            detectedKeyLabel = formatKeyLabel(keyRes);

            // If keyRoot is 'auto', adopt detected key directly
            if (currentSettings.keyRoot === 'auto') {
              keyRoot = keyRes.root;
              scaleMode = keyRes.scaleMode;
            }
          }

          // 2. Auto Tempo Detection
          let tempoBpm = currentSettings.tempoBpm;
          let detectedTempoLabel: string | null = null;
          const tempoRes = detectTempo({
            samples: samples ?? undefined,
            sampleRate: 22050,
            notes: rawNotes,
          });

          if (tempoRes.confidence > 0) {
            tempoBpm = tempoRes.bpm;
            detectedTempoLabel = formatTempoLabel(tempoRes);
          }

          const newSettings: ConverterSettings = {
            ...currentSettings,
            keyRoot,
            scaleMode,
            tempoBpm,
          };

          const corrected = applyMusicalCorrections(
            rawNotes,
            newSettings,
          );

          activeJob = 0;
          set({
            baseNotes: rawNotes,
            notes: corrected,
            settings: newSettings,
            detectedKeyLabel,
            detectedTempoLabel,
            status: 'ready',
            progress: 1,
            error: null,
          });
          break;
        }
        case 'error':
          activeJob = 0;
          set({ status: 'error', error: msg.message, progress: 0 });
          break;
      }
    });
  };

  return {
    fileName: null,
    audioUrl: null,
    audioDuration: 0,
    privateSamples: null,
    baseNotes: [],
    notes: [],
    settings: DEFAULT_SETTINGS,
    provider: 'unknown',
    status: 'idle',
    progress: 0,
    error: null,
    selectedNoteId: null,
    detectedKeyLabel: null,
    detectedTempoLabel: null,

    /* ---------------- file intake ---------------- */
    async loadFile(file: File) {
      if (!isSupportedAudioFile(file)) {
        set({
          status: 'error',
          error:
            'Unsupported file. Use WAV, MP3, M4A, AAC, FLAC or OGG under 100 MB.',
        });
        return;
      }

      const previousUrl = get().audioUrl;
      if (previousUrl) URL.revokeObjectURL(previousUrl);

      activeJob = 0; // cancel any in-flight transcription of the previous file
      set({
        status: 'decoding',
        error: null,
        progress: 0,
        fileName: file.name,
        privateSamples: null,
        audioDuration: 0,
        selectedNoteId: null,
        notes: [],
        baseNotes: [],
        detectedKeyLabel: null,
        detectedTempoLabel: null,
        audioUrl: URL.createObjectURL(file),
      });

      try {
        const decoded = await decodeAudioFile(file);
        set({
          privateSamples: decoded.samples,
          audioDuration: decoded.duration,
          status: 'idle',
        });
        await get().transcribe();
      } catch (err) {
        set({
          status: 'error',
          error:
            err instanceof Error
              ? `Could not decode audio: ${err.message}`
              : 'Could not decode audio.',
        });
      }
    },

    async loadBlob(blob: Blob, name = 'recording.webm') {
      const file = new File([blob], name, {
        type: blob.type || 'audio/webm',
      });
      await get().loadFile(file);
    },

    /* ---------------- inference ---------------- */
    async transcribe() {
      const samples = get().privateSamples;
      if (!samples) return;

      bindWorker();
      const worker = getInferenceWorker();
      if (!worker) {
        set({ status: 'error', error: 'Web Worker unavailable in this browser.' });
        return;
      }

      activeJob = ++jobCounter;
      set({ status: 'transcribing', progress: 0.01, error: null });

      // Transfer a copy so the store keeps its own buffer intact.
      const copy = samples.slice();
      worker.postMessage(
        {
          type: 'transcribe',
          jobId: activeJob,
          samples: copy,
          sampleRate: 22050,
          settings: get().settings,
        },
        [copy.buffer],
      );
    },

    /* ---------------- settings ---------------- */
    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      const corrected = applyMusicalCorrections(get().baseNotes, settings);
      set({ settings, notes: corrected });
    },

    autoDetectKey() {
      const source = get().baseNotes.length ? get().baseNotes : get().notes;
      if (!source.length) return;
      const result = detectKey(source);
      const settings: ConverterSettings = {
        ...get().settings,
        keyRoot: result.root,
        scaleMode: result.scaleMode,
      };
      set({
        settings,
        notes: applyMusicalCorrections(get().baseNotes, settings),
        detectedKeyLabel: formatKeyLabel(result),
      });
    },

    autoDetectTempo() {
      const samples = get().privateSamples;
      const source = get().baseNotes.length ? get().baseNotes : get().notes;
      if (!source.length && !samples) return;
      const result = detectTempo({
        samples: samples ?? undefined,
        sampleRate: 22050,
        notes: source,
      });
      const settings: ConverterSettings = {
        ...get().settings,
        tempoBpm: result.bpm,
      };
      set({
        settings,
        notes: applyMusicalCorrections(get().baseNotes, settings),
        detectedTempoLabel: formatTempoLabel(result),
      });
    },

    /* ---------------- editing ---------------- */
    commitNotes(notes) {
      // Edits are written back into the base layer so that subsequent
      // scale/grid changes operate on the user's intent.
      set({ notes, baseNotes: notes });
    },

    selectNote(id) {
      set({ selectedNoteId: id });
    },

    /* ---------------- export ---------------- */
    async exportMidi() {
      const { notes, settings, fileName } = get();
      if (!notes.length) return;
      const base = (fileName ?? 'transcription').replace(/\.[^.]+$/, '');
      await saveMidiFile(
        () => notesToMidiBytes(notes, settings),
        `${base}-transcription.mid`,
      );
    },

    reset() {
      activeJob = 0;
      const url = get().audioUrl;
      if (url) URL.revokeObjectURL(url);
      set({
        fileName: null,
        audioUrl: null,
        audioDuration: 0,
        privateSamples: null,
        baseNotes: [],
        notes: [],
        status: 'idle',
        progress: 0,
        error: null,
        selectedNoteId: null,
        detectedKeyLabel: null,
        detectedTempoLabel: null,
      });
    },
  };
});

