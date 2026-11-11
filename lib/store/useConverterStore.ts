'use client';

import { create } from 'zustand';
import type {
  ConverterSettings,
  ExecutionProvider,
  TranscribedNote,
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
  audioPeaks: Float32Array | null;
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
  autoDetectAll: () => void;
  commitNotes: (notes: TranscribedNote[]) => void;
  selectNote: (id: string | null) => void;
  exportMidi: () => Promise<void>;
  reset: () => void;
}

let unsubscribeWorker: (() => void) | null = null;

export const useConverterStore = create<ConverterState>((set, get) => {
  /* ---------------- worker wiring ---------------- */
  const bindWorker = () => {
    if (unsubscribeWorker) return;
    getInferenceWorker();
    unsubscribeWorker = onWorkerMessage((raw) => {
      const msg = raw as
        | { type: 'progress'; value: number }
        | { type: 'provider'; provider: ExecutionProvider }
        | { type: 'result'; notes: TranscribedNote[] }
        | { type: 'error'; message: string };

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
            detectedKeyLabel = `${keyRes.root} ${
              keyRes.scaleMode === 'major' ? 'Major' : 'Minor'
            } · ${Math.round(keyRes.confidence * 100)}%`;

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

          if (tempoRes && tempoRes.confidence > 0) {
            tempoBpm = tempoRes.bpm;
            detectedTempoLabel = `${tempoRes.bpm} BPM · ${Math.round(tempoRes.confidence * 100)}%`;
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
          set({ status: 'error', error: msg.message, progress: 0 });
          break;
      }
    });
  };

  return {
    fileName: null,
    audioUrl: null,
    audioDuration: 0,
    audioPeaks: null,
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

      set({
        status: 'decoding',
        error: null,
        progress: 0,
        fileName: file.name,
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
          audioPeaks: decoded.peaks,
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

      set({ status: 'transcribing', progress: 0.01, error: null });

      // Transfer a copy so the store keeps its own buffer intact.
      const copy = samples.slice();
      worker.postMessage(
        {
          type: 'transcribe',
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
        detectedKeyLabel: `${result.root} ${
          result.scaleMode === 'major' ? 'Major' : 'Minor'
        } · ${Math.round(result.confidence * 100)}%`,
      });
    },

    autoDetectTempo() {
      const samples = get().privateSamples;
      const source = get().baseNotes.length ? get().baseNotes : get().notes;
      const result = detectTempo({
        samples: samples ?? undefined,
        sampleRate: 22050,
        notes: source,
      });
      if (result.confidence <= 0 && !source.length && !samples) return;
      const settings: ConverterSettings = {
        ...get().settings,
        tempoBpm: result.bpm,
      };
      set({
        settings,
        notes: applyMusicalCorrections(get().baseNotes, settings),
        detectedTempoLabel: `${result.bpm} BPM · ${Math.round(result.confidence * 100)}%`,
      });
    },

    autoDetectAll() {
      get().autoDetectKey();
      get().autoDetectTempo();
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
      const bytes = notesToMidiBytes(notes, settings);
      const base = (fileName ?? 'transcription').replace(/\.[^.]+$/, '');
      await saveMidiFile(bytes, `${base}-transcription.mid`);
    },

    reset() {
      const url = get().audioUrl;
      if (url) URL.revokeObjectURL(url);
      set({
        fileName: null,
        audioUrl: null,
        audioDuration: 0,
        audioPeaks: null,
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

