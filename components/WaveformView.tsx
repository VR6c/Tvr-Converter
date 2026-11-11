'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import WaveSurfer from 'wavesurfer.js';
import { useTheme } from '@/hooks/useTheme';

export interface WaveformHandle {
  play: () => Promise<void> | void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
}

interface Props {
  url: string | null;
  height?: number;
  onReady?: (duration: number) => void;
  onTime?: (t: number) => void;
  onFinish?: () => void;
}

const WAVE_COLOR = { dark: 'rgba(255,255,255,0.22)', light: 'rgba(0,0,0,0.25)' };
const PROGRESS_COLOR = { dark: '#35c2b2', light: '#0f8a7d' };

const WaveformView = forwardRef<WaveformHandle, Props>(function WaveformView(
  { url, height = 96, onReady, onTime, onFinish },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor: WAVE_COLOR[themeRef.current],
      progressColor: PROGRESS_COLOR[themeRef.current],
      cursorColor: '#f97316',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: true,
    });
    wsRef.current = ws;

    ws.on('ready', () => onReady?.(ws.getDuration()));
    ws.on('timeupdate', (t: number) => onTime?.(t));
    ws.on('seeking', (t: number) => onTime?.(t));
    ws.on('interaction', (newTime: number) => onTime?.(newTime));
    ws.on('finish', () => onFinish?.());

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  useEffect(() => {
    wsRef.current?.setOptions({
      waveColor: WAVE_COLOR[theme],
      progressColor: PROGRESS_COLOR[theme],
    });
  }, [theme]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (url) {
      ws.load(url).catch(() => {
        /* decode failures surface through the store */
      });
    } else {
      ws.empty();
    }
  }, [url]);

  useImperativeHandle(ref, () => ({
    play: () => {
      const ws = wsRef.current;
      if (!ws) return;
      return ws.play() as unknown as Promise<void>;
    },
    pause: () => wsRef.current?.pause(),
    seekTo: (s: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      ws.setTime(Math.max(0, s));
    },
    getCurrentTime: () => wsRef.current?.getCurrentTime() ?? 0,
    getDuration: () => wsRef.current?.getDuration() ?? 0,
    setVolume: (v: number) => wsRef.current?.setVolume(Math.min(1, Math.max(0, v))),
    setMuted: (m: boolean) => wsRef.current?.setMuted(m),
  }));

  return (
    <section
      aria-label="Waveform"
      className="relative rounded-md border border-line bg-surface p-2"
      style={{ minHeight: height + 16 }}
    >
      <div ref={containerRef} className="w-full" />
      {!url && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
          Load audio to see the waveform
        </p>
      )}
    </section>
  );
});

export default WaveformView;

