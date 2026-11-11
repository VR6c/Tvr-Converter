'use client';

import { Download, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { cn, formatTime } from '@/lib/utils';

interface Props {
  playing: boolean;
  onTogglePlay: () => void;
  onRewind: () => void;
  currentTime: number;
  duration: number;
  volume: number;
  onVolume: (v: number) => void;
  soloSynth: boolean;
  soloAudio: boolean;
  onSoloSynth: () => void;
  onSoloAudio: () => void;
  onExport: () => void;
  exporting: boolean;
  canExport: boolean;
  canPlay?: boolean;
  noteCount: number;
}

export default function TransportBar({
  playing,
  onTogglePlay,
  onRewind,
  currentTime,
  duration,
  volume,
  onVolume,
  soloSynth,
  soloAudio,
  onSoloSynth,
  onSoloAudio,
  onExport,
  exporting,
  canExport,
  canPlay = true,
  noteCount,
}: Props) {
  const isEnded = !playing && duration > 0 && currentTime >= duration - 0.05;

  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-white/5 bg-[#12151c]/60 px-4 py-3">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onRewind}
          disabled={!canPlay}
          className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
          title="Replay from start (R)"
          aria-label="Replay from start"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!canPlay}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40',
            playing
              ? 'bg-white/10 text-white hover:bg-white/15'
              : 'bg-brand-500 text-white hover:bg-brand-400',
          )}
          title={
            playing
              ? 'Pause (Space)'
              : isEnded
                ? 'Replay (Space)'
                : 'Play (Space)'
          }
        >
          {playing ? (
            <>
              <Pause className="h-4 w-4" /> Pause
            </>
          ) : isEnded ? (
            <>
              <RotateCcw className="h-4 w-4" /> Replay
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> Play
            </>
          )}
        </button>
      </div>

      <div className="font-mono text-xs tabular-nums text-white/50">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>

      <div className="flex items-center gap-2">
        {volume === 0 ? (
          <VolumeX className="h-4 w-4 text-white/40" />
        ) : (
          <Volume2 className="h-4 w-4 text-white/40" />
        )}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-white/10 accent-brand-500"
          aria-label="Volume"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSoloSynth}
          className={cn(
            'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
            soloSynth
              ? 'border-brand-500/50 bg-brand-500/15 text-brand-300'
              : 'border-white/10 bg-black/20 text-white/50 hover:text-white/80',
          )}
          title="Toggle synth preview"
        >
          Solo Synth
        </button>
        <button
          type="button"
          onClick={onSoloAudio}
          className={cn(
            'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
            soloAudio
              ? 'border-brand-500/50 bg-brand-500/15 text-brand-300'
              : 'border-white/10 bg-black/20 text-white/50 hover:text-white/80',
          )}
          title="Toggle original audio"
        >
          Solo Audio
        </button>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-white/35">
          {noteCount} note{noteCount === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onExport}
          disabled={!canExport || exporting}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting…' : 'Download .MID'}
        </button>
      </div>
    </section>
  );
}

