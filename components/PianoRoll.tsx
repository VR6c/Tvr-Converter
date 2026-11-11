'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ConverterSettings, TranscribedNote } from '@/types/audio-midi';
import {
  gridStepSeconds,
  noteNameToPitchClass,
  SCALE_INTERVALS,
} from '@/lib/dsp/quantizer';
import { clamp, midiToName, uid } from '@/lib/utils';
import { previewNote } from '@/lib/audio/synth';
import PianoRollToolbar from './PianoRoll/PianoRollToolbar';
import PianoRollMinimap from './PianoRoll/PianoRollMinimap';
import type { KeyLabelMode, ToolMode } from './PianoRoll/types';

const KEY_W = 64;
const BLACK_KEY_W = 38;
const RULER_H = 24;
const MIN_PPS = 18;
const MAX_PPS = 900;
const EDGE = 6;
const MIN_PITCH = 21; // A0
const MAX_PITCH = 108; // C8
const ROW_COUNT = MAX_PITCH - MIN_PITCH + 1;
const BLACK = new Set([1, 3, 6, 8, 10]);
const PRESS_IN_MS = 60;
const PRESS_FADE_MS = 320;
const HISTORY_LIMIT = 100;
const ACCENT = '91, 140, 255';
const PLAYHEAD = '#f97316';

const TOOL_KEYS: Record<string, ToolMode> = {
  '1': 'select',
  '2': 'draw',
  '3': 'paint',
  '4': 'slice',
  '5': 'mute',
  '6': 'erase',
};

export interface PianoRollHandle {
  redraw: () => void;
  centerOnPitch: (pitch: number) => void;
}

interface Props {
  notes: TranscribedNote[];
  settings: ConverterSettings;
  duration: number;
  playheadRef: React.MutableRefObject<number>;
  playing: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNotesChange: (notes: TranscribedNote[]) => void;
  onSeek?: (time: number) => void;
}

type DragMode = 'move' | 'resize-l' | 'resize-r';

type Gesture =
  | {
      kind: 'note';
      mode: DragMode;
      id: string;
      startX: number;
      startY: number;
      orig: TranscribedNote;
      base: TranscribedNote[];
      working: TranscribedNote;
      created: boolean;
    }
  | { kind: 'scrub' }
  | { kind: 'keys'; pitch: number }
  | { kind: 'paint'; len: number; lastCell: number; working: TranscribedNote[]; added: number }
  | { kind: 'erase'; working: TranscribedNote[] }
  | { kind: 'mute'; target: boolean; working: TranscribedNote[]; changed: boolean };

interface KeyPress {
  down: boolean;
  at: number;
}

const isBlack = (p: number) => BLACK.has(((p % 12) + 12) % 12);
const pitchClassName = (p: number) => midiToName(p).replace(/-?\d+$/, '');

/** Blue (soft) -> violet -> coral (hard); louder notes are also brighter. */
const velHsl = (v: number, lift = 0): string => {
  const t = clamp(v, 0, 1);
  const h = 215 - t * 200;
  const s = 70 + t * 20;
  const l = 44 + t * 18 + lift;
  return `hsl(${h} ${s}% ${l}%)`;
};

/** Split per-sample arrays (pitch bend) proportionally when slicing a note. */
const splitArray = (arr: number[] | undefined, ratio: number) => {
  if (!arr || arr.length === 0) return [undefined, undefined] as const;
  const i = clamp(Math.round(arr.length * ratio), 1, arr.length - 1);
  return [arr.slice(0, i), arr.slice(i)] as const;
};

