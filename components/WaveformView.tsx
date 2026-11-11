'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import WaveSurfer from 'wavesurfer.js';

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

const WaveformView = forwardRef<WaveformHandle, Props>(function WaveformView(
  { url, height = 96, onReady, onTime, onFinish },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor: 'rgba(255,255,255,0.22)',
      progressColor: '#5b8cff',
      cursorColor: '#8b5cf6',
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
    <div className="rounded-xl border border-white/5 bg-[#12151c]/60 p-2">
      <div ref={containerRef} className="w-full" />
      {!url && (
        <p className="py-6 text-center text-xs text-white/30">
          Load audio to see the waveform
        </p>
      )}
    </div>
  );
});

export default WaveformView;

