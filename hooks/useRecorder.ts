'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RecorderState {
  recording: boolean;
  level: number; // 0..1
  error: string | null;
}

export function useRecorder(onComplete: (blob: Blob) => void) {
  const [state, setState] = useState<RecorderState>({
    recording: false,
    level: 0,
    error: null,
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(async () => {
    if (state.recording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      streamRef.current = stream;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        setState((s) => ({ ...s, level: Math.min(1, rms * 6) }));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        onComplete(blob);
        cancelAnimationFrame(rafRef.current);
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close().catch(() => {});
        setState({ recording: false, level: 0, error: null });
      };

      recorder.start();
      recorderRef.current = recorder;
      setState({ recording: true, level: 0, error: null });
    } catch (err) {
      setState({
        recording: false,
        level: 0,
        error:
          err instanceof Error
            ? `Microphone unavailable: ${err.message}`
            : 'Microphone unavailable.',
      });
    }
  }, [state.recording, onComplete]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          /* noop */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  return { ...state, start, stop };
}

