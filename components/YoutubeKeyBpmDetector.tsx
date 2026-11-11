'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ClipboardPaste,
  Gauge,
  Loader2,
  Music2,
  RefreshCw,
  Search,
  Youtube,
} from 'lucide-react';
import type { ConverterSettings } from '@/types/audio-midi';
import type {
  DetectKeyBpmError,
  DetectKeyBpmRequest,
  KeyBpmResult,
  KeyBpmSource,
} from '@/types/key-bpm';
import { extractVideoId } from '@/lib/youtube/videoId';
import { clamp, cn } from '@/lib/utils';

interface Props {
  settings: ConverterSettings;
  onApply: (patch: Partial<ConverterSettings>) => void;
  disabled?: boolean;
}

type Stage = 'idle' | 'lookup' | 'dsp';

/** Cache + metadata tiers answer well inside this; past it we must be in DSP. */
const DSP_STAGE_DELAY_MS = 1800;

const STAGE_LABEL: Record<Exclude<Stage, 'idle'>, string> = {
  lookup: 'Checking database…',
  dsp: 'Extracting audio stream & analyzing waveform…',
};

const SOURCE_PILL: Record<KeyBpmSource, { label: string; className: string }> = {
  metadata: {
    label: 'Verified Metadata',
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  },
  dsp_fallback: {
    label: 'Audio DSP Analyzed',
    className: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
  },
  cache: {
    label: 'Cached',
    className: 'border-white/10 bg-white/5 text-white/60',
  },
};

const APPLY_BTN =
  'inline-flex items-center gap-1 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/20 disabled:opacity-40 transition-colors';

export default function YoutubeKeyBpmDetector({ settings, onApply, disabled }: Props) {
  const [url, setUrl] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<KeyBpmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loading = stage !== 'idle';
  const trimmed = url.trim();
  const valid = extractVideoId(trimmed) !== null;
  const showInvalid = trimmed.length > 0 && !valid;

  const detect = async (target: string, forceRefresh = false) => {
    if (!extractVideoId(target)) {
      setError('Enter a valid YouTube video URL.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setStage('lookup');
    const stageTimer = setTimeout(() => setStage('dsp'), DSP_STAGE_DELAY_MS);

    try {
      const payload: DetectKeyBpmRequest = { url: target, forceRefresh };
      const res = await fetch('/api/detect-key-bpm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as
        | KeyBpmResult
        | DetectKeyBpmError
        | null;

      if (!res.ok || !data || 'error' in data) {
        setResult(null);
        setError(
          data && 'error' in data
            ? data.error
            : 'Key & BPM detection failed. Please try again.',
        );
        return;
      }
      setResult(data);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      setResult(null);
      setError('Could not reach the detection service. Check your connection.');
    } finally {
      clearTimeout(stageTimer);
      if (abortRef.current === controller) setStage('idle');
    }
  };

  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return;
      setUrl(text);
      if (extractVideoId(text)) void detect(text);
    } catch {
      // Clipboard permission denied — the user can still paste manually.
    }
  };

  const targetBpm = result ? clamp(result.bpm, 40, 240) : 0;
  const keyApplied =
    !!result &&
    settings.keyRoot === result.key &&
    settings.scaleMode === result.scale;
  const tempoApplied = !!result && settings.tempoBpm === targetBpm;
  const pill = result ? SOURCE_PILL[result.source] : null;

  return (
    <section className="rounded-2xl border border-white/5 bg-[#12151c]/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Youtube className="h-4 w-4 text-red-400" />
        <h2 className="text-sm font-medium text-white/70">
          Detect Key &amp; BPM from YouTube
        </h2>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void detect(trimmed);
        }}
      >
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-label="YouTube URL"
          aria-invalid={showInvalid}
          spellCheck={false}
          autoComplete="off"
          className={cn(
            'min-w-0 flex-1 basis-64 rounded-lg border bg-black/30 px-3 py-2 text-xs text-white/85 outline-none transition-colors placeholder:text-white/25',
            showInvalid
              ? 'border-red-500/50 focus:border-red-500/70'
              : 'border-white/10 focus:border-brand-500/60',
          )}
        />
        <button
          type="button"
          onClick={() => void handlePaste()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> Paste
        </button>
        <button
          type="submit"
          disabled={!valid || loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Detect
        </button>
      </form>

      {showInvalid && !error && (
        <p className="mt-2 text-xs text-red-300/80">
          That doesn&apos;t look like a YouTube video link.
        </p>
      )}

      {loading && (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 flex items-center gap-2 text-xs text-white/55"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
          </span>
          {STAGE_LABEL[stage]}
        </div>
      )}

      {error && !loading && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && pill && (
        <div
          className={cn(
            'mt-3 space-y-3 border-t border-white/5 pt-3 transition-opacity',
            loading && 'opacity-50',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-white/60">
              <span className="font-medium text-white/85">{result.title || 'Untitled'}</span>
              {result.artist && <span> · {result.artist}</span>}
            </p>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                  pill.className,
                )}
              >
                {pill.label}
              </span>
              <span className="text-[11px] text-white/35">
                {Math.round(result.confidence * 100)}% confidence
              </span>
              <button
                type="button"
                onClick={() =>
                  void detect(`https://www.youtube.com/watch?v=${result.videoId}`, true)
                }
                disabled={loading}
                title="Ignore the cache and analyze again"
                aria-label="Re-analyze"
                className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300">
                <Music2 className="h-3 w-3 text-emerald-400" />
                <strong className="font-semibold text-emerald-200">
                  {result.key} {result.scale === 'major' ? 'Major' : 'Minor'}
                </strong>
              </div>
              <button
                type="button"
                disabled={disabled || keyApplied}
                onClick={() => onApply({ keyRoot: result.key, scaleMode: result.scale })}
                className={APPLY_BTN}
              >
                {keyApplied ? (
                  <>
                    <Check className="h-3 w-3" /> Applied
                  </>
                ) : (
                  'Apply to Converter'
                )}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-300">
                <Gauge className="h-3 w-3 text-cyan-400" />
                <strong className="font-semibold text-cyan-200">{result.bpm} BPM</strong>
              </div>
              <button
                type="button"
                disabled={disabled || tempoApplied}
                onClick={() => onApply({ tempoBpm: targetBpm })}
                className={APPLY_BTN}
              >
                {tempoApplied ? (
                  <>
                    <Check className="h-3 w-3" /> Applied
                  </>
                ) : (
                  'Apply to Grid'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
