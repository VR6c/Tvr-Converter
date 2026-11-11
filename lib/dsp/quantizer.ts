import type {
  ConverterSettings,
  GridDivision,
  KeyDetectionResult,
  TranscribedNote,
} from '@/types/audio-midi';
import { clamp } from '@/lib/utils';

export const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/** Semitone offsets from the tonic for each supported scale. */
export const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const SCALE_LABELS: Record<string, string> = {
  major: 'Major',
  minor: 'Natural Minor',
  harmonicMinor: 'Harmonic Minor',
  dorian: 'Dorian',
  mixolydian: 'Mixolydian',
  pentatonic: 'Pentatonic',
  chromatic: 'Chromatic',
};

export function noteNameToPitchClass(name: string): number {
  const idx = NOTE_NAMES.indexOf(name as (typeof NOTE_NAMES)[number]);
  return idx < 0 ? 0 : idx;
}

/* ---------------- Scale snapping ---------------- */

/** Nearest pitch (integer MIDI) whose pitch-class belongs to the scale. */
export function snapPitchToScale(
  pitch: number,
  rootPc: number,
  intervals: number[],
): number {
  const base = Math.round(pitch);
  const allowed = new Set(intervals.map((i) => (i + rootPc) % 12));

  for (let d = 0; d <= 6; d++) {
    const up = base + d;
    const down = base - d;
    if (d === 0) {
      if (allowed.has(((base % 12) + 12) % 12)) return base;
      continue;
    }
    if (allowed.has(((up % 12) + 12) % 12)) return up;
    if (allowed.has(((down % 12) + 12) % 12)) return down;
  }
  return base;
}

/* ---------------- Timing quantization ---------------- */

/** Seconds per subdivision step for a given BPM / division. */
export function gridStepSeconds(bpm: number, division: GridDivision): number {
  if (division === 'off') return 0;
  const div = division === '1/8' ? 8 : division === '1/16' ? 16 : 32;
  return (60 / bpm) * (4 / div);
}

export function quantizeTiming(
  notes: TranscribedNote[],
  bpm: number,
  division: GridDivision,
): TranscribedNote[] {
  const step = gridStepSeconds(bpm, division);
  if (step <= 0) return notes;

  return notes.map((n) => {
    const start = Math.round(n.startTime / step) * step;
    let dur = Math.round(n.duration / step) * step;
    if (dur < step) dur = step;
    return {
      ...n,
      startTime: Math.max(0, Number(start.toFixed(6))),
      duration: Number(dur.toFixed(6)),
    };
  });
}

/* ---------------- Key detection (Krumhansl-Schmuckler) ---------------- */

const KRUMHANSL_MAJOR = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const KRUMHANSL_MINOR = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

function correlate(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

export { detectTempo } from './tempo';
export type { DetectTempoOptions } from './tempo';

export function detectKey(notes: TranscribedNote[]): KeyDetectionResult {
  if (!notes || notes.length === 0) {
    return { root: 'C', scaleMode: 'major', confidence: 0 };
  }

  const histogram = new Array(12).fill(0);
  for (const n of notes) {
    const pc = ((Math.round(n.pitch) % 12) + 12) % 12;
    histogram[pc] += Math.max(0.05, n.duration) * (n.velocity ?? 0.8);
  }

  let best: KeyDetectionResult = { root: 'C', scaleMode: 'major', confidence: 0 };
  let bestScore = -Infinity;

  for (let root = 0; root < 12; root++) {
    const rotated = histogram.map((_, i) => histogram[(i + root) % 12]);
    for (const [mode, profile] of [
      ['major', KRUMHANSL_MAJOR],
      ['minor', KRUMHANSL_MINOR],
    ] as const) {
      const score = correlate(rotated, profile);
      if (score > bestScore) {
        bestScore = score;
        best = {
          root: NOTE_NAMES[root],
          scaleMode: mode,
          confidence: clamp(score, 0, 1),
        };
      }
    }
  }
  return best;
}

/* ---------------- Master correction pass ---------------- */

export function applyMusicalCorrections(
  baseNotes: TranscribedNote[],
  settings: ConverterSettings,
): TranscribedNote[] {
  let out = baseNotes.map((n) => ({ ...n }));

  // 1. Scale snapping
  if (settings.snapIntensity !== 'off') {
    const effectiveRoot =
      settings.keyRoot === 'auto' && baseNotes.length > 0
        ? detectKey(baseNotes).root
        : settings.keyRoot;
    const effectiveScale =
      settings.keyRoot === 'auto' && baseNotes.length > 0
        ? detectKey(baseNotes).scaleMode
        : settings.scaleMode;

    const rootPc = noteNameToPitchClass(effectiveRoot);
    const intervals =
      SCALE_INTERVALS[effectiveScale] ?? SCALE_INTERVALS.chromatic;

    out = out.map((n) => {
      const snapped = snapPitchToScale(n.pitch, rootPc, intervals);
      if (settings.snapIntensity === 'perfect') {
        return { ...n, pitch: snapped, pitchBendCents: undefined, pitchBend: undefined };
      }
      // 'soft' - anchor to the scale, retain the glide as pitch bend.
      const existing = n.pitchBendCents?.[0] ?? n.pitchBend?.[0] ?? 0;
      const cents = clamp((n.pitch - snapped) * 100 + existing, -100, 100);
      return {
        ...n,
        pitch: snapped,
        pitchBendCents: Math.abs(cents) > 1 ? [cents] : undefined,
        pitchBend: Math.abs(cents) > 1 ? [cents] : undefined,
      };
    });
  }

  // 2. Timing grid
  if (settings.gridDivision !== 'off') {
    out = quantizeTiming(out, settings.tempoBpm, settings.gridDivision);
  }

  // 3. Sanitize
  return out
    .filter((n) => n.duration > 0.02)
    .map((n) => ({
      ...n,
      pitch: clamp(Math.round(n.pitch), 0, 127),
      startTime: Math.max(0, n.startTime),
      velocity: clamp(n.velocity, 0.05, 1),
    }))
    .sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch);
}

