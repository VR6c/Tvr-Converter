'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { TranscribedNote } from '@/types/audio-midi';
import { clamp } from '@/lib/utils';

interface Props {
  notes: TranscribedNote[];
  totalDuration: number;
  scrollX: number;
  pps: number;
  gridWidth: number;
  playheadTime: number;
  onScrollChange: (newScrollX: number) => void;
}

const MIN_PITCH = 21;
const MAX_PITCH = 108;
const MINIMAP_H = 26;

export default function PianoRollMinimap({
  notes,
  totalDuration,
  scrollX,
  pps,
  gridWidth,
  playheadTime,
  onScrollChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(0);

  const safeDuration = Math.max(1, totalDuration);
  const visibleDuration = gridWidth / pps;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = MINIMAP_H;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#090b10';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid guide lines across overview
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let f = 0.25; f < 1; f += 0.25) {
      const gx = Math.round(w * f) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }

    // Render micro notes
    const pitchSpan = MAX_PITCH - MIN_PITCH;
    for (const n of notes) {
      const nx = (n.startTime / safeDuration) * w;
      const nw = Math.max(2, (n.duration / safeDuration) * w);
      const ny = ((MAX_PITCH - n.pitch) / pitchSpan) * (h - 6) + 3;

      if (n.muted) {
        ctx.fillStyle = 'rgba(150, 160, 180, 0.25)';
      } else {
        const t = clamp(n.velocity, 0, 1);
        const hue = 215 - t * 200; // Blue to coral
        ctx.fillStyle = `hsl(${hue} 85% 60%)`;
      }
      ctx.fillRect(nx, ny, nw, 2);
    }

    // Viewport box
    const vx = (scrollX / safeDuration) * w;
    const vw = Math.max(18, (visibleDuration / safeDuration) * w);

    // Outside shading (dim areas not currently in view)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    if (vx > 0) ctx.fillRect(0, 0, Math.max(0, vx), h);
    if (vx + vw < w) ctx.fillRect(vx + vw, 0, w - (vx + vw), h);

    // Viewport highlight
    ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.fillRect(vx, 0, vw, h);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.round(vx) + 0.5, 0.5, Math.round(vw) - 1, h - 1);

    // Viewport resize handles (left and right edges)
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(vx, 0, 2, h);
    ctx.fillRect(vx + vw - 2, 0, 2, h);

    // Playhead line on minimap
    if (playheadTime >= 0 && playheadTime <= safeDuration) {
      const px = (playheadTime / safeDuration) * w;
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(px) + 0.5, 0);
      ctx.lineTo(Math.round(px) + 0.5, h);
      ctx.stroke();
    }
  }, [notes, safeDuration, scrollX, visibleDuration, playheadTime]);

  useEffect(() => {
    draw();
  }, [draw]);

  const updateScrollFromPointer = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const w = rect.width;

    const targetCenterTime = (x / w) * safeDuration - dragOffsetRef.current;
    const maxScroll = Math.max(0, safeDuration - visibleDuration);
    const newScrollX = clamp(targetCenterTime, 0, maxScroll);
    onScrollChange(newScrollX);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;

    const vx = (scrollX / safeDuration) * w;
    const vw = Math.max(18, (visibleDuration / safeDuration) * w);

    if (x >= vx && x <= vx + vw) {
      // Clicked inside viewport: preserve offset from viewport center
      const currentCenterTime = scrollX + visibleDuration / 2;
      const clickedTime = (x / w) * safeDuration;
      dragOffsetRef.current = clickedTime - currentCenterTime;
    } else {
      // Clicked outside: jump viewport center to click position
      dragOffsetRef.current = 0;
      const targetTime = (x / w) * safeDuration - visibleDuration / 2;
      const maxScroll = Math.max(0, safeDuration - visibleDuration);
      onScrollChange(clamp(targetTime, 0, maxScroll));
    }

    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    updateScrollFromPointer(e.clientX);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="relative h-[26px] w-full border-b border-white/10 bg-[#090b10] select-none">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-ew-resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="pointer-events-none absolute left-2 top-1 text-[9px] font-mono tracking-wider text-white/30 uppercase">
        Overview
      </div>
    </div>
  );
}

