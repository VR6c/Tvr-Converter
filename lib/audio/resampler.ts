export const TARGET_SAMPLE_RATE = 22050;

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

/**
 * Decode an arbitrary audio file to raw PCM using a short-lived
 * OfflineAudioContext (avoids the autoplay-gesture requirement of AudioContext).
 */
async function decodeToPcm(file: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  // 1-sample offline context purely as a decoder host.
  const decoderCtx = new OfflineAudioContext(1, 1, 44100);
  return await decoderCtx.decodeAudioData(arrayBuffer.slice(0));
}

/**
 * Downmix to mono and resample to exactly 22,050 Hz using
 * OfflineAudioContext(1, targetFrames, 22050).
 */
async function resampleMono(
  buffer: AudioBuffer,
  targetRate = TARGET_SAMPLE_RATE,
): Promise<Float32Array> {
  const duration = buffer.duration;
  const targetFrames = Math.max(1, Math.ceil(duration * targetRate));
  const offline = new OfflineAudioContext(1, targetFrames, targetRate);

  const source = offline.createBufferSource();
  source.buffer = buffer;

  // Explicit downmix graph: multi-channel -> mono.
  const merger = offline.createGain();
  merger.gain.value = 1;
  source.connect(merger);
  merger.connect(offline.destination);

  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

/** Full pipeline: File/Blob -> mono 22.05 kHz Float32Array. */
export async function decodeAudioFile(file: Blob): Promise<DecodedAudio> {
  const buffer = await decodeToPcm(file);
  const samples = await resampleMono(buffer);
  return {
    samples,
    sampleRate: TARGET_SAMPLE_RATE,
    duration: samples.length / TARGET_SAMPLE_RATE,
  };
}

export const SUPPORTED_EXTENSIONS = [
  '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.webm',
];

export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB (FR-1.2)

export function isSupportedAudioFile(file: File): boolean {
  if (file.size > MAX_FILE_BYTES) return false;
  const name = file.name.toLowerCase();
  if (SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return file.type.startsWith('audio/');
}

