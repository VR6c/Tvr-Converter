import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function formatTime(seconds: number): string {
  const sTotal = Math.max(0, Math.floor(seconds));
  const m = Math.floor(sTotal / 60);
  const s = sTotal % 60;
  const cs = Math.floor((seconds - sTotal) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToName(midi: number): string {
  const m = clamp(Math.round(midi), 0, 127);
  const pc = m % 12;
  const oct = Math.floor(m / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

export function uid(): string {
  return 'n_' + Math.random().toString(36).slice(2, 10);
}

