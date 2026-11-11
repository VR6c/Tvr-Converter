# Audio → MIDI

Convert audio to MIDI entirely in your browser — no uploads, no servers, no data leaves your device.

Built with **Next.js 14**, **TypeScript**, **Tailwind CSS**, **ONNX Runtime Web**, and the **Web Audio API**.

---

## Features

### 🧠 Dual Transcription Engines
- **Neural (Basic Pitch)** — place `basic-pitch.onnx` in `public/models/` to enable WebGPU-accelerated neural pitch detection with automatic WASM fallback.
- **DSP Engine** — always-available built-in engine: YIN algorithm with parabolic interpolation for monophonic voice/melody, multi-band harmonic salience peak-tracking for polyphonic instruments.

### ⚡ Performance
- All heavy work (FFT, sliding-window inference, resampling) runs inside a **dedicated Web Worker** via transferable `ArrayBuffer`s — UI stays at 60 FPS.
- WebGPU → multithreaded WASM+SIMD execution provider chain, selected automatically at runtime.

### 🎵 Musical Correction
| Feature | Options |
|---|---|
| **Sensitivity** | High (0.35) · Mid (0.50) · Low (0.65) |
| **Key Detection** | Auto via Krumhansl-Schmuckler chroma correlation |
| **Scale Snapping** | Off · Soft (preserves pitch bend) · Perfect — Major, Minor, Harmonic Minor, Dorian, Mixolydian, Pentatonic, Chromatic |
| **Timing Grid** | Off · 1/8 · 1/16 · 1/32 at 40–240 BPM |

### 🎹 Interactive Piano Roll
- Chromatic grid A0–C8 with velocity-colored notes and beat/measure lines.
- Drag to move, edge-drag to resize duration, double-click to add/delete.
- `Ctrl/Cmd` + scroll to zoom, synchronized playhead.

### 🔊 Audio Preview
- **Tone.js PolySynth** audition with ±2 octave transposition.
- **WaveSurfer.js** waveform scrubber with Solo Synth / Solo Audio mix control.

### 💾 MIDI Export
- Exports SMF Type 1 (`.mid`) with BPM meta track, velocity, and microtonal pitch bends via `@tonejs/midi`.
- Uses File System Access API (`showSaveFilePicker`) with an instant Blob URL fallback.

---

## Quick Start

```bash
# Install dependencies (also runs scripts/copy-ort.mjs to stage ONNX Runtime WASM assets)
npm install

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Optional neural model** — download `basic-pitch.onnx` from [Spotify's Basic Pitch](https://github.com/spotify/basic-pitch) and place it in `public/models/`. Without it the DSP engine runs automatically.

---

## How It Works

```
Audio Input  (mic / file drop: .wav .mp3 .m4a .flac)
     │
     ▼  Web Audio API (main thread)
     │  · AudioContext.decodeAudioData()  →  mono PCM
     │  · OfflineAudioContext resample   →  22,050 Hz
     │
     ▼  postMessage (Transferable ArrayBuffer)
     │
     ▼  Web Worker
     │  · ONNX Runtime Web  (WebGPU → WASM SIMD fallback)
     │      Basic Pitch neural inference  (onset · note · contour)
     │  · DSP fallback
     │      YIN f0 + parabolic interpolation  (voice/melody)
     │      Multi-band harmonic salience      (instrument/poly)
     │  · Onset thresholding  ·  gap merging  ·  ≥ 60 ms gate
     │
     ▼  TranscribedNote[]  →  main thread
        · Krumhansl-Schmuckler key detection + scale snap
        · Timing grid quantization
        · Canvas Piano Roll  (zoom · drag · resize · delete)
        · Tone.js synth  +  WaveSurfer waveform
        · @tonejs/midi  →  SMF .mid export
```

---

## YouTube Key & BPM Detection

Paste a YouTube link to look up a track's key and tempo, then apply them to the scale snap and timing grid. `POST /api/detect-key-bpm` resolves it in three tiers:

1. **Cache** — Upstash Redis, keyed `yt:key_bpm:{videoId}`, 30-day TTL (in-memory when Redis is not configured).
2. **Metadata** — oEmbed title → cleaned `artist` / `track` → Spotify search + audio features. Remixes, live takes and other variants only match a Spotify release of the same kind.
3. **Audio DSP** — the route fetches a 45 s clip with `yt-dlp`, decodes it with `ffmpeg`, and runs the app's own tempo detector plus an audio key detector (`lib/dsp/audioKey.ts`) in-process.

No configuration is required: with `yt-dlp` and `ffmpeg` installed (`brew install yt-dlp ffmpeg`), tier 3 handles every link. Redis and Spotify are optional accelerators, configured via `.env.local` (see `.env.example`).

**On Vercel** the install step downloads a Linux `yt-dlp` into `bin/` and `ffmpeg-static` supplies `ffmpeg`; both are shipped with the API function. YouTube often refuses requests from cloud IPs — if lookups fail with "YouTube refused this server's request", set `YT_DLP_PROXY` to a residential proxy URL. Adding Upstash Redis is recommended there so each video is only fetched once.

---

## Project Structure

```
app/                    Next.js App Router entry
components/
  PianoRoll/            Canvas piano roll + minimap + toolbar
  Dropzone              Audio file / mic input
  WaveformView          WaveSurfer waveform wrapper
  ControlToolbar        Sensitivity, key, scale, quantize controls
hooks/
  useRecorder           MediaRecorder hook for mic input
lib/
  audio/                MIDI writer, resampler, Tone.js synth
  dsp/                  Tempo detection, note quantizer
  store/                Zustand global state
  worker/               Web Worker client wrapper
workers/
  inference.worker.ts   ONNX + DSP transcription pipeline
public/
  models/               Drop basic-pitch.onnx here
  ort/                  ONNX Runtime WASM assets (auto-generated by postinstall)
```

---

## Deployment

The app is a fully static Next.js site — deploy anywhere static hosting is supported.

### Vercel (recommended)

```bash
# Push to GitHub then import at vercel.com/new
git remote add origin https://github.com/<you>/audio-to-midi.git
git push -u origin main
```

Vercel auto-runs `npm install` (which triggers `postinstall` to stage the ORT WASM assets) then `npm run build`. No environment variables required.

> **COOP/COEP headers** are configured in both `next.config.mjs` and `vercel.json` — required for `SharedArrayBuffer` / multi-threaded WASM.

---

## Tech Stack

| Layer | Library |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| ML Inference | ONNX Runtime Web 1.19 |
| MIDI | @tonejs/midi |
| Synth | Tone.js |
| Waveform | WaveSurfer.js |
| State | Zustand |
