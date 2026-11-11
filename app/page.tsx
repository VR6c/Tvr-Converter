'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { AlertCircle, Keyboard, Loader2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';

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
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.code === 'Space') {
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
        colors: ['#5b8cff', '#8b5cf6', '#22d3ee'],
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
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <Header provider={provider} status={statusLabel} />

      {/* Progress strip */}
      {busy && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-indigo-500 transition-[width] duration-200"
            style={{ width: `${Math.max(4, progress * 100)}%` }}
          />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
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

      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-2 text-sm font-medium text-white/70">
            <Keyboard className="h-4 w-4 text-brand-400" /> Piano Roll
          </h2>
          <div className="flex items-center gap-2">
            {status === 'transcribing' && (
              <span className="inline-flex items-center gap-1.5 text-xs text-white/45">
                <Loader2 className="h-3 w-3 animate-spin text-brand-400" />
                {Math.round(progress * 100)}%
              </span>
            )}
            {audioUrl && !busy && (
              <button
                type="button"
                onClick={() => void transcribe()}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
              >
                Re-transcribe
              </button>
            )}
          </div>
        </div>

        {notes.length === 0 && !busy ? (
          <div
            className={cn(
              'flex h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-white/5 bg-[#0e1117]/60 text-center',
            )}
          >
            <Keyboard className="h-8 w-8 text-white/15" />
            <p className="text-sm text-white/40">
              Notes will appear here after transcription
            </p>
            <p className="text-xs text-white/25">
              Drop an audio file or record your mic to begin
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

      <footer className="pb-6 pt-2 text-center text-[11px] leading-relaxed text-white/25">
        All decoding, inference and MIDI generation run locally in your browser.
        <br />
        Zero audio uploaded. Built with Next.js · ONNX Runtime Web · Tone.js · Web Audio API
      </footer>
    </main>
  );
}

