'use client';

import { Activity, Cpu, Zap } from 'lucide-react';
import type { ExecutionProvider } from '@/types/audio-midi';
import { cn } from '@/lib/utils';

interface Props {
  provider: ExecutionProvider;
  status: string;
}

export default function Header({ provider, status }: Props) {
  const isGpu = provider === 'webgpu';

  return (
    <header className="flex flex-col gap-3 border-b border-white/5 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-indigo-600 shadow-lg shadow-brand-500/20">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            Audio → MIDI
          </h1>
          <p className="text-xs text-white/40">
            Client-side transcription · 100% in-browser WebGPU/WASM acceleration
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-white/35 sm:inline">{status}</span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
            isGpu
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-amber-400/30 bg-amber-400/10 text-amber-300',
          )}
          title="ONNX Runtime execution provider"
        >
          {isGpu ? (
            <Zap className="h-3 w-3" />
          ) : (
            <Cpu className="h-3 w-3" />
          )}
          {isGpu ? 'WebGPU Active' : 'WASM Fallback'}
        </span>
      </div>
    </header>
  );
}

