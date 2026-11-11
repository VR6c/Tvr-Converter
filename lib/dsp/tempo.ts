import type { TranscribedNote, TempoDetectionResult } from '@/types/audio-midi';
import { clamp } from '@/lib/utils';

export interface DetectTempoOptions {
  samples?: Float32Array | null;
  sampleRate?: number;
  notes?: TranscribedNote[];
  minBpm?: number;
  maxBpm?: number;
}

const FRAME_SIZE = 512;
const HOP = 256;
const BPM_STEP = 0.25;
// Metrical levels summed for each candidate beat rate (beat, 8ths, triplets, 16ths, ...)
const HARMONICS: { mult: number; weight: number }[] = [
  { mult: 1, weight: 1 },
  { mult: 2, weight: 1 },
  { mult: 3, weight: 0.5 },
  { mult: 4, weight: 1 },
  { mult: 6, weight: 0.5 },
  { mult: 8, weight: 0.5 },
];
const MAX_HARMONIC = 8;
// Window used for the drift-tolerant coarse estimate (~48s at 22.05kHz)
const COARSE_WINDOW = 4096;

/* ---------------- FFT ---------------- */

/** In-place iterative radix-2 FFT. Length must be a power of two. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xRe = re[b] * curRe - im[b] * curIm;
        const xIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - xRe;
        im[b] = im[a] - xIm;
        re[a] += xRe;
        im[a] += xIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

/* ---------------- Onset envelopes ---------------- */

/** Subtract a ~0.5s moving average and half-wave rectify. */
function removeLocalMean(env: Float32Array, fps: number): Float32Array {
  const n = env.length;
  const half = Math.max(1, Math.round(fps * 0.25));
  const out = new Float32Array(n);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let f = 0; f < n; f++) {
    const start = Math.max(0, f - half);
    const end = Math.min(n - 1, f + half);
    while (hi < end) sum += env[++hi];
    while (lo < start) sum -= env[lo++];
    out[f] = Math.max(0, env[f] - sum / (hi - lo + 1));
  }
  return out;
}

/** Log-compressed spectral flux: reacts to pitch/timbre changes, not just loudness. */
function spectralFluxEnvelope(samples: Float32Array): Float32Array | null {
  const numFrames = Math.floor((samples.length - FRAME_SIZE) / HOP);
  if (numFrames < 64) return null;

  const window = hann(FRAME_SIZE);
  const bins = FRAME_SIZE / 2;
  const re = new Float32Array(FRAME_SIZE);
  const im = new Float32Array(FRAME_SIZE);
  let prev = new Float32Array(bins);
  let cur = new Float32Array(bins);
  const flux = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP;
    for (let i = 0; i < FRAME_SIZE; i++) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let b = 1; b < bins; b++) {
      const mag = Math.log1p(100 * Math.sqrt(re[b] * re[b] + im[b] * im[b]));
      cur[b] = mag;
      const diff = mag - prev[b];
      if (diff > 0) sum += diff;
    }
    if (f > 0) flux[f] = sum;
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return flux;
}

/** Velocity-weighted impulse train of note onsets, at the same frame rate as the audio envelope. */
function noteOnsetEnvelope(
  notes: TranscribedNote[],
  fps: number,
): Float32Array | null {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.startTime);
  const numFrames = Math.ceil(end * fps) + 8;
  if (numFrames < 64) return null;

  const env = new Float32Array(numFrames);
  for (const n of notes) {
    const pos = n.startTime * fps;
    const v = n.velocity ?? 0.8;
    const center = Math.round(pos);
    // Small Gaussian so sub-frame onset timing is preserved
    for (let f = center - 3; f <= center + 3; f++) {
      if (f < 0 || f >= numFrames) continue;
      const d = f - pos;
      // max(), not +=, so chords count as a single onset
      env[f] = Math.max(env[f], v * Math.exp(-(d * d) / 2));
    }
  }
  return env;
}

/* ---------------- Periodicity analysis ---------------- */

interface Spectrum {
  mag: Float32Array;
  /** Spectrum bins per BPM */
  binsPerBpm: number;
}

function normalizeSpectrum(mag: Float32Array, binsPerBpm: number): void {
  // Whiten by the median so scores are comparable across sources
  const lo = Math.max(1, Math.floor(30 * binsPerBpm));
  const hi = Math.min(mag.length, Math.ceil(2000 * binsPerBpm));
  if (hi <= lo) return;
  const sorted = Array.from(mag.subarray(lo, hi)).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] || 1;
  for (let i = 0; i < mag.length; i++) mag[i] /= median;
}

