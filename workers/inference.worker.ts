/// <reference lib="webworker" />

import type {
  ConverterSettings,
  TranscribedNote,
  WorkerRequest,
  WorkerResponse,
} from '@/types/audio-midi';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/* ---------------- Constants ---------------- */
const ONSET_THRESHOLD: Record<string, number> = {
  low: 0.65,
  mid: 0.5,
  high: 0.35,
};

const MIN_NOTE_SECONDS = 0.06; // FR-2.5 - discard < 60 ms
const SMOOTH_GAP_SECONDS = 0.035;
const YIN_FRAME = 1024; // @ 11,025 Hz (decimated x2)
const YIN_W = 512;
const POLY_FFT = 4096;
const POLY_HOP = 512;
const ONNX_URL = '/models/basic-pitch.onnx';

/* ---------------- Messaging helpers ---------------- */
const post = (msg: WorkerResponse) => ctx.postMessage(msg);
let currentJob = 0;
const progress = (v: number) =>
  post({ type: 'progress', jobId: currentJob, value: Math.min(1, Math.max(0, v)) });

/* ---------------- ONNX Runtime (dynamic, optional) ---------------- */
type OrtModule = typeof import('onnxruntime-web');
let ortModule: OrtModule | null = null;
let ortSession: import('onnxruntime-web').InferenceSession | null = null;
let ortTried = false;
let provider: 'webgpu' | 'wasm' = 'wasm';

async function getOrtSession(): Promise<import('onnxruntime-web').InferenceSession | null> {
  if (ortTried) return ortSession;
  ortTried = true;

  try {
    const head = await fetch(ONNX_URL, { method: 'HEAD' });
    if (!head.ok) {
      post({ type: 'provider', provider: 'wasm' });
      return null;
    }

    const ortUrl = '/ort/ort.all.bundle.min.mjs';
    const mod = (await import(/* webpackIgnore: true */ ortUrl)) as any;
    const ort: OrtModule = (ortModule = (mod.default ?? mod) as OrtModule);
    ort.env.wasm.numThreads = Math.max(
      1,
      Math.min(4, (navigator.hardwareConcurrency || 4) - 1),
    );
    ort.env.wasm.simd = true;
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.logLevel = 'error';

    const buffer = await (await fetch(ONNX_URL)).arrayBuffer();

    // Preferred path: WebGPU
    try {
      ortSession = await ort.InferenceSession.create(buffer, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
      });
      provider = 'webgpu';
      post({ type: 'provider', provider: 'webgpu' });
      return ortSession;
    } catch (gpuErr) {
      console.warn('[worker] WebGPU init failed, falling back to WASM', gpuErr);
    }

    // Fallback: multithreaded WASM + SIMD
    ortSession = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    provider = 'wasm';
    post({ type: 'provider', provider: 'wasm' });
    return ortSession;
  } catch (err) {
    console.warn('[worker] ONNX unavailable, using built-in DSP engine', err);
    post({ type: 'provider', provider: 'wasm' });
    return null;
  }
}

/* ---------------- FFT (iterative radix-2) ---------------- */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
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
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;

        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;

        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

/* ---------------- YIN monophonic pitch detection ---------------- */
interface YinResult {
  f0: number;
  confidence: number;
  rms: number;
}

function yinFrame(
  frame: Float32Array,
  sr: number,
  fmin: number,
  fmax: number,
): YinResult {
  const n = frame.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += frame[i] * frame[i];
  rms = Math.sqrt(rms / n);

  const tauMin = Math.max(2, Math.floor(sr / fmax));
  const tauMax = Math.min(n - YIN_W - 1, Math.ceil(sr / fmin));
  if (tauMax <= tauMin) return { f0: 0, confidence: 0, rms };

  const d = new Float32Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < YIN_W; i++) {
      const diff = frame[i] - frame[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax + 1);
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }

  const THRESH = 0.15;
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < THRESH) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      best = tau;
      break;
    }
  }

  if (best === -1) {
    let minVal = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < minVal) {
        minVal = cmnd[tau];
        best = tau;
      }
    }
    if (minVal > 0.35) return { f0: 0, confidence: 0, rms };
  }

  let refined = best;
  if (best > tauMin && best < tauMax) {
    const s0 = cmnd[best - 1];
    const s1 = cmnd[best];
    const s2 = cmnd[best + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) refined = best + (s2 - s0) / denom;
  }

  const f0 = sr / refined;
  if (!Number.isFinite(f0) || f0 < fmin || f0 > fmax) {
    return { f0: 0, confidence: 0, rms };
  }

  return {
    f0,
    confidence: Math.max(0, Math.min(1, 1 - cmnd[best])),
    rms,
  };
}

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

