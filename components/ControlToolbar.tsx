'use client';

import { useRef, useState } from 'react';
import { Gauge, Sparkles, Wand2 } from 'lucide-react';
import type {
  ConverterSettings,
  GridDivision,
  ProcessingMode,
  SensitivityLevel,
  SnapIntensity,
} from '@/types/audio-midi';
import { NOTE_NAMES, SCALE_LABELS } from '@/lib/dsp/quantizer';
import { cn } from '@/lib/utils';
import Select from '@/components/Select';

interface Props {
  settings: ConverterSettings;
  onChange: (patch: Partial<ConverterSettings>) => void;
  onAutoDetectKey?: () => void;
  onAutoDetectTempo?: () => void;
  onAutoDetect?: () => void;
  detectedKeyLabel: string | null;
  detectedTempoLabel?: string | null;
  disabled?: boolean;
}

const SEG = 'flex rounded-lg bg-black/30 p-0.5 gap-0.5';

function Segmented<T extends string>({
  value,
  options,
  onSelect,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onSelect: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={SEG}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40',
            value === o.value
              ? 'bg-brand-500 text-white shadow-sm'
              : 'text-white/55 hover:bg-white/10 hover:text-white/80',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
        {label}
      </span>
      {children}
    </div>
  );
}

const KEY_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  ...NOTE_NAMES.map((n) => ({ value: n, label: n })),
];

