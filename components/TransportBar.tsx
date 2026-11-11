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

const TOGGLE =
  'rounded border px-2.5 py-1.5 text-xs font-medium transition-colors';

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
  const PlayIcon = playing ? Pause : isEnded ? RotateCcw : Play;
  const playLabel = playing ? 'Pause' : isEnded ? 'Replay' : 'Play';

  return (
    <section
      aria-label="Transport"
      className="sticky bottom-0 z-20 border-t border-line bg-surface"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRewind}
            disabled={!canPlay}
            className="rounded p-2 text-neutral-400 transition-colors hover:bg-neutral-100/5 hover:text-neutral-100 disabled:opacity-40"
            title="Replay from start (R)"
            aria-label="Replay from start"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!canPlay}
            className={cn(
              'inline-flex w-24 items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40',
              playing
                ? 'border border-line-strong text-neutral-100 hover:bg-neutral-100/5'
                : 'bg-brand-500 text-white hover:bg-brand-600',
            )}
            title={`${playLabel} (Space)`}
          >
            <PlayIcon
              key={playLabel}
              className="h-4 w-4 animate-in zoom-in-50 fade-in duration-150"
              aria-hidden
            /> {playLabel}
          </button>
        </div>

        <div className="font-mono text-sm tabular-nums text-neutral-300">
          {formatTime(currentTime)}
          <span className="text-neutral-600"> / </span>
          <span className="text-neutral-500">{formatTime(duration)}</span>
        </div>

        <div className="flex items-center gap-2">
          {volume === 0 ? (
            <VolumeX className="h-4 w-4 text-neutral-500" aria-hidden />
          ) : (
            <Volume2 className="h-4 w-4 text-neutral-500" aria-hidden />
          )}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-line-strong accent-brand-400"
            aria-label="Volume"
          />
        </div>

        <div className="flex items-center gap-1.5" role="group" aria-label="Monitor">
          <button
            type="button"
            onClick={onSoloSynth}
            aria-pressed={soloSynth}
            className={cn(
              TOGGLE,
              soloSynth
                ? 'border-brand-500 bg-brand-500/15 text-brand-300'
                : 'border-line text-neutral-500 hover:text-neutral-300',
            )}
            title="Toggle synth preview"
          >
            Synth
          </button>
          <button
            type="button"
            onClick={onSoloAudio}
            aria-pressed={soloAudio}
            className={cn(
              TOGGLE,
              soloAudio
                ? 'border-brand-500 bg-brand-500/15 text-brand-300'
                : 'border-line text-neutral-500 hover:text-neutral-300',
            )}
            title="Toggle original audio"
          >
            Original
          </button>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <span className="font-mono text-xs text-neutral-500">
            {noteCount} note{noteCount === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport || exporting}
            className="inline-flex items-center gap-2 rounded bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40"
          >
            <Download className="h-4 w-4" aria-hidden />
            {exporting ? 'Exporting…' : 'Download .mid'}
          </button>
        </div>
      </div>
    </section>
  );
}
