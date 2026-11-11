'use client';

import { Cpu, Moon, Sun, Zap } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import type { ExecutionProvider } from '@/types/audio-midi';
import { cn } from '@/lib/utils';

interface Props {
  provider: ExecutionProvider;
  status: string;
}

export default function Header({ provider, status }: Props) {
  const isGpu = provider === 'webgpu';
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight text-neutral-100">
            Audio → MIDI
          </h1>
          <p className="hidden truncate text-xs text-neutral-500 md:block">
            Transcription runs entirely in your browser
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span
            role="status"
            aria-live="polite"
            className="font-mono text-xs text-neutral-400"
          >
            {status}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium',
              isGpu
                ? 'border-brand-500/50 text-brand-300'
                : 'border-line-strong text-neutral-400',
            )}
            title="ONNX Runtime execution provider"
          >
            {isGpu ? (
              <Zap className="h-3 w-3" aria-hidden />
            ) : (
              <Cpu className="h-3 w-3" aria-hidden />
            )}
            {isGpu ? 'WebGPU' : 'WASM'}
          </span>
          <button
            type="button"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100/5 hover:text-neutral-100"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            {isDark ? (
              <Sun key="sun" className="h-4 w-4 animate-in spin-in-90 fade-in duration-300" aria-hidden />
            ) : (
              <Moon key="moon" className="h-4 w-4 animate-in -spin-in-90 fade-in duration-300" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