/* ---------------- Spectral polyphonic salience ---------------- */
function buildPolySalience(
  samples: Float32Array,
  sampleRate: number,
): { salience: Float32Array; numFrames: number; hopSec: number } {
  const hop = POLY_HOP;
  const n = POLY_FFT;
  const numFrames = Math.max(1, Math.floor((samples.length - n) / hop) + 1);
  const salience = new Float32Array(128 * numFrames);
  const hopSec = hop / sampleRate;

  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const mag = new Float32Array(n / 2);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hop;
    for (let i = 0; i < n; i++) {
      re[i] = samples[offset + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    let maxMag = 0;
    for (let i = 0; i < n / 2; i++) {
      mag[i] = Math.hypot(re[i], im[i]);
      if (mag[i] > maxMag) maxMag = mag[i];
    }
    if (maxMag < 1e-6) continue;

    const floor = maxMag * 0.008; // ~ -42 dB below the loudest partial
    for (let i = 2; i < n / 2 - 1; i++) {
      const m = mag[i];
      if (m < floor) continue;
      if (m <= mag[i - 1] || m < mag[i + 1]) continue; // local maximum only

      // Parabolic interpolation for sub-bin accuracy.
      const a = mag[i - 1];
      const b = m;
      const c = mag[i + 1];
      const denom = a - 2 * b + c;
      const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      const bin = i + delta;
      const freq = (bin * sampleRate) / n;
      if (freq < 55 || freq > 4200) continue;

      const midi = hzToMidi(freq);
      const pitch = Math.round(midi);
      if (pitch < 21 || pitch > 108) continue;

      // Confidence weighted by magnitude and detune distance.
      const detune = Math.abs(midi - pitch);
      const w = (b / maxMag) * Math.max(0, 1 - detune * 1.6);
      const idx = pitch * numFrames + f;
      if (w > salience[idx]) salience[idx] = w;
    }

    if (f % 40 === 0) progress((f / numFrames) * 0.9);
  }

  return { salience, numFrames, hopSec };
}

/* ---------------- Salience matrix -> note events ---------------- */
function salienceToNotes(
  salience: Float32Array,
  numFrames: number,
  hopSec: number,
  onsetThreshold: number,
): TranscribedNote[] {
  const release = onsetThreshold * 0.6;
  const out: TranscribedNote[] = [];

  for (let p = 21; p <= 108; p++) {
    let f = 0;
    while (f < numFrames) {
      const v = salience[p * numFrames + f];
      if (v < onsetThreshold) {
        f++;
        continue;
      }
      let j = f;
      let peak = v;
      let silent = 0;
      while (j < numFrames) {
        const s = salience[p * numFrames + j];
        if (s >= release) {
          silent = 0;
          if (s > peak) peak = s;
        } else {
          silent++;
          if (silent > 3) break;
        }
        j++;
      }
      const endFrame = j - silent;
      const duration = (endFrame - f) * hopSec;
      if (duration >= MIN_NOTE_SECONDS) {
        out.push({
          id: `${p}-${f}-${Math.random().toString(36).slice(2, 8)}`,
          pitch: p,
          startTime: f * hopSec,
          duration,
          velocity: Math.min(1, Math.max(0.2, 0.25 + peak * 0.75)),
        });
      }
      f = Math.max(j, f + 1);
    }
  }
  return out;
}

/* ---------------- Voice contour -> note events ---------------- */
function contourToNotes(
  pitches: Float32Array,
  confidences: Float32Array,
  rmsValues: Float32Array,
  hopSec: number,
  numFrames: number,
  onsetThreshold: number,
): TranscribedNote[] {
  // 5-point median filter to suppress vibrato flapping.
  const smoothed = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const vals: number[] = [];
    for (let k = -2; k <= 2; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < numFrames && confidences[idx] > 0.3 && pitches[idx] > 0) {
        vals.push(pitches[idx]);
      }
    }
    vals.sort((a, b) => a - b);
    smoothed[i] = vals.length ? vals[Math.floor(vals.length / 2)] : pitches[i];
  }

  const voicedMin = Math.max(0.3, onsetThreshold * 0.6);
  const out: TranscribedNote[] = [];
  let i = 0;

  while (i < numFrames) {
    if (confidences[i] < voicedMin || smoothed[i] <= 0) {
      i++;
      continue;
    }

    const anchor = smoothed[i];
    let j = i;
    let sumPitch = 0;
    let count = 0;
    let sumRms = 0;
    let gap = 0;

    while (j < numFrames) {
      const voiced = confidences[j] >= voicedMin * 0.8 && smoothed[j] > 0;
      const close = voiced && Math.abs(smoothed[j] - anchor) < 1.25;
      if (close) {
        gap = 0;
        sumPitch += smoothed[j];
        sumRms += rmsValues[j];
        count++;
      } else {
        gap++;
        if (gap > 2) break;
      }
      j++;
    }

    const endFrame = j - gap;
    const duration = (endFrame - i) * hopSec;
    if (duration >= MIN_NOTE_SECONDS && count > 0) {
      const meanPitch = sumPitch / count;
      const rounded = Math.round(meanPitch);
      const cents = Math.max(-100, Math.min(100, (meanPitch - rounded) * 100));
      const avgRms = sumRms / count;

      out.push({
        id: `${rounded}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        pitch: rounded,
        startTime: i * hopSec,
        duration,
        velocity: Math.min(1, Math.max(0.2, 0.2 + avgRms * 6)),
        pitchBendCents: Math.abs(cents) > 5 ? [cents] : undefined,
        pitchBend: Math.abs(cents) > 5 ? [cents] : undefined,
      });
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

/* ---------------- Post-processing ---------------- */
function mergeShortGaps(notes: TranscribedNote[]): TranscribedNote[] {
  const byPitch = new Map<number, TranscribedNote[]>();
  for (const n of notes) {
    const arr = byPitch.get(n.pitch) ?? [];
    arr.push(n);
    byPitch.set(n.pitch, arr);
  }

  const merged: TranscribedNote[] = [];
  for (const arr of byPitch.values()) {
    arr.sort((a, b) => a.startTime - b.startTime);
    let cur = arr[0];
    for (let i = 1; i < arr.length; i++) {
      const next = arr[i];
      const gap = next.startTime - (cur.startTime + cur.duration);
      if (gap <= SMOOTH_GAP_SECONDS) {
        const total = cur.duration + Math.max(0, gap) + next.duration;
        cur = {
          ...cur,
          duration: total,
          velocity: Math.max(cur.velocity, next.velocity),
        };
      } else {
        merged.push(cur);
        cur = next;
      }
    }
    if (cur) merged.push(cur);
  }
  return merged.sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch);
}

/* ---------------- DSP fallback engine ---------------- */
function runDspEngine(
  samples: Float32Array,
  sampleRate: number,
  settings: ConverterSettings,
): TranscribedNote[] {
  const onsetThreshold = ONSET_THRESHOLD[settings.sensitivity] ?? 0.5;

  if (settings.mode === 'instrument') {
    const { salience, numFrames, hopSec } = buildPolySalience(samples, sampleRate);
    progress(0.95);
    return mergeShortGaps(
      salienceToNotes(salience, numFrames, hopSec, onsetThreshold),
    );
  }

  /* ---- Voice mode: YIN on 2x-decimated signal ---- */
  const decimated = new Float32Array(Math.floor(samples.length / 2));
  for (let i = 0; i < decimated.length; i++) {
    decimated[i] = 0.5 * (samples[i * 2] + samples[i * 2 + 1]);
  }
  const sr = sampleRate / 2;
  const hop = 128;
  const numFrames = Math.max(1, Math.floor((decimated.length - YIN_FRAME) / hop) + 1);
  const hopSec = hop / sr;
  const pitches = new Float32Array(numFrames);
  const confs = new Float32Array(numFrames);
  const rms = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const frame = decimated.subarray(f * hop, f * hop + YIN_FRAME);
    const res = yinFrame(frame, sr, 65, 1000);
    rms[f] = res.rms;
    if (res.f0 > 0) {
      pitches[f] = hzToMidi(res.f0);
      confs[f] = res.confidence;
    }
    if (f % 200 === 0) progress(0.1 + (f / numFrames) * 0.85);
  }

  // Gate out silence using the RMS envelope.
  let maxRms = 0;
  for (let i = 0; i < numFrames; i++) maxRms = Math.max(maxRms, rms[i]);
  const rmsGate = Math.max(1e-4, maxRms * 0.06);
  for (let i = 0; i < numFrames; i++) {
    if (rms[i] < rmsGate) confs[i] = 0;
  }

  progress(0.95);
  return mergeShortGaps(
    contourToNotes(pitches, confs, rms, hopSec, numFrames, onsetThreshold),
  );
}

/* ---------------- ONNX engine (Basic Pitch) ---------------- */
function decodeBasicPitch(
  outputs: Record<string, { data: Float32Array; dims: readonly number[] }>,
  audioDuration: number,
  onsetThreshold: number,
): TranscribedNote[] {
  const keys = Object.keys(outputs);
  const pick = (name: string, fallbackIdx: number) => {
    const hit = keys.find((k) => k.toLowerCase().includes(name));
    return hit ? outputs[hit] : outputs[keys[fallbackIdx]];
  };

  const onset = pick('onset', 0);
  const note = pick('note', 1);
  if (!onset || !note) return [];

  const T = onset.dims[onset.dims.length - 2];
  const P = onset.dims[onset.dims.length - 1];
  if (!T || !P) return [];

  const fps = T / Math.max(0.001, audioDuration);
  const release = onsetThreshold * 0.6;
  const out: TranscribedNote[] = [];

  for (let p = 0; p < P; p++) {
    const midi = 21 + p;
    if (midi < 0 || midi > 127) continue;

    for (let t = 1; t < T - 1; t++) {
      const v = onset.data[t * P + p];
      if (v < onsetThreshold) continue;

      // Local maximum in time -> one onset per note.
      if (v <= onset.data[(t - 1) * P + p] || v < onset.data[(t + 1) * P + p]) continue;

      let end = t;
      while (end < T - 1 && note.data[end * P + p] > release) end++;

      const startTime = t / fps;
      const duration = (end - t) / fps;
      if (duration >= MIN_NOTE_SECONDS) {
        out.push({
          id: `${midi}-${t}-${Math.random().toString(36).slice(2, 8)}`,
          pitch: midi,
          startTime,
          duration,
          velocity: Math.min(1, Math.max(0.2, 0.25 + v * 0.75)),
        });
      }
      t = end;
    }
  }

  return mergeShortGaps(out);
}

async function runOnnxEngine(
  samples: Float32Array,
  sampleRate: number,
  session: import('onnxruntime-web').InferenceSession,
  ort: OrtModule,
  settings: ConverterSettings,
): Promise<TranscribedNote[]> {
  const onsetThreshold = ONSET_THRESHOLD[settings.sensitivity] ?? 0.5;
  const total = samples.length / sampleRate;
  const WINDOW = 10 * sampleRate;
  const OVERLAP = 1 * sampleRate;
  const notes: TranscribedNote[] = [];

  let offset = 0;
  let guard = 0;

  while (offset < samples.length && guard++ < 200) {
    const end = Math.min(samples.length, offset + WINDOW);
    const chunk = samples.subarray(offset, end);
    const duration = chunk.length / sampleRate;

    const tensor = new ort.Tensor('float32', chunk.slice(), [1, chunk.length]);
    const inputName = session.inputNames[0];
    const results = await session.run({ [inputName]: tensor });

    const asRecord: Record<string, { data: Float32Array; dims: readonly number[] }> = {};
    for (const [k, v] of Object.entries(results)) {
      asRecord[k] = {
        data: (v as import('onnxruntime-web').Tensor).data as Float32Array,
        dims: (v as import('onnxruntime-web').Tensor).dims,
      };
    }

    const chunkNotes = decodeBasicPitch(asRecord, duration, onsetThreshold);
    const chunkStart = offset / sampleRate;

    for (const n of chunkNotes) {
      const abs = { ...n, startTime: n.startTime + chunkStart };
      // Drop notes that start inside the overlap of the previous chunk.
      if (offset > 0 && abs.startTime < chunkStart + OVERLAP / sampleRate) continue;
      notes.push(abs);
    }

    progress(Math.min(0.98, end / samples.length));
    if (end >= samples.length) break;
    offset = end - OVERLAP;
  }

  console.log(
    `[worker] ONNX (${provider}) -> ${notes.length} notes over ${total.toFixed(2)}s`,
  );
  return mergeShortGaps(notes);
}

/* ---------------- Entry point ---------------- */
ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'transcribe') return;

  const { jobId, samples, sampleRate, settings } = msg;
  currentJob = jobId;

  try {
    progress(0.02);
    const session = await getOrtSession();
    let notes: TranscribedNote[];

    if (session && ortModule) {
      notes = await runOnnxEngine(
        samples,
        sampleRate,
        session,
        ortModule,
        settings,
      );
      // Neural model produced nothing useful -> fall back gracefully.
      if (notes.length === 0) {
        notes = runDspEngine(samples, sampleRate, settings);
      }
    } else {
      notes = runDspEngine(samples, sampleRate, settings);
    }

    progress(1);
    post({ type: 'result', jobId, notes });
  } catch (err) {
    console.error('[worker] transcription failed', err);
    post({
      type: 'error',
      jobId,
      message: err instanceof Error ? err.message : 'Transcription failed',
    });
  }
};

export {};

