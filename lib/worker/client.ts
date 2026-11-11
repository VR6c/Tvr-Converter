'use client';

/**
 * Singleton wrapper around the inference Web Worker.
 * The worker is created lazily so it never blocks first paint.
 */
let worker: Worker | null = null;
let listeners: ((msg: unknown) => void)[] = [];

export function getInferenceWorker(): Worker | null {
  if (typeof window === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(
      new URL('../../workers/inference.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e: MessageEvent) => {
      listeners.forEach((l) => l(e.data));
    };
    worker.onerror = (e) => {
      listeners.forEach((l) =>
        l({ type: 'error', message: e.message || 'Worker crashed' }),
      );
    };
  } catch (err) {
    console.error('[worker] failed to spawn', err);
    worker = null;
  }
  return worker;
}

export function onWorkerMessage(fn: (msg: unknown) => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