const SCALE_OPTIONS = Object.entries(SCALE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export default function ControlToolbar({
  settings,
  onChange,
  onAutoDetectKey,
  onAutoDetectTempo,
  onAutoDetect,
  detectedKeyLabel,
  detectedTempoLabel,
  disabled,
}: Props) {
  const tapTimesRef = useRef<number[]>([]);
  const [tapCount, setTapCount] = useState(0);

  const handleKeyDetect = onAutoDetectKey ?? onAutoDetect;

  const handleTapTempo = () => {
    const now = performance.now();
    // Drop taps older than 2.5s
    const history = tapTimesRef.current.filter((t) => now - t < 2500);
    history.push(now);
    tapTimesRef.current = history;
    setTapCount(history.length);

    if (history.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < history.length; i++) {
        intervals.push(history[i] - history[i - 1]);
      }
      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval > 0) {
        const bpm = Math.round(60000 / avgInterval);
        const clamped = Math.min(240, Math.max(40, bpm));
        onChange({ tempoBpm: clamped });
      }
    }
  };

  return (
    <section className="rounded-2xl border border-white/5 bg-[#12151c]/60 p-4">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
        <Field label="Mode">
          <Segmented<ProcessingMode>
            value={settings.mode}
            disabled={disabled}
            onSelect={(mode) => onChange({ mode })}
            options={[
              { value: 'voice', label: 'Voice' },
              { value: 'instrument', label: 'Instrument' },
            ]}
          />
        </Field>

        <Field label="Key & Scale">
          <div className="flex items-center gap-1.5">
            <Select
              aria-label="Key"
              className="w-[4.5rem]"
              disabled={disabled}
              value={settings.keyRoot}
              onChange={(keyRoot) => onChange({ keyRoot })}
              options={KEY_OPTIONS}
            />

            <Select
              aria-label="Scale"
              className="min-w-28"
              disabled={disabled}
              value={settings.scaleMode}
              onChange={(scaleMode) => onChange({ scaleMode })}
              options={SCALE_OPTIONS}
            />

            {handleKeyDetect && (
              <button
                type="button"
                onClick={handleKeyDetect}
                disabled={disabled}
                title="Auto-detect musical key & scale from transcribed notes"
                className="inline-flex items-center gap-1 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/20 disabled:opacity-40 transition-colors"
              >
                <Wand2 className="h-3 w-3" /> Auto Detect
              </button>
            )}
          </div>
        </Field>

        <Field label="Note Snap">
          <Segmented<SnapIntensity>
            value={settings.snapIntensity}
            disabled={disabled}
            onSelect={(snapIntensity) => onChange({ snapIntensity })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'soft', label: 'Soft' },
              { value: 'perfect', label: 'Perfect' },
            ]}
          />
        </Field>

        <Field label="Catch Every Note">
          <Segmented<SensitivityLevel>
            value={settings.sensitivity}
            disabled={disabled}
            onSelect={(sensitivity) => onChange({ sensitivity })}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'mid', label: 'Mid' },
              { value: 'high', label: 'High' },
            ]}
          />
        </Field>

        <Field label="Timing Grid">
          <Segmented<GridDivision>
            value={settings.gridDivision}
            disabled={disabled}
            onSelect={(gridDivision) => onChange({ gridDivision })}
            options={[
              { value: 'off', label: 'Off' },
              { value: '1/8', label: '1/8' },
              { value: '1/16', label: '1/16' },
              { value: '1/32', label: '1/32' },
            ]}
          />
        </Field>

        <Field label="Tempo (BPM)">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={40}
              max={240}
              step={1}
              disabled={disabled}
              value={settings.tempoBpm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) {
                  onChange({ tempoBpm: Math.min(240, Math.max(40, v)) });
                }
              }}
              className="w-18 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white/85 outline-none focus:border-brand-500/60 disabled:opacity-40"
            />

            {onAutoDetectTempo && (
              <button
                type="button"
                onClick={onAutoDetectTempo}
                disabled={disabled}
                title="Auto-detect BPM from audio onset energy and note timing"
                className="inline-flex items-center gap-1 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/20 disabled:opacity-40 transition-colors"
              >
                <Wand2 className="h-3 w-3" /> Auto Detect
              </button>
            )}

            <div className="flex items-center rounded-lg bg-black/30 p-0.5 gap-0.5">
              <button
                type="button"
                onClick={handleTapTempo}
                disabled={disabled}
                title="Tap along to rhythmic beat to set tempo"
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40',
                  tapCount > 1
                    ? 'bg-brand-500/30 text-brand-200'
                    : 'text-white/60 hover:bg-white/10 hover:text-white',
                )}
              >
                TAP
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    tempoBpm: Math.max(40, Math.round(settings.tempoBpm / 2)),
                  })
                }
                disabled={disabled || settings.tempoBpm <= 40}
                title="Halve tempo (/2)"
                className="rounded-md px-1.5 py-1 text-[11px] font-medium text-white/50 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40"
              >
                /2
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    tempoBpm: Math.min(240, Math.round(settings.tempoBpm * 2)),
                  })
                }
                disabled={disabled || settings.tempoBpm >= 240}
                title="Double tempo (x2)"
                className="rounded-md px-1.5 py-1 text-[11px] font-medium text-white/50 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40"
              >
                x2
              </button>
            </div>
          </div>
        </Field>

        <Field label="Octave Shift">
          <Segmented<string>
            value={String(settings.octaveOffset)}
            disabled={disabled}
            onSelect={(v) => onChange({ octaveOffset: Number(v) })}
            options={[
              { value: '-2', label: '-2' },
              { value: '-1', label: '-1' },
              { value: '0', label: '0' },
              { value: '1', label: '+1' },
              { value: '2', label: '+2' },
            ]}
          />
        </Field>
      </div>

      {(detectedKeyLabel || detectedTempoLabel) && (
        <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-white/5 pt-3">
          {detectedKeyLabel && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
              <Sparkles className="h-3 w-3 text-emerald-400" />
              <span>
                Detected Key:{' '}
                <strong className="font-semibold text-emerald-200">
                  {detectedKeyLabel}
                </strong>
              </span>
            </div>
          )}
          {detectedTempoLabel && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-300">
              <Gauge className="h-3 w-3 text-cyan-400" />
              <span>
                Detected Tempo:{' '}
                <strong className="font-semibold text-cyan-200">
                  {detectedTempoLabel}
                </strong>
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
