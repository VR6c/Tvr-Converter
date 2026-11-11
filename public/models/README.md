# Basic Pitch ONNX Model Directory

Place `basic-pitch.onnx` into this folder to enable neural pitch transcription via ONNX Runtime Web.

### Expected Model Contract
- Input: `float32[1, N]` mono audio samples at 22,050 Hz
- Outputs:
  - `note`: `float32[1, T, 88]` - note frame activations
  - `onset`: `float32[1, T, 88]` - note onset activations
  - `contour`: `float32[1, T, 88]` - pitch contour activations

When `basic-pitch.onnx` is placed here, the Web Worker automatically targets WebGPU with fallback to multithreaded WASM+SIMD.
If no ONNX model is present, the app automatically runs the integrated high-fidelity client-side DSP engine (YIN algorithm with CMND for voice mode, and multi-band harmonic salience peak-tracking for instrument mode).

