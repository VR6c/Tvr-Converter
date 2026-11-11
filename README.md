# Audio → MIDI (Client-Side SaaS)

100% in-browser audio-to-MIDI transcription web application built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, **Web Audio API**, **WebGPU/WASM**, and **ONNX Runtime Web**.

Zero audio data ever leaves the user's browser.

---

## Key Features

- **Zero-Server Processing (Client-Side First)**: Audio decoding, DSP pitch tracking, neural network inference, scale snapping, and MIDI serialization execute 100% in the user's browser.
- **Dedicated Web Worker Isolation**: Heavy math (Radix-2 FFT, sliding window inference, sample rate conversion, and peak picking) runs inside a dedicated Web Worker via Transferable `ArrayBuffer` objects to maintain 60 FPS UI fluidity.
- **Hardware-Accelerated ML Inference**: Targets **WebGPU** execution provider first, with graceful fallback to multi-threaded **WebAssembly (WASM)** with SIMD.
- **Dual Processing Engines**:
  - **Neural (Basic Pitch)**: Slotted for `public/models/basic-pitch.onnx` with automatic runtime detection.
  - **DSP Engine**: Integrated fallback engine with **YIN algorithm** & parabolic sub-cent f0 interpolation for voice mode and **multi-band harmonic salience peak-tracking** for polyphonic instruments.
- **Catch Every Note Sensitivity Controls**:
  - High: 0.35 threshold (fast, subtle runs)
  - Mid: 0.50 threshold (balanced)
  - Low: 0.65 threshold (rejects background room noise & breath)
- **Musical Snapping & Quantization**:
  - Auto Key Detection via Krumhansl-Schmuckler chroma correlation.
  - Scale snapping: Major, Minor, Harmonic Minor, Dorian, Mixolydian, Pentatonic, Chromatic.
  - Snapping intensities: Off, Soft (preserves microtonal glide curves in pitch bend), Perfect.
  - Timing grid quantization: Off, 1/8, 1/16, 1/32 with 40–240 BPM tempo clock.
- **Interactive HTML5 Canvas Piano Roll**:
  - Chromatic lanes (A0 to C8), alternating key background, beat/measure grid lines.
  - Velocity color-coded note rectangles with pitch tags.
  - Note drag/move, left/right edge resize duration, double-click add/remove, Ctrl/Cmd+wheel zoom.
  - Synchronized playhead animation.
- **Audition Synth & Audio Preview**:
  - Tone.js PolySynth preview with octave transposition (-2 to +2).
  - WaveSurfer.js audio waveform visualization with scrub & seek.
  - Solo Synth / Solo Audio balance controls.
- **Standard MIDI File Exporter**:
  - Uses `@tonejs/midi` to serialize SMF Type 1 files with BPM tempo meta tracks, velocity, and microtonal pitch bends.
  - Supports modern File System Access API (`window.showSaveFilePicker()`) with instant Blob fallback.

---

## Quick Start

```bash
# 1. Install dependencies (also executes postinstall scripts/copy-ort.mjs)
npm install

# 2. Run the development server
npm run dev

# 3. Open in your browser
http://localhost:3000
```

---

## Architecture Flow

```
[Audio Input: Mic / File Drop (.wav, .mp3, .m4a, .flac)]
        │
        ▼
[Web Audio API (Main Thread)]
  - Decode PCM via AudioContext.decodeAudioData()
  - Downmix multi-channel audio to mono
  - OfflineAudioContext resample to 22,050 Hz
        │
        ▼ (Transferable ArrayBuffer via postMessage)
[Dedicated Web Worker Pipeline]
  - ONNX Runtime Web (WebGPU -> WASM SIMD fallback)
  - Basic Pitch / DSP YIN & Salience peak picking
  - Dynamic onset thresholding & debounce (>= 60ms)
        │
        ▼ (Transcribed Note Entities)
[Main Thread Application State]
  - Musical Snapping (Krumhansl-Schmuckler key detection + grid)
  - Interactive Canvas Piano Roll (zoom, drag, resize, delete)
  - Tone.js Audition Synthesizer + WaveSurfer Waveform
  - MIDI Serializer (@tonejs/midi) -> File Blob / File System API
```

