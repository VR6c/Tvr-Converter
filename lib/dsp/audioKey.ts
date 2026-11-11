import { fft } from './tempo';

export interface AudioKeyResult {
  key: string;
  scale: 'major' | 'minor';
  confidence: number;
}

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Temperley's key profiles: on produced pop audio they confuse a key with its
// dominant less often than the original Krumhansl-Kessler probe-tone ratings.
const MAJOR_PROFILE = [5, 2, 3.5, 2, 4.5, 4, 2, 4.5, 2, 3.5, 1.5, 4];
const MINOR_PROFILE = [5, 2, 3.5, 4.5, 2, 4, 2, 4.5, 3.5, 2, 1.5, 4];

// Long window: semitones are only ~3 Hz apart at the low end of the range.
const FRAME_SIZE = 16384;
const HOP = 8192;
const MIN_HZ = 55;
const MAX_HZ = 2000;
const PEAK_FLOOR = 0.05; // relative to the frame's strongest peak
const TUNING_BINS = 20;  // 5-cent resolution

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Key detection straight from audio: spectral-peak pitch class profile
 * (tuning-corrected) correlated against major/minor key profiles for all
 * 24 keys (the Krumhansl-Schmuckler method).
 */
export function detectKeyFromAudio(
  samples: Float32Array,
  sampleRate: number,
): AudioKeyResult | null {
  if (samples.length < FRAME_SIZE * 2) return null;

  const window = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
  }
  const binHz = sampleRate / FRAME_SIZE;
  const loBin = Math.max(2, Math.floor(MIN_HZ / binHz));
  const hiBin = Math.min(FRAME_SIZE / 2 - 2, Math.ceil(MAX_HZ / binHz));

  const re = new Float32Array(FRAME_SIZE);
  const im = new Float32Array(FRAME_SIZE);
  const mag = new Float32Array(hiBin + 2);

  // Spectral peaks per frame as (fractional MIDI pitch, weight)
  const frames: { pitch: number; weight: number }[][] = [];
  const tuningHist = new Float64Array(TUNING_BINS);

  for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP) {
    for (let i = 0; i < FRAME_SIZE; i++) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);

    let frameMax = 0;
    for (let b = loBin - 1; b <= hiBin + 1; b++) {
      mag[b] = Math.hypot(re[b], im[b]);
      if (mag[b] > frameMax) frameMax = mag[b];
    }
    if (frameMax < 1e-6) continue;

    const peaks: { pitch: number; weight: number }[] = [];
    for (let b = loBin; b <= hiBin; b++) {
      const m = mag[b];
      if (m < frameMax * PEAK_FLOOR || m <= mag[b - 1] || m < mag[b + 1]) continue;
      // Parabolic interpolation for sub-bin frequency
      const denom = mag[b - 1] - 2 * m + mag[b + 1];
      const offset = denom !== 0 ? (0.5 * (mag[b - 1] - mag[b + 1])) / denom : 0;
      const hz = (b + offset) * binHz;
      const pitch = 69 + 12 * Math.log2(hz / 440);
      // Linear magnitude keeps fundamentals ahead of their weaker overtones,
      // which would otherwise pull the estimate a fifth up.
      const weight = m / frameMax;
      peaks.push({ pitch, weight });

      const deviation = pitch - Math.round(pitch); // -0.5 .. 0.5 semitones
      const bin = Math.min(TUNING_BINS - 1, Math.floor((deviation + 0.5) * TUNING_BINS));
      tuningHist[bin] += weight;
    }
    if (peaks.length) frames.push(peaks);
  }
  if (frames.length < 2) return null;

  // Recordings are rarely at exactly A=440; shift by the dominant deviation.
  let tuningBin = 0;
  for (let i = 1; i < TUNING_BINS; i++) {
    if (tuningHist[i] > tuningHist[tuningBin]) tuningBin = i;
  }
  const tuning = (tuningBin + 0.5) / TUNING_BINS - 0.5;

  const profile = new Array<number>(12).fill(0);
  const chroma = new Float64Array(12);
  for (const peaks of frames) {
    chroma.fill(0);
    for (const { pitch, weight } of peaks) {
      const p = pitch - tuning;
      const nearest = Math.round(p);
      // Peaks far from a semitone centre are mostly noise/percussion
      const closeness = Math.cos(Math.PI * (p - nearest)) ** 2;
      chroma[((nearest % 12) + 12) % 12] += weight * closeness;
    }
    let max = 0;
    for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
    if (max > 0) for (let i = 0; i < 12; i++) profile[i] += chroma[i] / max;
  }

  let best = -Infinity;
  let runnerUp = -Infinity;
  let bestTonic = 0;
  let bestScale: 'major' | 'minor' = 'major';
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = profile.map((_, i) => profile[(i + tonic) % 12]);
    const candidates: ['major' | 'minor', number][] = [
      ['major', pearson(rotated, MAJOR_PROFILE)],
      ['minor', pearson(rotated, MINOR_PROFILE)],
    ];
    for (const [scale, score] of candidates) {
      if (score > best) {
        runnerUp = best;
        best = score;
        bestTonic = tonic;
        bestScale = scale;
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }
  }

  // Strong fit and a clear lead over the next candidate both raise confidence.
  const confidence =
    0.6 * Math.max(best, 0) + 0.4 * Math.min(1, (best - runnerUp) / 0.15);

  return {
    key: KEY_NAMES[bestTonic],
    scale: bestScale,
    confidence: Number(Math.min(1, Math.max(0, confidence)).toFixed(2)),
  };
}
