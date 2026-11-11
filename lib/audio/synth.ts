'use client';

import type * as ToneNS from 'tone';
import type { TranscribedNote } from '@/types/audio-midi';
import { clamp } from '@/lib/utils';

interface PartEvent {
  time: number;
  pitch: number;
  duration: number;
  velocity: number;
}

/**
 * Tone.js is ~250 kB, so it is loaded on demand (idle preload or first
 * play) instead of in the initial bundle. Until then the transport
 * functions below are no-ops.
 */
let Tone: typeof ToneNS | null = null;
let tonePromise: Promise<typeof ToneNS> | null = null;

function loadTone(): Promise<typeof ToneNS> {
  tonePromise ??= import('tone').then((mod) => (Tone = mod));
  return tonePromise;
}

/** Warm the Tone.js chunk without touching the AudioContext. */
export function preloadAudio(): void {
  void loadTone();
}

let synth: ToneNS.PolySynth<ToneNS.Synth> | null = null;
let volumeNode: ToneNS.Volume | null = null;
let volumeDb = -6;
let currentPart: ToneNS.Part<PartEvent> | null = null;
let currentNotes: TranscribedNote[] = [];
let currentOctaveOffset = 0;

function getSynth(T: typeof ToneNS): ToneNS.PolySynth<ToneNS.Synth> {
  if (!synth) {
    volumeNode = new T.Volume(volumeDb).toDestination();
    synth = new T.PolySynth(T.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0.5, release: 0.25 },
    }).connect(volumeNode);
    synth.maxPolyphony = 32;
  }
  return synth;
}

export function setSynthVolume(db: number) {
  volumeDb = db;
  volumeNode?.volume.rampTo(db, 0.05);
}

export async function unlockAudio(): Promise<void> {
  const T = await loadTone();
  if (T.getContext().state !== 'running') {
    await T.start();
  }
}

const midiToNoteName = (T: typeof ToneNS, midi: number): string =>
  T.Frequency(clamp(Math.round(midi), 0, 127), 'midi').toNote();

export function previewNote(pitch: number, duration = 0.2, velocity = 0.8): void {
  if (!Tone) {
    void unlockAudio().then(() => previewNote(pitch, duration, velocity));
    return;
  }
  const s = getSynth(Tone);
  s.triggerAttackRelease(
    midiToNoteName(Tone, pitch),
    duration,
    undefined,
    clamp(velocity, 0.05, 1),
  );
}

/**
 * Re-bind notes and octave offset to Tone.Part on Tone.Transport
 */
export function syncAuditionNotes(
  notes: TranscribedNote[],
  octaveOffset: number,
): void {
  currentNotes = notes;
  currentOctaveOffset = octaveOffset;

  if (currentPart) {
    currentPart.dispose();
    currentPart = null;
  }

  if (!notes.length || !Tone) return;

  const T = Tone;
  const s = getSynth(T);
  const octave = clamp(Math.round(octaveOffset), -2, 2) * 12;

  const events = notes
    .filter((n) => !n.muted)
    .map((n) => ({
      time: Math.max(0, n.startTime),
      pitch: clamp(n.pitch + octave, 0, 127),
      duration: Math.max(0.03, n.duration),
      velocity: clamp(n.velocity, 0.05, 1),
    }));

  const part = new T.Part<PartEvent>((time, note) => {
    s.triggerAttackRelease(
      midiToNoteName(T, note.pitch),
      note.duration,
      time,
      note.velocity,
    );
  }, events);

  part.start(0);
  currentPart = part;
}

export interface ScheduleOptions {
  octaveOffset: number;
  fromTime: number; // seconds into timeline where playback begins
  onEnd?: () => void;
}

/**
 * Schedule notes on Tone.Transport and begin playback from `fromTime`.
 */
export function scheduleAudition(
  notes: TranscribedNote[],
  opts: ScheduleOptions,
): number {
  if (!Tone) return 0;
  const T = Tone;
  const s = getSynth(T);
  s.releaseAll();

  syncAuditionNotes(notes, opts.octaveOffset);

  const from = Math.max(0, opts.fromTime);
  T.Transport.seconds = from;

  if (T.Transport.state !== 'started') {
    T.Transport.start();
  }

  // Note chasing: if fromTime falls inside an active note, trigger its remainder
  const octave = clamp(Math.round(opts.octaveOffset), -2, 2) * 12;
  for (const n of notes) {
    if (n.muted) continue;
    if (n.startTime < from && n.startTime + n.duration > from + 0.05) {
      const remaining = n.startTime + n.duration - from;
      s.triggerAttackRelease(
        midiToNoteName(T, n.pitch + octave),
        remaining,
        T.now() + 0.01,
        clamp(n.velocity, 0.05, 1),
      );
    }
  }

  const latest = notes.reduce(
    (max, n) => Math.max(max, n.startTime + n.duration),
    0,
  );
  return latest;
}

export function pauseAudition(): void {
  if (Tone?.Transport.state === 'started') {
    Tone.Transport.pause();
  }
  synth?.releaseAll();
}

export function stopAudition(): void {
  if (!Tone) return;
  if (Tone.Transport.state !== 'stopped') {
    Tone.Transport.stop();
  }
  Tone.Transport.seconds = 0;
  synth?.releaseAll();
}

export function seekAudition(toTime: number): void {
  if (!Tone) return;
  const T = Tone;
  const t = Math.max(0, toTime);
  T.Transport.seconds = t;
  synth?.releaseAll();

  // If transport is actively playing, chase any note spanning toTime
  if (T.Transport.state === 'started' && currentNotes.length > 0) {
    const s = getSynth(T);
    const octave = clamp(Math.round(currentOctaveOffset), -2, 2) * 12;
    for (const n of currentNotes) {
      if (n.muted) continue;
      if (n.startTime < t && n.startTime + n.duration > t + 0.05) {
        const remaining = n.startTime + n.duration - t;
        s.triggerAttackRelease(
          midiToNoteName(T, n.pitch + octave),
          remaining,
          T.now() + 0.01,
          clamp(n.velocity, 0.05, 1),
        );
      }
    }
  }
}

export function getAuditionTime(): number {
  return Tone?.Transport.seconds ?? 0;
}


