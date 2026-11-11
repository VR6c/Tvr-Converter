'use client';

import { useCallback, useRef, useState } from 'react';
import { FileAudio, Loader2, UploadCloud, X } from 'lucide-react';
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
  onClear,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <section className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        className={cn(
          'group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-10 transition-colors',
          dragging
            ? 'border-brand-500 bg-brand-500/10'
            : 'border-white/10 bg-[#12151c]/60 hover:border-white/25 hover:bg-[#151922]/60',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />

        {busy ? (
          <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
        ) : (
          <UploadCloud className="h-8 w-8 text-white/30 transition-colors group-hover:text-brand-400" />
        )}

        <p className="text-sm font-medium text-white/80">
          {busy ? 'Processing audio…' : 'Drop an audio file, or click to browse'}
        </p>
        <p className="text-xs text-white/35">
          WAV · MP3 · M4A · AAC · FLAC · OGG — up to 100 MB
        </p>

        {fileName && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/70">
            <FileAudio className="h-3.5 w-3.5 text-brand-400" />
            <span className="max-w-[240px] truncate">{fileName}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"
              aria-label="Clear file"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

