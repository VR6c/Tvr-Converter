'use client';

import {
  Layers,
  Maximize2,
  MousePointer,
  Paintbrush,
  Pencil,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { KeyLabelMode, ToolMode } from './types';
import { cn } from '@/lib/utils';

interface Props {
  activeTool: ToolMode;
  onToolChange: (tool: ToolMode) => void;
  keyLabelMode: KeyLabelMode;
  onKeyLabelModeChange: (mode: KeyLabelMode) => void;
  contrastMode: boolean;
  onContrastModeChange: (contrast: boolean) => void;
  rowHeight: number;
  onRowHeightChange: (h: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitContent: () => void;
  onJumpToOctave: (octave: number) => void;
  onShiftOctave: (delta: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  noteCount: number;
}

const TOOLS: { id: ToolMode; label: string; icon: React.ElementType; shortcut: string }[] = [
  { id: 'select', label: 'Select (1)', icon: MousePointer, shortcut: '1' },
  { id: 'draw', label: 'Draw / Pencil (2)', icon: Pencil, shortcut: '2' },
  { id: 'paint', label: 'Paint / Brush (3)', icon: Paintbrush, shortcut: '3' },
  { id: 'slice', label: 'Slice / Cut (4)', icon: Scissors, shortcut: '4' },
  { id: 'mute', label: 'Mute Note (5)', icon: VolumeX, shortcut: '5' },
  { id: 'erase', label: 'Eraser (6)', icon: Trash2, shortcut: '6' },
];

const LABEL_MODES: { id: KeyLabelMode; label: string; title: string }[] = [
  { id: 'all', label: 'All Notes', title: 'Show Western note labels (C, C#, D...) on all keys' },
  { id: 'octaves', label: 'Octaves', title: 'Show root note names (C3, C4...) on C keys only' },
  { id: 'scale', label: 'In Scale', title: 'Highlight note names belonging to active scale' },
  { id: 'none', label: 'Clean', title: 'Minimalist keybed without text guides' },
];

export default function PianoRollToolbar({
  activeTool,
  onToolChange,
  keyLabelMode,
  onKeyLabelModeChange,
  contrastMode,
  onContrastModeChange,
  rowHeight,
  onRowHeightChange,
  onZoomIn,
  onZoomOut,
  onFitContent,
  onJumpToOctave,
  onShiftOctave,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  noteCount,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0d1017] px-3 py-2 text-xs select-none">
      {/* Left section: Global editing tools & Undo/Redo */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center rounded-lg bg-black/40 p-0.5 border border-white/5">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = activeTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onToolChange(t.id)}
                title={t.label}
                className={cn(
                  'flex items-center justify-center rounded-md p-1.5 transition-colors',
                  active
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'text-white/50 hover:bg-white/10 hover:text-white',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>

        <div className="h-4 w-px bg-white/10 mx-0.5" />

        <div className="flex items-center rounded-lg bg-black/40 p-0.5 border border-white/5">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo edit (⌘Z)"
            className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo edit (⌘⇧Z)"
            className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Middle section: Octave navigation & Key labels guide */}
      <div className="flex items-center gap-2">
        {/* Octave Range Jumpers */}
        <div className="hidden sm:flex items-center gap-1 rounded-lg bg-black/40 p-0.5 border border-white/5">
          <button
            type="button"
            onClick={() => onShiftOctave(1)}
            title="Shift view up 1 octave"
            className="px-1.5 py-1 text-[11px] font-medium text-white/60 hover:bg-white/10 hover:text-white rounded"
          >
            ▲ Oct
          </button>
          {[2, 3, 4, 5, 6].map((oct) => (
            <button
              key={oct}
              type="button"
              onClick={() => onJumpToOctave(oct)}
              title={`Jump view to C${oct}`}
              className="px-1.5 py-1 text-[11px] font-mono text-white/50 hover:bg-brand-500/20 hover:text-brand-300 rounded"
            >
              C{oct}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onShiftOctave(-1)}
            title="Shift view down 1 octave"
            className="px-1.5 py-1 text-[11px] font-medium text-white/60 hover:bg-white/10 hover:text-white rounded"
          >
            ▼ Oct
          </button>
        </div>

        {/* Key Guides Selector */}
        <div className="flex items-center gap-1 rounded-lg bg-black/40 p-0.5 border border-white/5">
          <span className="pl-1.5 pr-0.5 text-[10px] uppercase font-semibold text-white/35">
            Keys:
          </span>
          {LABEL_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onKeyLabelModeChange(m.id)}
              title={m.title}
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                keyLabelMode === m.id
                  ? 'bg-white/20 text-white'
                  : 'text-white/50 hover:bg-white/10 hover:text-white/80',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right section: Contrast mode, Zoom & Fit */}
      <div className="flex items-center gap-1.5">
        {/* Ghost / Contrast Notes Toggle */}
        <button
          type="button"
          onClick={() => onContrastModeChange(!contrastMode)}
          title="Ghost / Contrast Notes: differentiate sustained chords vs staccato melody/bass notes"
          className={cn(
            'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors',
            contrastMode
              ? 'border-indigo-500/40 bg-indigo-500/20 text-indigo-300'
              : 'border-white/5 bg-black/40 text-white/50 hover:bg-white/10 hover:text-white',
          )}
        >
          <Layers className="h-3 w-3" />
          <span className="hidden md:inline">Contrast Notes</span>
        </button>

        {/* Row height selector */}
        <div className="flex items-center rounded-lg bg-black/40 p-0.5 border border-white/5">
          <button
            type="button"
            onClick={() => onRowHeightChange(rowHeight === 14 ? 18 : rowHeight === 18 ? 22 : 14)}
            title={`Row Height: ${rowHeight}px. Click to cycle`}
            className="px-1.5 py-1 text-[10px] font-mono text-white/50 hover:text-white"
          >
            {rowHeight}px
          </button>
        </div>

        {/* Zoom controls & Fit to content */}
        <div className="flex items-center rounded-lg bg-black/40 p-0.5 border border-white/5">
          <button
            type="button"
            onClick={onZoomOut}
            title="Zoom out timeline (-)"
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            title="Zoom in timeline (+)"
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onFitContent}
            title="Fit to Content: frame all notes in view"
            className="rounded p-1 text-white/50 hover:bg-brand-500/20 hover:text-brand-300"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {noteCount > 0 && (
          <span className="ml-1 hidden xl:inline text-[10px] font-mono text-white/35">
            {noteCount} {noteCount === 1 ? 'note' : 'notes'}
          </span>
        )}
      </div>
    </div>
  );
}

