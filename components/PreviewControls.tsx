'use client';

import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { cn, formatTime } from '@/lib/utils';

interface Props {
  playing: boolean;
  onTogglePlay: () => void;
  onRewind: () => void;
  onSeek: (t: number) => void;
  currentTime: number;
  duration: number;
  volume: number;
  onVolume: (v: number) => void;
  soloSynth: boolean;
  soloAudio: boolean;
  onSoloSynth: () => void;
  onSoloAudio: () => void;
  canPlay: boolean;
}

const TOGGLE = 'rounded border px-2.5 py-1 text-xs font-medium transition-colors';

export default function PreviewControls({
  playing,
  onTogglePlay,
  onRewind,
  onSeek,
  currentTime,
  duration,
  volume,
  onVolume,
  soloSynth,
  soloAudio,
  onSoloSynth,
  onSoloAudio,
  canPlay,
}: Props) {
  const shownTime = Math.min(Math.max(0, currentTime), Math.max(0, duration));
  const isEnded = !playing && duration > 0 && currentTime >= duration - 0.05;
  const PlayIcon = playing ? Pause : isEnded ? RotateCcw : Play;
  const playLabel = playing ? 'Pause' : isEnded ? 'Replay' : 'Play';

  return (
    <div
      role="group"
      aria-label="Preview playback"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-surface px-3 py-2"
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onRewind}
          disabled={!canPlay}
          className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100/5 hover:text-neutral-100 disabled:opacity-40"
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
            'inline-flex w-24 items-center justify-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
            playing
              ? 'border border-line-strong text-neutral-100 hover:bg-neutral-100/5'
              : 'bg-brand-500 text-white hover:bg-brand-600',
          )}
          title={`${playLabel} (Space)`}
        >
          <PlayIcon className="h-4 w-4" aria-hidden />
          {playLabel}
        </button>
      </div>

      <div className="font-mono text-sm tabular-nums text-neutral-300">
        {formatTime(shownTime)}
        <span className="text-neutral-600"> / </span>
        <span className="text-neutral-500">{formatTime(duration)}</span>
      </div>

      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 1}
        step={0.01}
        value={shownTime}
        onChange={(e) => onSeek(Number(e.target.value))}
        disabled={!canPlay || duration <= 0}
        className="h-1 min-w-32 flex-1 cursor-pointer appearance-none rounded-full bg-line-strong accent-brand-400 disabled:cursor-default disabled:opacity-40"
        aria-label="Playback position"
        aria-valuetext={`${formatTime(shownTime)} of ${formatTime(duration)}`}
      />

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
          onClick={onSoloAudio}
          aria-pressed={soloAudio}
          className={cn(
            TOGGLE,
            soloAudio
              ? 'border-brand-500 bg-brand-500/15 text-brand-300'
              : 'border-line text-neutral-500 hover:text-neutral-300',
          )}
          title="Toggle your original voice"
        >
          Voice
        </button>
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
          title="Toggle MIDI piano preview"
        >
          MIDI
        </button>
      </div>
    </div>
  );
}
