'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { AlertCircle, Loader2 } from 'lucide-react';
import Header from '@/components/Header';
import Dropzone from '@/components/Dropzone';
import ControlToolbar from '@/components/ControlToolbar';
import TransportBar from '@/components/TransportBar';
import type { WaveformHandle } from '@/components/WaveformView';
import type { PianoRollHandle } from '@/components/PianoRoll';
import { useConverterStore } from '@/lib/store/useConverterStore';
import {
  getAuditionTime,
  pauseAudition,
  scheduleAudition,
  seekAudition,
  setSynthVolume,
  stopAudition,
  unlockAudio,
} from '@/lib/audio/synth';

/* Canvas-heavy components are client-only. */
const WaveformView = dynamic(() => import('@/components/WaveformView'), {
  ssr: false,
});
const PianoRoll = dynamic(() => import('@/components/PianoRoll'), {
  ssr: false,
});

export default function Page() {
  const {
    fileName,
    audioUrl,
    audioDuration,
    notes,
    settings,
    provider,
    status,
    progress,
    error,
    selectedNoteId,
    detectedKeyLabel,
    detectedTempoLabel,
    loadFile,
    loadBlob,
    transcribe,
    updateSettings,
    autoDetectKey,
    autoDetectTempo,
    commitNotes,
    selectNote,
    exportMidi,
    reset,
  } = useConverterStore();

  const waveRef = useRef<WaveformHandle | null>(null);
  const rollRef = useRef<PianoRollHandle | null>(null);
  const playheadRef = useRef(0);
  const rafRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [soloSynth, setSoloSynth] = useState(true);
  const [soloAudio, setSoloAudio] = useState(true);
  const [exporting, setExporting] = useState(false);

  const busy = status === 'decoding' || status === 'transcribing';
  const notesDuration = notes.reduce(
    (max, n) => Math.max(max, n.startTime + n.duration),
    0,
  );
  const effectiveDuration = audioDuration > 0 ? audioDuration : notesDuration;
  const canPlay = !busy && (Boolean(audioUrl) || notes.length > 0);
  const canExport = notes.length > 0;

  /* ---------------- volume routing ---------------- */
  useEffect(() => {
    setSynthVolume(soloSynth ? -18 + volume * 18 : -Infinity);
    waveRef.current?.setMuted(!soloAudio);
    waveRef.current?.setVolume(volume);
  }, [volume, soloSynth, soloAudio, audioUrl]);

  /* ---------------- playback loop ---------------- */
  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    waveRef.current?.pause();
    pauseAudition();
    setPlaying(false);
  }, []);

  const startPlayback = useCallback(async () => {
    if (!canPlay) return;
    await unlockAudio();

    // If at or near the end, restart from beginning
    const isAtEnd =
      effectiveDuration > 0 && playheadRef.current >= effectiveDuration - 0.05;
    const from = isAtEnd ? 0 : Math.max(0, playheadRef.current);

    playheadRef.current = from;
    setCurrentTime(from);

    if (audioUrl) {
      waveRef.current?.seekTo(from);
      waveRef.current?.setMuted(!soloAudio);
      waveRef.current?.setVolume(volume);
      void waveRef.current?.play();
    }

    if (notes.length > 0) {
      scheduleAudition(notes, {
        octaveOffset: settings.octaveOffset,
        fromTime: from,
      });
    }

    setPlaying(true);

    const startTime = performance.now();
    const startFromTime = from;

    const loop = () => {
      let t = from;
      if (audioUrl) {
        t = waveRef.current?.getCurrentTime() ?? from;
      } else {
        const elapsed = (performance.now() - startTime) / 1000;
        t = startFromTime + elapsed;
      }

      playheadRef.current = t;
      setCurrentTime(t);

      // Resync Tone.Transport if audio is playing and drift occurs
      if (notes.length > 0 && audioUrl) {
        const synthTime = getAuditionTime();
        if (Math.abs(synthTime - t) > 0.06) {
          seekAudition(t);
        }
      }

      if (effectiveDuration > 0 && t >= effectiveDuration - 0.02) {
        stopPlayback();
        playheadRef.current = effectiveDuration;
        setCurrentTime(effectiveDuration);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [
    canPlay,
    effectiveDuration,
    audioUrl,
    soloAudio,
    volume,
    notes,
    settings.octaveOffset,
    stopPlayback,
  ]);

  const togglePlay = useCallback(() => {
    if (playing) stopPlayback();
    else void startPlayback();
  }, [playing, startPlayback, stopPlayback]);

  const rewind = useCallback(() => {
    const wasPlaying = playing;
    stopPlayback();
    playheadRef.current = 0;
    setCurrentTime(0);
    waveRef.current?.seekTo(0);
    seekAudition(0);
    if (wasPlaying) {
      requestAnimationFrame(() => void startPlayback());
    }
  }, [playing, stopPlayback, startPlayback]);

  const handleSeek = useCallback(
    (targetTime: number) => {
      const t = Math.max(0, Math.min(effectiveDuration, targetTime));
      playheadRef.current = t;
      setCurrentTime(t);
      waveRef.current?.seekTo(t);
      seekAudition(t);
    },
    [effectiveDuration],
  );

  /* Spacebar and R keyboard shortcuts for Play, Pause, Replay */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (e.code === 'Space') {
        // Space already activates a focused button / combobox natively.
        if (el?.closest('button, [role="combobox"], [role="option"]')) return;
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        rewind();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, rewind]);

  /* Stop playback whenever the source audio changes. */
  useEffect(() => {
    stopPlayback();
    stopAudition();
    playheadRef.current = 0;
    setCurrentTime(0);
  }, [audioUrl, stopPlayback]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /* Re-schedule the synth when the note set or octave changes mid-playback. */
  useEffect(() => {
    if (!playing || !soloSynth) return;
    scheduleAudition(notes, {
      octaveOffset: settings.octaveOffset,
      fromTime: playheadRef.current,
    });
  }, [notes, settings.octaveOffset, soloSynth, playing]);

  /* ---------------- export ---------------- */
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportMidi();
      void confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.75 },
        colors: ['#35c2b2', '#6fdccd', '#f97316'],
      });
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error(err);
      }
    } finally {
      setExporting(false);
    }
  }, [exportMidi]);

  /* ---------------- mic recording -> pipeline ---------------- */
  const handleRecording = useCallback(
    (blob: Blob) => {
      void loadBlob(blob, `mic-${Date.now()}.webm`);
    },
    [loadBlob],
  );

  const statusLabel =
    status === 'decoding'
      ? 'Decoding audio…'
      : status === 'transcribing'
        ? `Transcribing… ${Math.round(progress * 100)}%`
        : status === 'ready'
          ? 'Ready'
          : 'Idle';

  return (
    <>
      <Header provider={provider} status={statusLabel} />

      {busy && (
        <div
          role="progressbar"
          aria-label="Transcription progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="h-0.5 w-full bg-line"
        >
          <div
            className="h-full bg-brand-400 transition-[width] duration-200"
            style={{ width: `${Math.max(4, progress * 100)}%` }}
          />
        </div>
      )}

      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8 [&>*]:animate-in [&>*]:fade-in [&>*]:duration-500 [&>*]:fill-mode-backwards [&>*:nth-child(2)]:delay-75 [&>*:nth-child(3)]:delay-100 [&>*:nth-child(4)]:delay-150 [&>*:nth-child(5)]:delay-200">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-500/40 animate-in fade-in slide-in-from-top-2 duration-200 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong className="font-medium">Error: </strong>
              {error}
            </span>
          </div>
        )}

        <Dropzone
          fileName={fileName}
          busy={busy}
          onFile={(f) => void loadFile(f)}
          onRecording={handleRecording}
          onClear={reset}
        />

        <ControlToolbar
          settings={settings}
          onChange={updateSettings}
          onAutoDetectKey={autoDetectKey}
          onAutoDetectTempo={autoDetectTempo}
          detectedKeyLabel={detectedKeyLabel}
          detectedTempoLabel={detectedTempoLabel}
          disabled={busy}
        />

        <WaveformView
          ref={waveRef}
          url={audioUrl}
          onTime={(t) => {
            if (!audioUrl) return;
            playheadRef.current = t;
            setCurrentTime(t);
            if (!playing) {
              seekAudition(t);
            }
          }}
          onFinish={() => {
            stopPlayback();
            playheadRef.current = effectiveDuration;
            setCurrentTime(effectiveDuration);
          }}
        />

        <section aria-labelledby="piano-roll-heading" className="space-y-2">
          <div className="flex items-center justify-between">
            <h2
              id="piano-roll-heading"
              className="text-sm font-medium text-neutral-300"
            >
              Piano roll
            </h2>
            <div className="flex items-center gap-3">
              {status === 'transcribing' && (
                <span className="inline-flex items-center gap-1.5 font-mono text-xs text-neutral-500">
                  <Loader2
                    className="h-3 w-3 animate-spin text-brand-400"
                    aria-hidden
                  />
                  {Math.round(progress * 100)}%
                </span>
              )}
              {audioUrl && !busy && (
                <button
                  type="button"
                  onClick={() => void transcribe()}
                  className="rounded border border-line-strong px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-100/5"
                >
                  Re-transcribe
                </button>
              )}
            </div>
          </div>

          {notes.length === 0 && !busy ? (
            <div
              role="status"
              className="flex h-[420px] animate-in fade-in flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line bg-surface text-center duration-300"
            >
              <p className="text-sm text-neutral-400">No notes yet</p>
              <p className="text-xs text-neutral-500">
                Load an audio file and the transcribed notes will appear here.
              </p>
            </div>
          ) : (
            <PianoRoll
              ref={rollRef}
              notes={notes}
              settings={settings}
              duration={effectiveDuration}
              playheadRef={playheadRef}
              playing={playing}
              selectedId={selectedNoteId}
              onSelect={selectNote}
              onNotesChange={commitNotes}
              onSeek={handleSeek}
            />
          )}
        </section>
      </main>

      <TransportBar
        playing={playing}
        onTogglePlay={togglePlay}
        onRewind={rewind}
        currentTime={currentTime}
        duration={effectiveDuration}
        volume={volume}
        onVolume={setVolume}
        soloSynth={soloSynth}
        soloAudio={soloAudio}
        onSoloSynth={() => setSoloSynth((s) => !s)}
        onSoloAudio={() => setSoloAudio((s) => !s)}
        onExport={handleExport}
        exporting={exporting}
        canExport={canExport}
        canPlay={canPlay}
        noteCount={notes.length}
      />
    </>
  );
}
