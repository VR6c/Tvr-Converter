'use client';

import * as Tone from 'tone';
import type { TranscribedNote } from '@/types/audio-midi';
import { clamp } from '@/lib/utils';

interface PartEvent {
  time: number;
  pitch: number;
  duration: number;
  velocity: number;
}

let synth: Tone.PolySynth<Tone.Synth> | null = null;
let volumeNode: Tone.Volume | null = null;
let currentPart: Tone.Part<PartEvent> | null = null;
let currentNotes: TranscribedNote[] = [];
let currentOctaveOffset = 0;

export function getSynth(): Tone.PolySynth<Tone.Synth> {
  if (!synth) {
    volumeNode = new Tone.Volume(-6).toDestination();
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0.5, release: 0.25 },
    }).connect(volumeNode);
    synth.maxPolyphony = 32;
  }
  return synth;
}

export function setSynthVolume(db: number) {
  if (!volumeNode) getSynth();
  volumeNode?.volume.rampTo(db, 0.05);
}

export async function unlockAudio(): Promise<void> {
  if (Tone.getContext().state !== 'running') {
    await Tone.start();
  }
}

export const midiToNoteName = (midi: number): string =>
  Tone.Frequency(clamp(Math.round(midi), 0, 127), 'midi').toNote();

export function previewNote(pitch: number, duration = 0.2, velocity = 0.8): void {
  const s = getSynth();
  s.triggerAttackRelease(
    midiToNoteName(pitch),
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

  if (!notes.length) return;

  const s = getSynth();
  const octave = clamp(Math.round(octaveOffset), -2, 2) * 12;

  const events = notes
    .filter((n) => !n.muted)
    .map((n) => ({
      time: Math.max(0, n.startTime),
      pitch: clamp(n.pitch + octave, 0, 127),
      duration: Math.max(0.03, n.duration),
      velocity: clamp(n.velocity, 0.05, 1),
    }));

  const part = new Tone.Part<PartEvent>((time, note) => {
    s.triggerAttackRelease(
      midiToNoteName(note.pitch),
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
  const s = getSynth();
  s.releaseAll();

  syncAuditionNotes(notes, opts.octaveOffset);

  const from = Math.max(0, opts.fromTime);
  Tone.Transport.seconds = from;

  if (Tone.Transport.state !== 'started') {
    Tone.Transport.start();
  }

  // Note chasing: if fromTime falls inside an active note, trigger its remainder
  const octave = clamp(Math.round(opts.octaveOffset), -2, 2) * 12;
  for (const n of notes) {
    if (n.muted) continue;
    if (n.startTime < from && n.startTime + n.duration > from + 0.05) {
      const remaining = n.startTime + n.duration - from;
      s.triggerAttackRelease(
        midiToNoteName(n.pitch + octave),
        remaining,
        Tone.now() + 0.01,
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
  if (Tone.Transport.state === 'started') {
    Tone.Transport.pause();
  }
  synth?.releaseAll();
}

export function stopAudition(): void {
  if (Tone.Transport.state !== 'stopped') {
    Tone.Transport.stop();
  }
  Tone.Transport.seconds = 0;
  synth?.releaseAll();
}

export function seekAudition(toTime: number): void {
  const t = Math.max(0, toTime);
  Tone.Transport.seconds = t;
  synth?.releaseAll();

  // If transport is actively playing, chase any note spanning toTime
  if (Tone.Transport.state === 'started' && currentNotes.length > 0) {
    const s = getSynth();
    const octave = clamp(Math.round(currentOctaveOffset), -2, 2) * 12;
    for (const n of currentNotes) {
      if (n.muted) continue;
      if (n.startTime < t && n.startTime + n.duration > t + 0.05) {
        const remaining = n.startTime + n.duration - t;
        s.triggerAttackRelease(
          midiToNoteName(n.pitch + octave),
          remaining,
          Tone.now() + 0.01,
          clamp(n.velocity, 0.05, 1),
        );
      }
    }
  }
}

export function getAuditionTime(): number {
  return Tone.Transport.seconds;
}


