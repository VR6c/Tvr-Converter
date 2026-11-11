'use client';

import { useCallback, useRef, useState } from 'react';
import { FileAudio, Loader2, Mic, Square, Upload, X } from 'lucide-react';
import { useRecorder } from '@/hooks/useRecorder';
import { cn } from '@/lib/utils';

interface Props {
  fileName: string | null;
  busy: boolean;
  onFile: (file: File) => void;
  onRecording?: (blob: Blob) => void;
  onClear: () => void;
}

export default function Dropzone({
  fileName,
  busy,
  onFile,
  onRecording,
  onClear,
}: Props) {
  const recorder = useRecorder((blob) => onRecording?.(blob));
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    if (!busy) inputRef.current?.click();
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const hasFile = Boolean(fileName);

  const micButton = (
    <button
      type="button"
      onClick={recorder.recording ? recorder.stop : recorder.start}
      disabled={busy}
      aria-pressed={recorder.recording}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40',
        recorder.recording
          ? 'border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-200'
          : 'border-line-strong text-neutral-300 hover:bg-neutral-100/5',
      )}
    >
      {recorder.recording ? (
        <>
          <Square className="h-3 w-3 fill-current" aria-hidden /> Stop
          <span
            aria-hidden
            className="ml-1 h-1.5 rounded-full bg-red-500 animate-pulse"
            style={{ width: `${4 + recorder.level * 28}px` }}
          />
        </>
      ) : (
        <>
          <Mic className="h-3 w-3" aria-hidden /> Record
        </>
      )}
    </button>
  );

  return (
    <section aria-label="Audio source">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg"
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'rounded-md border transition-colors',
          hasFile ? 'border-line bg-surface' : 'border-dashed',
          !hasFile &&
            (dragging
              ? 'border-brand-400 bg-brand-500/10'
              : 'border-line-strong bg-surface'),
          dragging && hasFile && 'border-brand-400 bg-brand-500/10',
        )}
      >
        {hasFile ? (
          <div className="flex animate-in fade-in slide-in-from-top-1 flex-wrap items-center gap-3 px-4 py-3 duration-300">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand-400" aria-hidden />
            ) : (
              <FileAudio className="h-4 w-4 text-brand-400" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-neutral-200">
              {fileName}
            </span>
            {micButton}
            <button
              type="button"
              onClick={openPicker}
              disabled={busy || recorder.recording}
              className="rounded border border-line-strong px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-100/5 disabled:opacity-40"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100/5 hover:text-neutral-200"
              aria-label="Clear file"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex animate-in fade-in flex-col items-center gap-3 px-6 py-10 text-center duration-300">
            {busy ? (
              <Loader2 className="h-6 w-6 animate-spin text-brand-400" aria-hidden />
            ) : (
              <Upload className="h-6 w-6 text-neutral-500" aria-hidden />
            )}
            <p className="text-sm font-medium text-neutral-200">
              {busy ? 'Processing audio…' : 'Drop an audio file here, or choose a source'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openPicker}
                disabled={busy || recorder.recording}
                className="rounded bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
              >
                Browse files
              </button>
              {micButton}
            </div>
            <p className="text-xs text-neutral-500">
              WAV, MP3, M4A, AAC, FLAC, OGG · up to 100 MB · never leaves this device
            </p>
            {recorder.error && (
              <p role="alert" className="text-xs text-red-700 dark:text-red-300">
                {recorder.error}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
