'use client';

import dynamic from 'next/dynamic';
import { useCallback, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import Header from '@/components/Header';
import Dropzone from '@/components/Dropzone';
import ControlToolbar from '@/components/ControlToolbar';
import type { WaveformHandle } from '@/components/WaveformView';
import type { PianoRollHandle } from '@/components/PianoRoll';
import { useConverterStore } from '@/lib/store/useConverterStore';
import { usePlayback } from '@/hooks/usePlayback';

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
  const [exporting, setExporting] = useState(false);

  const busy = status === 'decoding' || status === 'transcribing';
  const notesDuration = notes.reduce(
    (max, n) => Math.max(max, n.startTime + n.duration),
    0,
  );
  const effectiveDuration = audioDuration > 0 ? audioDuration : notesDuration;
  const canPlay = !busy && (Boolean(audioUrl) || notes.length > 0);
  const canExport = notes.length > 0;

  const {
    playheadRef,
    playing,
    togglePlay,
    rewind,
    seek,
    handleWaveTime,
    handleWaveFinish,
  } = usePlayback({
    waveRef,
    audioUrl,
    notes,
    octaveOffset: settings.octaveOffset,
    duration: effectiveDuration,
    canPlay,
  });

  /* ---------------- export ---------------- */
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportMidi();
      const { default: confetti } = await import('canvas-confetti');
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
          onTime={handleWaveTime}
          onFinish={handleWaveFinish}
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
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={!canExport || exporting}
                className="inline-flex items-center gap-1.5 rounded bg-brand-500 px-3 py-1 text-xs font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {exporting ? 'Exporting…' : 'Download .mid'}
              </button>
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
              onSeek={seek}
            />
          )}
        </section>
      </main>
    </>
  );
}