/** Magnitude spectrum of the envelope, averaged over half-overlapping windows. */
function envelopeSpectrum(
  env: Float32Array,
  fps: number,
  windowLen: number,
): Spectrum {
  const n = env.length;
  const winLen = Math.min(windowLen, n);
  const size = nextPow2(winLen * 4);
  const window = hann(winLen);
  const mag = new Float32Array(size / 2);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const step = Math.max(1, winLen >> 1);

  for (let start = 0; start + winLen <= n; start += step) {
    let mean = 0;
    for (let i = 0; i < winLen; i++) mean += env[start + i];
    mean /= winLen;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < winLen; i++) {
      re[i] = (env[start + i] - mean) * window[i];
    }
    fft(re, im);
    for (let b = 0; b < mag.length; b++) {
      mag[b] += Math.sqrt(re[b] * re[b] + im[b] * im[b]);
    }
  }

  const binsPerBpm = size / (fps * 60);
  normalizeSpectrum(mag, binsPerBpm);
  return { mag, binsPerBpm };
}

function magAt(spec: Spectrum, bpm: number): number {
  const pos = bpm * spec.binsPerBpm;
  const i = Math.floor(pos);
  if (i < 0 || i + 1 >= spec.mag.length) return 0;
  const frac = pos - i;
  return spec.mag[i] * (1 - frac) + spec.mag[i + 1] * frac;
}

function harmonicScore(spec: Spectrum, bpm: number): number {
  let score = 0;
  for (const h of HARMONICS) score += h.weight * magAt(spec, bpm * h.mult);
  return score;
}

/** Human tempo preference (log-Gaussian around 120 BPM) to resolve octave ambiguity. */
function tempoPrior(bpm: number): number {
  const oct = Math.log2(bpm / 120);
  return 0.5 + 0.5 * Math.exp(-(oct * oct) / (2 * 0.7 * 0.7));
}

/**
 * Detect musical tempo (BPM) from raw audio samples and/or transcribed note onsets.
 *
 * 1. Build onset envelopes: spectral flux of the audio, and an impulse train of note onsets.
 * 2. Take the Fourier spectrum of each envelope (a "tempogram"): a steady pulse shows up
 *    as peaks at the beat rate and its subdivisions.
 * 3. Score each candidate BPM by summing spectrum energy over its metrical levels,
 *    weighted by a human tempo prior to pick the right octave.
 * 4. Refine the winner against the full-length spectrum for sub-BPM precision.
 */
export function detectTempo(options: DetectTempoOptions): TempoDetectionResult {
  const {
    samples,
    sampleRate = 22050,
    notes,
    minBpm = 50,
    maxBpm = 210,
  } = options;

  const fps = sampleRate / HOP;
  const envelopes: { env: Float32Array; weight: number }[] = [];

  if (samples && samples.length >= sampleRate * 1.5) {
    const flux = spectralFluxEnvelope(samples);
    if (flux) envelopes.push({ env: removeLocalMean(flux, fps), weight: 0.6 });
  }
  if (notes && notes.length >= 3) {
    const env = noteOnsetEnvelope(notes, fps);
    if (env) envelopes.push({ env, weight: 0.4 });
  }

  if (envelopes.length === 0) {
    return { bpm: 120, bpmExact: 120, confidence: 0 };
  }

  const totalWeight = envelopes.reduce((acc, e) => acc + e.weight, 0);
  const sources = envelopes.map((e) => ({
    weight: e.weight / totalWeight,
    coarse: envelopeSpectrum(e.env, fps, COARSE_WINDOW),
    fine: envelopeSpectrum(e.env, fps, e.env.length),
  }));

  // Keep every harmonic below the envelope's Nyquist rate
  const hiBpm = Math.min(maxBpm, (fps * 60) / 2 / MAX_HARMONIC);

  /* ---------------- Coarse search ---------------- */
  let bestBpm = 120;
  let bestScore = -Infinity;
  const scores: number[] = [];

  for (let bpm = minBpm; bpm <= hiBpm; bpm += BPM_STEP) {
    let score = 0;
    for (const s of sources) score += s.weight * harmonicScore(s.coarse, bpm);
    score *= tempoPrior(bpm);
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  /* ---------------- Fine refinement ---------------- */
  let refinedBpm = bestBpm;
  let refinedScore = -Infinity;
  const span = bestBpm * 0.015;
  for (let bpm = bestBpm - span; bpm <= bestBpm + span; bpm += 0.02) {
    let score = 0;
    for (const s of sources) score += s.weight * harmonicScore(s.fine, bpm);
    if (score > refinedScore) {
      refinedScore = score;
      refinedBpm = bpm;
    }
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] ?? 0;
  const confidence = clamp((bestScore - median) / (bestScore || 1), 0, 1);

  return {
    bpm: clamp(Math.round(refinedBpm), minBpm, maxBpm),
    bpmExact: Number(refinedBpm.toFixed(1)),
    confidence: Number(confidence.toFixed(2)),
  };
}