const PianoRoll = forwardRef<PianoRollHandle, Props>(function PianoRoll(
  {
    notes,
    settings,
    duration,
    playheadRef,
    playing,
    selectedId,
    onSelect,
    onNotesChange,
    onSeek,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pps, setPps] = useState(150);
  const [rowH, setRowH] = useState(14);
  const [scrollX, setScrollX] = useState(0); // seconds
  const [scrollY, setScrollY] = useState((MAX_PITCH - 66) * 14);
  const [tool, setTool] = useState<ToolMode>('select');
  const [keyLabelMode, setKeyLabelMode] = useState<KeyLabelMode>('octaves');
  const [contrastMode, setContrastMode] = useState(false);
  const [draft, setDraft] = useState<TranscribedNote[] | null>(null);
  const [, setHistoryTick] = useState(0);

  const gestureRef = useRef<Gesture | null>(null);
  const pressRef = useRef(new Map<number, KeyPress>());
  const hoverPitchRef = useRef<number | null>(null);
  const animRef = useRef(0);
  const playRafRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const lastLenRef = useRef(0);
  const pastRef = useRef<TranscribedNote[][]>([]);
  const futureRef = useRef<TranscribedNote[][]>([]);
  const lastCommittedRef = useRef(notes);
  const didFitRef = useRef(false);

  const gridW = Math.max(0, size.w - KEY_W);
  const gridH = Math.max(0, size.h - RULER_H);
  const step = gridStepSeconds(settings.tempoBpm, settings.gridDivision);
  const beat = 60 / settings.tempoBpm;
  const octaveShift = clamp(Math.round(settings.octaveOffset), -2, 2) * 12;
  const notesEnd = notes.reduce((m, n) => Math.max(m, n.startTime + n.duration), 0);
  const totalDuration = Math.max(duration, notesEnd, 1);

  const maxScrollY = useCallback(
    (rh: number) => Math.max(0, ROW_COUNT * rh - gridH),
    [gridH],
  );

  const snapTime = useCallback(
    (t: number) => (step > 0 ? Math.round(t / step) * step : Math.round(t * 1000) / 1000),
    [step],
  );

  /* ---------------- geometry ---------------- */
  const timeToX = useCallback((t: number) => KEY_W + (t - scrollX) * pps, [scrollX, pps]);
  const xToTime = useCallback((x: number) => (x - KEY_W) / pps + scrollX, [scrollX, pps]);
  const pitchToY = useCallback(
    (p: number) => RULER_H + (MAX_PITCH - p) * rowH - scrollY,
    [scrollY, rowH],
  );
  const yToPitch = useCallback(
    (y: number) => MAX_PITCH - Math.floor((y - RULER_H + scrollY) / rowH),
    [scrollY, rowH],
  );

  /* ---------------- active scale (for "In Scale" labels) ---------------- */
  const scale = useMemo(() => {
    if (!settings.keyRoot || settings.keyRoot === 'auto') return null;
    const root = noteNameToPitchClass(settings.keyRoot);
    const intervals = SCALE_INTERVALS[settings.scaleMode] ?? SCALE_INTERVALS.chromatic;
    return { root, set: new Set(intervals.map((i) => (i + root) % 12)) };
  }, [settings.keyRoot, settings.scaleMode]);

  /* ---------------- contrast: top voice = melody, rest = accompaniment ---------------- */
  const visibleNotes = draft ?? notes;
  const melodyIds = useMemo(() => {
    if (!contrastMode) return null;
    const sorted = [...visibleNotes].sort((a, b) => a.startTime - b.startTime);
    const maxDur = sorted.reduce((m, n) => Math.max(m, n.duration), 0);
    const ids = new Set<string>();
    let lo = 0;
    for (const n of sorted) {
      const end = n.startTime + n.duration;
      while (lo < sorted.length && sorted[lo].startTime < n.startTime - maxDur) lo++;
      let covered = false;
      for (let j = lo; j < sorted.length && sorted[j].startTime < end; j++) {
        const o = sorted[j];
        if (o === n || o.muted || o.pitch <= n.pitch) continue;
        const overlap =
          Math.min(end, o.startTime + o.duration) - Math.max(n.startTime, o.startTime);
        if (overlap > n.duration * 0.5) {
          covered = true;
          break;
        }
      }
      if (!covered) ids.add(n.id);
    }
    return ids;
  }, [contrastMode, visibleNotes]);

  /* ---------------- history (undo / redo) ---------------- */
  useEffect(() => {
    // Notes replaced from outside (re-transcription, scale/grid changes): history is stale.
    if (notes !== lastCommittedRef.current) {
      pastRef.current = [];
      futureRef.current = [];
      lastCommittedRef.current = notes;
      setHistoryTick((t) => t + 1);
    }
  }, [notes]);

  const commit = useCallback(
    (next: TranscribedNote[]) => {
      pastRef.current.push(notes);
      if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
      futureRef.current = [];
      lastCommittedRef.current = next;
      onNotesChange(next);
      setHistoryTick((t) => t + 1);
    },
    [notes, onNotesChange],
  );

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(notes);
    lastCommittedRef.current = prev;
    onNotesChange(prev);
    setHistoryTick((t) => t + 1);
  }, [notes, onNotesChange]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(notes);
    lastCommittedRef.current = next;
    onNotesChange(next);
    setHistoryTick((t) => t + 1);
  }, [notes, onNotesChange]);

  /* ---------------- resize observer ---------------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  /* ---------------- navigation ---------------- */
  const centerOnPitch = useCallback(
    (pitch: number, rh = rowH) => {
      setScrollY(clamp((MAX_PITCH - pitch + 0.5) * rh - gridH / 2, 0, maxScrollY(rh)));
    },
    [rowH, gridH, maxScrollY],
  );

  const zoomAround = useCallback(
    (factor: number, anchorX: number) => {
      const anchorTime = xToTime(anchorX);
      const next = clamp(pps * factor, MIN_PPS, MAX_PPS);
      setPps(next);
      setScrollX(Math.max(0, anchorTime - (anchorX - KEY_W) / next));
    },
    [pps, xToTime],
  );

  const fitContent = useCallback(() => {
    if (gridW <= 0) return;
    if (notes.length === 0) {
      setScrollX(0);
      centerOnPitch(60);
      return;
    }
    let minT = Infinity;
    let maxT = 0;
    let minP = 127;
    let maxP = 0;
    for (const n of notes) {
      minT = Math.min(minT, n.startTime);
      maxT = Math.max(maxT, n.startTime + n.duration);
      minP = Math.min(minP, n.pitch);
      maxP = Math.max(maxP, n.pitch);
    }
    const span = Math.max(0.5, maxT - minT);
    setPps(clamp((gridW * 0.94) / span, MIN_PPS, MAX_PPS));
    setScrollX(Math.max(0, minT - span * 0.03));
    centerOnPitch((minP + maxP) / 2);
  }, [gridW, notes, centerOnPitch]);

  useEffect(() => {
    if (didFitRef.current || size.w === 0) return;
    didFitRef.current = true;
    fitContent();
  }, [size.w, fitContent]);

  const shiftOctave = useCallback(
    (delta: number) => {
      setScrollY((s) => clamp(s - delta * 12 * rowH, 0, maxScrollY(rowH)));
    },
    [rowH, maxScrollY],
  );

  const changeRowHeight = useCallback(
    (nh: number) => {
      const centerRow = (scrollY + gridH / 2) / rowH;
      setRowH(nh);
      setScrollY(clamp(centerRow * nh - gridH / 2, 0, maxScrollY(nh)));
    },
    [scrollY, gridH, rowH, maxScrollY],
  );

  /* ---------------- key press animation ---------------- */
  const kickAnim = useCallback(() => {
    if (animRef.current) return;
    const tick = () => {
      drawRef.current();
      const now = performance.now();
      let alive = false;
      pressRef.current.forEach((k, p) => {
        if (k.down || now - k.at < PRESS_FADE_MS) alive = true;
        else pressRef.current.delete(p);
      });
      animRef.current = alive ? requestAnimationFrame(tick) : 0;
    };
    animRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const pressKey = useCallback(
    (pitch: number, audible = true, velocity = 0.8) => {
      pressRef.current.set(pitch, { down: true, at: performance.now() });
      if (audible) previewNote(pitch + octaveShift, 0.35, velocity);
      kickAnim();
    },
    [octaveShift, kickAnim],
  );

  const releaseKey = useCallback(
    (pitch: number) => {
      const k = pressRef.current.get(pitch);
      if (k?.down) {
        k.down = false;
        k.at = performance.now();
      }
      kickAnim();
    },
    [kickAnim],
  );

  /** Brief tap on the keybed — visual confirmation for note-level actions. */
  const flashKey = useCallback(
    (pitch: number, audible: boolean, velocity = 0.8) => {
      pressKey(pitch, audible, velocity);
      window.setTimeout(() => releaseKey(pitch), 120);
    },
    [pressKey, releaseKey],
  );

  /* ---------------- draw ---------------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { w, h } = size;
    if (w === 0 || h === 0) return;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, w, h);

    const now = performance.now();
    const ph = playheadRef.current;
    const list = draft ?? notes;
    const visStart = scrollX;
    const visEnd = scrollX + gridW / pps;
    const pTop = clamp(yToPitch(RULER_H), MIN_PITCH, MAX_PITCH);
    const pBottom = clamp(yToPitch(h - 1), MIN_PITCH, MAX_PITCH);

    // Pitches currently sounding under the playhead light up the keybed.
    const sounding = new Set<number>();
    if (playing) {
      for (const n of list) {
        if (!n.muted && ph >= n.startTime && ph < n.startTime + n.duration) sounding.add(n.pitch);
      }
    }

    const keyState = (p: number) => {
      let depress = 0;
      let glow = 0;
      const k = pressRef.current.get(p);
      if (k) {
        if (k.down) {
          depress = Math.min(1, (now - k.at) / PRESS_IN_MS);
          glow = 1;
        } else {
          const t = Math.max(0, 1 - (now - k.at) / PRESS_FADE_MS);
          depress = t * t;
          glow = t;
        }
      }
      if (sounding.has(p)) {
        depress = 1;
        glow = Math.max(glow, 0.7);
      }
      return { depress, glow };
    };

    /* ===== grid area (clipped) ===== */
    ctx.save();
    ctx.beginPath();
    ctx.rect(KEY_W, RULER_H, gridW, gridH);
    ctx.clip();

    // Laned background mirroring the keyboard.
    for (let p = pBottom; p <= pTop; p++) {
      const y = pitchToY(p);
      const pc = ((p % 12) + 12) % 12;
      ctx.fillStyle = isBlack(p) ? '#0d0f15' : '#13161d';
      ctx.fillRect(KEY_W, y, gridW, rowH);

      if (keyLabelMode === 'scale' && scale?.set.has(pc)) {
        ctx.fillStyle = pc === scale.root ? `rgba(${ACCENT},0.09)` : `rgba(${ACCENT},0.04)`;
        ctx.fillRect(KEY_W, y, gridW, rowH);
      }
      if (hoverPitchRef.current === p) {
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(KEY_W, y, gridW, rowH);
      }

      // Octave boundary under every C, faint separators elsewhere.
      ctx.strokeStyle = pc === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.025)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(KEY_W, Math.round(y + rowH) - 0.5);
      ctx.lineTo(w, Math.round(y + rowH) - 0.5);
      ctx.stroke();
    }

    // Line hierarchy: 16th (dotted) < beat (medium) < bar (strong).
    const barLen = beat * 4;
    const vline = (t: number) => {
      const x = Math.round(timeToX(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, h);
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    if (step > 0 && step * pps >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.setLineDash([1, 3]);
      for (let i = Math.floor(visStart / step); i * step <= visEnd; i++) vline(i * step);
      ctx.setLineDash([]);
    }
    if (beat * pps >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      for (let i = Math.floor(visStart / beat); i * beat <= visEnd; i++) {
        if (i % 4 !== 0) vline(i * beat);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    for (let i = Math.floor(visStart / barLen); i * barLen <= visEnd; i++) vline(i * barLen);

    // Past end of audio.
    const endX = timeToX(duration);
    if (duration > 0 && endX < w) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.max(KEY_W, endX), RULER_H, w - Math.max(KEY_W, endX), gridH);
    }

    // Notes.
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (const n of list) {
      if (n.pitch < pBottom || n.pitch > pTop) continue;
      const x = timeToX(n.startTime);
      const wpx = Math.max(3, n.duration * pps);
      if (x + wpx < KEY_W || x > w) continue;
      const y = pitchToY(n.pitch) + 1;
      const nh = rowH - 2;
      const selected = n.id === selectedId;
      const ghost = melodyIds !== null && !melodyIds.has(n.id);
      const isSounding = playing && ph >= n.startTime && ph < n.startTime + n.duration;

      ctx.beginPath();
      ctx.roundRect(x, y, wpx, nh, Math.min(3, nh / 2));

      if (n.muted) {
        ctx.fillStyle = 'rgba(120,128,145,0.22)';
        ctx.fill();
        ctx.setLineDash([3, 2]);
        ctx.strokeStyle = 'rgba(170,178,195,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const grad = ctx.createLinearGradient(0, y, 0, y + nh);
        grad.addColorStop(0, velHsl(n.velocity, 10));
        grad.addColorStop(1, velHsl(n.velocity));
        ctx.globalAlpha = ghost ? 0.3 : 0.92;
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = ghost ? velHsl(n.velocity, 6) : 'rgba(0,0,0,0.45)';
        ctx.stroke();
        if (isSounding) {
          ctx.fillStyle = 'rgba(255,255,255,0.28)';
          ctx.fill();
        }
      }

      if (selected) {
        ctx.save();
        ctx.shadowColor = `rgba(${ACCENT},0.9)`;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      if (wpx > 30 && rowH >= 12) {
        ctx.fillStyle = n.muted || ghost ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.6)';
        ctx.fillText(midiToName(n.pitch), Math.max(x, KEY_W) + 4, y + nh / 2 + 0.5);
      }
    }
    ctx.restore();

    /* ===== keybed (Y axis) ===== */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_H, KEY_W, gridH);
    ctx.clip();
    ctx.fillStyle = '#d9dce4';
    ctx.fillRect(0, RULER_H, KEY_W, gridH);

    const glows: { y: number; glow: number }[] = [];
    for (let p = pBottom; p <= pTop; p++) {
      const y = pitchToY(p);
      const pc = ((p % 12) + 12) % 12;
      const { depress, glow } = keyState(p);
      if (glow > 0.01) glows.push({ y, glow });

      if (!isBlack(p)) {
        const inset = depress * 3;
        const body = ctx.createLinearGradient(0, 0, KEY_W, 0);
        body.addColorStop(0, '#f5f6f9');
        body.addColorStop(1, depress > 0 ? '#cfd4df' : '#e3e6ed');
        ctx.fillStyle = body;
        ctx.fillRect(0, y, KEY_W - inset, rowH);
        if (glow > 0) {
          ctx.fillStyle = `rgba(${ACCENT},${0.45 * glow})`;
          ctx.fillRect(0, y, KEY_W - inset, rowH);
        }
        if (inset > 0) {
          // Shadowed gap where the key tip has sunk.
          ctx.fillStyle = `rgba(20,24,32,${0.5 * depress})`;
          ctx.fillRect(KEY_W - inset, y, inset, rowH);
        }
        // Real seams only between adjacent white keys (B|C and E|F).
        if (pc === 0 || pc === 5) {
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.fillRect(0, Math.round(y + rowH) - 1, KEY_W, 1);
        }
      } else {
        // Neighbouring white keys continue behind the black key.
        ctx.fillStyle = '#e6e8ee';
        ctx.fillRect(BLACK_KEY_W, y, KEY_W - BLACK_KEY_W, rowH);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(BLACK_KEY_W, Math.round(y + rowH / 2), KEY_W - BLACK_KEY_W, 1);

        const bw = BLACK_KEY_W - depress * 3;
        const body = ctx.createLinearGradient(0, 0, bw, 0);
        body.addColorStop(0, depress > 0 ? '#14171e' : '#262a34');
        body.addColorStop(1, '#0b0d12');
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.roundRect(0, y + 0.5, bw, rowH - 1, [0, 3, 3, 0]);
        ctx.fill();
        if (glow > 0) {
          ctx.fillStyle = `rgba(${ACCENT},${0.55 * glow})`;
          ctx.fill();
        }
        if (depress < 0.5) {
          ctx.fillStyle = 'rgba(255,255,255,0.09)';
          ctx.fillRect(2, y + 2, bw - 7, 1.5);
        }
      }

      // Toggleable Western note-name guides.
      const inScale = !scale || scale.set.has(pc);
      const showLabel =
        keyLabelMode === 'all' ||
        (keyLabelMode === 'octaves' && pc === 0) ||
        (keyLabelMode === 'scale' && inScale);
      if (showLabel && rowH >= 11) {
        const text = pc === 0 ? midiToName(p) : pitchClassName(p);
        ctx.font = `${pc === 0 ? '600 ' : ''}9px ui-monospace, monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        if (isBlack(p)) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fillText(text, BLACK_KEY_W - 5 - depress * 3, y + rowH / 2 + 0.5);
        } else {
          ctx.fillStyle = pc === 0 ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.5)';
          ctx.fillText(text, KEY_W - 6 - depress * 3, y + rowH / 2 + 0.5);
        }
        ctx.textAlign = 'left';
        if (keyLabelMode === 'scale' && scale && pc === scale.root) {
          ctx.fillStyle = `rgb(${ACCENT})`;
          ctx.beginPath();
          ctx.arc(KEY_W - 4, y + rowH / 2, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Soft glow at the point of contact, bleeding into the lane.
    if (glows.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, RULER_H, w, gridH);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      for (const { y, glow } of glows) {
        const cy = y + rowH / 2;
        const r = rowH * 2.2;
        const rad = ctx.createRadialGradient(KEY_W, cy, 0, KEY_W, cy, r);
        rad.addColorStop(0, `rgba(${ACCENT},${0.55 * glow})`);
        rad.addColorStop(1, `rgba(${ACCENT},0)`);
        ctx.fillStyle = rad;
        ctx.fillRect(KEY_W - r, cy - r, r * 2, r * 2);

        const lane = ctx.createLinearGradient(KEY_W, 0, KEY_W + 160, 0);
        lane.addColorStop(0, `rgba(${ACCENT},${0.22 * glow})`);
        lane.addColorStop(1, `rgba(${ACCENT},0)`);
        ctx.fillStyle = lane;
        ctx.fillRect(KEY_W, y, 160, rowH);
      }
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(KEY_W, RULER_H, 1, gridH);

    /* ===== timeline ruler ===== */
    ctx.fillStyle = '#0f1218';
    ctx.fillRect(KEY_W, 0, gridW, RULER_H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(KEY_W, 0, gridW, RULER_H);
    ctx.clip();

    const barPx = barLen * pps;
    let labelEvery = 1;
    while (barPx * labelEvery < 28) labelEvery *= 2;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    if (step > 0 && step * pps >= 6) {
      for (let i = Math.floor(visStart / step); i * step <= visEnd; i++) {
        ctx.fillRect(Math.round(timeToX(i * step)), RULER_H - 3, 1, 3);
      }
    }
    if (beat * pps >= 6) {
      for (let i = Math.floor(visStart / beat); i * beat <= visEnd; i++) {
        if (i % 4 === 0) continue;
        const x = Math.round(timeToX(i * beat));
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x, RULER_H - 7, 1, 7);
        if (beat * pps >= 44) {
          ctx.font = '8px ui-monospace, monospace';
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillText(`${Math.floor(i / 4) + 1}.${(i % 4) + 1}`, x + 3, RULER_H - 9);
        }
      }
    }
    ctx.font = '600 10px ui-monospace, monospace';
    for (let i = Math.floor(visStart / barLen); i * barLen <= visEnd; i++) {
      const x = Math.round(timeToX(i * barLen));
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x, 0, 1, RULER_H);
      if (i % labelEvery === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(String(i + 1), x + 4, 8);
      }
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(KEY_W, RULER_H - 1, gridW, 1);

    // Corner above the keybed.
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, KEY_W, RULER_H);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, RULER_H - 1, KEY_W, 1);
    ctx.fillRect(KEY_W, 0, 1, RULER_H);
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText(`♩=${Math.round(settings.tempoBpm)}`, KEY_W / 2, RULER_H / 2);
    ctx.textAlign = 'left';

    /* ===== playhead ===== */
    const px = timeToX(ph);
    if (px >= KEY_W && px <= w) {
      const lx = Math.round(px) + 0.5;
      ctx.strokeStyle = PLAYHEAD;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx, RULER_H);
      ctx.lineTo(lx, h);
      ctx.stroke();

      ctx.fillStyle = PLAYHEAD;
      ctx.beginPath();
      ctx.moveTo(lx - 6, 3);
      ctx.lineTo(lx + 6, 3);
      ctx.lineTo(lx + 6, RULER_H - 9);
      ctx.lineTo(lx, RULER_H - 1);
      ctx.lineTo(lx - 6, RULER_H - 9);
      ctx.closePath();
      ctx.fill();
    }
  }, [
    size,
    gridW,
    gridH,
    notes,
    draft,
    selectedId,
    settings.tempoBpm,
    pps,
    rowH,
    scrollX,
    duration,
    playing,
    playheadRef,
    timeToX,
    pitchToY,
    yToPitch,
    step,
    beat,
    keyLabelMode,
    scale,
    melodyIds,
  ]);

  drawRef.current = draw;

  useEffect(() => {
    draw();
  }, [draw]);

  /* redraw every frame while playing (playhead + sounding keys) */
  useEffect(() => {
    if (!playing) {
      drawRef.current();
      return;
    }
    const loop = () => {
      drawRef.current();
      playRafRef.current = requestAnimationFrame(loop);
    };
    playRafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(playRafRef.current);
  }, [playing]);

  useImperativeHandle(ref, () => ({
    redraw: () => drawRef.current(),
    centerOnPitch: (pitch: number) => centerOnPitch(pitch),
  }));

  /* ---------------- hit testing ---------------- */
  const hitTest = useCallback(
    (list: TranscribedNote[], x: number, y: number) => {
      if (x < KEY_W || y < RULER_H) return null;
      const p = yToPitch(y);
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        if (n.pitch !== p) continue;
        const left = timeToX(n.startTime);
        const right = left + Math.max(3, n.duration * pps);
        if (x < left || x > right) continue;
        let mode: DragMode = 'move';
        if (right - left > EDGE * 3) {
          if (x - left <= EDGE) mode = 'resize-l';
          else if (right - x <= EDGE) mode = 'resize-r';
        }
        return { note: n, mode };
      }
      return null;
    },
    [yToPitch, timeToX, pps],
  );

  /* ---------------- pointer handling ---------------- */
  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const minLen = step > 0 ? step : 0.03;
  const defaultLen = () => (lastLenRef.current > 0 ? lastLenRef.current : step > 0 ? step : beat / 4);

  const seekTo = (x: number) => {
    onSeek?.(clamp(xToTime(x), 0, totalDuration));
    requestAnimationFrame(() => drawRef.current());
  };

  const beginNoteDrag = (
    hit: { note: TranscribedNote; mode: DragMode },
    x: number,
    y: number,
    base: TranscribedNote[],
    created = false,
  ) => {
    onSelect(hit.note.id);
    flashKey(hit.note.pitch, true, hit.note.velocity);
    gestureRef.current = {
      kind: 'note',
      mode: hit.mode,
      id: hit.note.id,
      startX: x,
      startY: y,
      orig: hit.note,
      base,
      working: hit.note,
      created,
    };
    if (created) setDraft(base);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (y < RULER_H) {
      if (x >= KEY_W) {
        gestureRef.current = { kind: 'scrub' };
        seekTo(x);
      }
      return;
    }
    if (x < KEY_W) {
      const p = clamp(yToPitch(y), MIN_PITCH, MAX_PITCH);
      pressKey(p);
      gestureRef.current = { kind: 'keys', pitch: p };
      return;
    }

    const hit = hitTest(notes, x, y);
    const active: ToolMode = e.button === 2 ? 'erase' : tool;

    switch (active) {
      case 'erase': {
        const working = hit ? notes.filter((n) => n.id !== hit.note.id) : notes;
        gestureRef.current = { kind: 'erase', working };
        if (hit) {
          setDraft(working);
          if (hit.note.id === selectedId) onSelect(null);
        }
        return;
      }
      case 'mute': {
        if (!hit) return;
        const target = !hit.note.muted;
        const working = notes.map((n) => (n.id === hit.note.id ? { ...n, muted: target } : n));
        gestureRef.current = { kind: 'mute', target, working, changed: true };
        setDraft(working);
        flashKey(hit.note.pitch, false);
        return;
      }
      case 'slice': {
        if (!hit) {
          onSelect(null);
          return;
        }
        const n = hit.note;
        const end = n.startTime + n.duration;
        const t = xToTime(x);
        let cut = snapTime(t);
        if (cut <= n.startTime + 0.01 || cut >= end - 0.01) cut = t;
        if (cut <= n.startTime + 0.01 || cut >= end - 0.01) return;
        const ratio = (cut - n.startTime) / n.duration;
        const [bendA, bendB] = splitArray(n.pitchBend, ratio);
        const [centsA, centsB] = splitArray(n.pitchBendCents, ratio);
        const a: TranscribedNote = { ...n, duration: cut - n.startTime, pitchBend: bendA, pitchBendCents: centsA };
        const b: TranscribedNote = { ...n, id: uid(), startTime: cut, duration: end - cut, pitchBend: bendB, pitchBendCents: centsB };
        commit(notes.flatMap((m) => (m.id === n.id ? [a, b] : [m])));
        onSelect(b.id);
        flashKey(n.pitch, true, n.velocity);
        return;
      }
      case 'paint': {
        if (hit) {
          beginNoteDrag(hit, x, y, notes);
          return;
        }
        const len = defaultLen();
        const pitch = clamp(yToPitch(y), MIN_PITCH, MAX_PITCH);
        const cell = Math.floor(Math.max(0, xToTime(x)) / len);
        const note: TranscribedNote = { id: uid(), pitch, startTime: cell * len, duration: len, velocity: 0.8 };
        const working = [...notes, note];
        gestureRef.current = { kind: 'paint', len, lastCell: cell, working, added: 1 };
        setDraft(working);
        flashKey(pitch, true);
        return;
      }
      case 'draw': {
        if (hit) {
          beginNoteDrag(hit, x, y, notes);
          return;
        }
        const pitch = clamp(yToPitch(y), MIN_PITCH, MAX_PITCH);
        const note: TranscribedNote = {
          id: uid(),
          pitch,
          startTime: Math.max(0, snapTime(xToTime(x))),
          duration: defaultLen(),
          velocity: 0.8,
        };
        beginNoteDrag({ note, mode: 'resize-r' }, x, y, [...notes, note], true);
        return;
      }
      default: {
        if (hit) {
          beginNoteDrag(hit, x, y, notes);
          return;
        }
        onSelect(null);
        seekTo(x);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    const canvas = e.currentTarget;
    const g = gestureRef.current;

    if (!g) {
      const hover = y >= RULER_H ? clamp(yToPitch(y), MIN_PITCH, MAX_PITCH) : null;
      if (hover !== hoverPitchRef.current) {
        hoverPitchRef.current = hover;
        drawRef.current();
      }
      if (y < RULER_H) canvas.style.cursor = x >= KEY_W ? 'ew-resize' : 'default';
      else if (x < KEY_W) canvas.style.cursor = 'pointer';
      else {
        const hit = hitTest(notes, x, y);
        const resize = hit && hit.mode !== 'move' && (tool === 'select' || tool === 'draw' || tool === 'paint');
        canvas.style.cursor = resize
          ? 'ew-resize'
          : tool === 'draw' || tool === 'paint'
            ? hit ? 'grab' : 'crosshair'
            : tool === 'slice'
              ? hit ? 'col-resize' : 'default'
              : tool === 'erase' || tool === 'mute'
                ? hit ? 'pointer' : 'default'
                : hit ? 'grab' : 'default';
      }
      return;
    }

    switch (g.kind) {
      case 'scrub':
        seekTo(Math.max(KEY_W, x));
        return;
      case 'keys': {
        const p = clamp(yToPitch(y), MIN_PITCH, MAX_PITCH);
        if (p !== g.pitch) {
          releaseKey(g.pitch);
          pressKey(p);
          g.pitch = p;
        }
        return;
      }
      case 'erase': {
        const hit = hitTest(g.working, x, y);
        if (!hit) return;
        g.working = g.working.filter((n) => n.id !== hit.note.id);
        if (hit.note.id === selectedId) onSelect(null);
        setDraft(g.working);
        return;
      }
      case 'mute': {
        const hit = hitTest(g.working, x, y);
        if (!hit || Boolean(hit.note.muted) === g.target) return;
        g.working = g.working.map((n) => (n.id === hit.note.id ? { ...n, muted: g.target } : n));
        setDraft(g.working);
        flashKey(hit.note.pitch, false);
        return;
      }
      case 'paint': {
        const cell = Math.floor(Math.max(0, xToTime(x)) / g.len);
        if (cell === g.lastCell) return;
        g.lastCell = cell;
        const pitch = clamp(yToPitch(y), MIN_PITCH, MAX_PITCH);
        const start = cell * g.len;
        const end = start + g.len;
        const blocked = g.working.some(
          (n) => n.pitch === pitch && n.startTime < end - 1e-6 && n.startTime + n.duration > start + 1e-6,
        );
        if (blocked) return;
        g.working = [...g.working, { id: uid(), pitch, startTime: start, duration: g.len, velocity: 0.8 }];
        g.added++;
        setDraft(g.working);
        flashKey(pitch, false);
        return;
      }
      case 'note': {
        const dt = (x - g.startX) / pps;
        const dp = Math.round((g.startY - y) / rowH);
        const o = g.orig;
        const next: TranscribedNote = { ...o };

        if (g.mode === 'move') {
          next.startTime = Math.max(0, snapTime(o.startTime + dt));
          next.pitch = clamp(o.pitch + dp, MIN_PITCH, MAX_PITCH);
        } else if (g.mode === 'resize-r') {
          next.duration = Math.max(minLen, snapTime(o.startTime + o.duration + dt) - o.startTime);
        } else {
          const end = o.startTime + o.duration;
          const newStart = Math.max(0, snapTime(o.startTime + dt));
          if (end - newStart >= minLen) {
            next.startTime = newStart;
            next.duration = end - newStart;
          }
        }

        if (next.pitch !== g.working.pitch) flashKey(next.pitch, true, next.velocity);
        g.working = next;
        setDraft(g.base.map((n) => (n.id === g.id ? next : n)));
        canvas.style.cursor = g.mode === 'move' ? 'grabbing' : 'ew-resize';
      }
    }
  };

  const endGesture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!g) return;

    switch (g.kind) {
      case 'keys':
        releaseKey(g.pitch);
        return;
      case 'erase':
        if (g.working.length !== notes.length) commit(g.working);
        return;
      case 'mute':
        if (g.changed) commit(g.working);
        return;
      case 'paint':
        if (g.added > 0) commit(g.working.sort((a, b) => a.startTime - b.startTime));
        return;
      case 'note': {
        const w = g.working;
        const o = g.orig;
        const changed =
          g.created || w.startTime !== o.startTime || w.duration !== o.duration || w.pitch !== o.pitch;
        if (g.mode !== 'move' && changed) lastLenRef.current = w.duration;
        if (!changed) return;
        commit(
          g.base.map((n) => (n.id === g.id ? w : n)).sort((a, b) => a.startTime - b.startTime),
        );
      }
    }
  };

  const onPointerLeave = () => {
    if (hoverPitchRef.current !== null && !gestureRef.current) {
      hoverPitchRef.current = null;
      drawRef.current();
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return;
    const { x, y } = local(e);
    if (x < KEY_W || y < RULER_H) return;

    const hit = hitTest(notes, x, y);
    if (hit) {
      commit(notes.filter((n) => n.id !== hit.note.id));
      onSelect(null);
      return;
    }
    const pitch = clamp(yToPitch(y), MIN_PITCH, MAX_PITCH);
    const note: TranscribedNote = {
      id: uid(),
      pitch,
      startTime: Math.max(0, snapTime(xToTime(x))),
      duration: defaultLen(),
      velocity: 0.8,
    };
    commit([...notes, note].sort((a, b) => a.startTime - b.startTime));
    onSelect(note.id);
    flashKey(pitch, true);
  };

  /* wheel: native listener so preventDefault works (React's is passive) */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = canvas.getBoundingClientRect();
        zoomAround(e.deltaY < 0 ? 1.15 : 1 / 1.15, Math.max(KEY_W, e.clientX - rect.left));
        return;
      }
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      if (dx) setScrollX((s) => clamp(s + dx / pps, 0, totalDuration));
      if (dy) setScrollY((s) => clamp(s + dy, 0, maxScrollY(rowH)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAround, pps, totalDuration, maxScrollY, rowH]);

  /* ---------------- keyboard shortcuts ---------------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;

      if (TOOL_KEYS[e.key]) {
        setTool(TOOL_KEYS[e.key]);
        return;
      }
      if (e.key === '=' || e.key === '+') {
        zoomAround(1.25, KEY_W + gridW / 2);
        return;
      }
      if (e.key === '-') {
        zoomAround(1 / 1.25, KEY_W + gridW / 2);
        return;
      }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        shiftOctave(e.key === 'PageUp' ? 1 : -1);
        return;
      }

      const sel = selectedId ? notes.find((n) => n.id === selectedId) : undefined;
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        commit(notes.filter((n) => n.id !== sel.id));
        onSelect(null);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dp = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        const pitch = clamp(sel.pitch + dp, MIN_PITCH, MAX_PITCH);
        commit(notes.map((n) => (n.id === sel.id ? { ...n, pitch } : n)));
        flashKey(pitch, true, sel.velocity);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dt = (e.key === 'ArrowRight' ? 1 : -1) * (step > 0 ? step : 0.05);
        const startTime = Math.max(0, sel.startTime + dt);
        commit(notes.map((n) => (n.id === sel.id ? { ...n, startTime } : n)));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, zoomAround, gridW, shiftOctave, selectedId, notes, commit, onSelect, flashKey, step]);

  return (
    <div className="theme-dark overflow-hidden rounded-xl border border-white/5 bg-[#0b0d12]">
      <PianoRollToolbar
        activeTool={tool}
        onToolChange={setTool}
        keyLabelMode={keyLabelMode}
        onKeyLabelModeChange={setKeyLabelMode}
        contrastMode={contrastMode}
        onContrastModeChange={setContrastMode}
        rowHeight={rowH}
        onRowHeightChange={changeRowHeight}
        onZoomIn={() => zoomAround(1.25, KEY_W + gridW / 2)}
        onZoomOut={() => zoomAround(1 / 1.25, KEY_W + gridW / 2)}
        onFitContent={fitContent}
        onJumpToOctave={(oct) => centerOnPitch((oct + 1) * 12 + 6)}
        onShiftOctave={shiftOctave}
        onUndo={undo}
        onRedo={redo}
        canUndo={pastRef.current.length > 0}
        canRedo={futureRef.current.length > 0}
        noteCount={notes.length}
      />
      <PianoRollMinimap
        notes={visibleNotes}
        totalDuration={totalDuration}
        scrollX={scrollX}
        pps={pps}
        gridWidth={gridW}
        playheadTime={playheadRef.current}
        onScrollChange={setScrollX}
      />
      <div ref={wrapRef} className="relative h-[440px] w-full">
        <canvas
          ref={canvasRef}
          role="application"
          aria-label="Piano roll editor. Keys 1 to 6 switch tools, arrow keys move the selected note, Delete removes it, Page Up and Page Down shift octaves."
          style={{ width: size.w, height: size.h, touchAction: 'none' }}
          className="block select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onPointerLeave={onPointerLeave}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="pointer-events-none absolute bottom-2 right-3 hidden rounded-md bg-black/60 px-2 py-1 text-[10px] text-white/40 md:block">
          1–6 tools · right-drag to erase · ⌘+wheel zoom · shift+wheel scroll · PgUp/PgDn octave
        </div>
      </div>
    </div>
  );
});

export default PianoRoll;
