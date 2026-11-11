'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { WaveformHandle } from '@/components/WaveformView';
import type { TranscribedNote } from '@/types/audio-midi';
import {
  getAuditionTime,
  pauseAudition,
  preloadAudio,
  scheduleAudition,
  seekAudition,
  setSynthVolume,
  stopAudition,
  unlockAudio,
} from '@/lib/audio/synth';

interface Options {
  waveRef: RefObject<WaveformHandle | null>;
  audioUrl: string | null;
  notes: TranscribedNote[];
  octaveOffset: number;
  duration: number;
  canPlay: boolean;
}

/**
 * Transport engine: keeps the waveform player, the Tone.js synth and the
 * piano-roll playhead in sync, and owns volume / solo state and shortcuts.
 */
export function usePlayback({
  waveRef,
  audioUrl,
  notes,
  octaveOffset,
  duration: effectiveDuration,
  canPlay,
}: Options) {
  const playheadRef = useRef(0);
  const rafRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [soloSynth, setSoloSynth] = useState(true);
  const [soloAudio, setSoloAudio] = useState(true);

  /* Fetch the synth chunk while the browser is idle so the first Play is instant. */
  useEffect(() => {
    const id = window.setTimeout(preloadAudio, 1500);
    return () => window.clearTimeout(id);
  }, []);

  /* ---------------- volume routing ---------------- */
  useEffect(() => {
    setSynthVolume(soloSynth ? -18 + volume * 18 : -Infinity);
    waveRef.current?.setMuted(!soloAudio);
    waveRef.current?.setVolume(volume);
  }, [volume, soloSynth, soloAudio, audioUrl]);

  /* ---------------- playback loop ---------------- */
  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    waveRef.current?.pause();
    pauseAudition();
    setPlaying(false);
  }, []);

  const startPlayback = useCallback(async () => {
    if (!canPlay) return;
    await unlockAudio();

    // If at or near the end, restart from beginning
    const isAtEnd =
      effectiveDuration > 0 && playheadRef.current >= effectiveDuration - 0.05;
    const from = isAtEnd ? 0 : Math.max(0, playheadRef.current);

    playheadRef.current = from;
    setCurrentTime(from);

    if (audioUrl) {
      waveRef.current?.seekTo(from);
      waveRef.current?.setMuted(!soloAudio);
      waveRef.current?.setVolume(volume);
      void waveRef.current?.play();
    }

    if (notes.length > 0) {
      scheduleAudition(notes, {
        octaveOffset: octaveOffset,
        fromTime: from,
      });
    }

    setPlaying(true);

    const startTime = performance.now();
    const startFromTime = from;

    const loop = () => {
      let t = from;
      if (audioUrl) {
        t = waveRef.current?.getCurrentTime() ?? from;
      } else {
        const elapsed = (performance.now() - startTime) / 1000;
        t = startFromTime + elapsed;
      }

      playheadRef.current = t;
      setCurrentTime(t);

      // Resync Tone.Transport if audio is playing and drift occurs
      if (notes.length > 0 && audioUrl) {
        const synthTime = getAuditionTime();
        if (Math.abs(synthTime - t) > 0.06) {
          seekAudition(t);
        }
      }

      if (effectiveDuration > 0 && t >= effectiveDuration - 0.02) {
        stopPlayback();
        playheadRef.current = effectiveDuration;
        setCurrentTime(effectiveDuration);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [
    canPlay,
    effectiveDuration,
    audioUrl,
    soloAudio,
    volume,
    notes,
    octaveOffset,
    stopPlayback,
  ]);

  const togglePlay = useCallback(() => {
    if (playing) stopPlayback();
    else void startPlayback();
  }, [playing, startPlayback, stopPlayback]);

  const rewind = useCallback(() => {
    const wasPlaying = playing;
    stopPlayback();
    playheadRef.current = 0;
    setCurrentTime(0);
    waveRef.current?.seekTo(0);
    seekAudition(0);
    if (wasPlaying) {
      requestAnimationFrame(() => void startPlayback());
    }
  }, [playing, stopPlayback, startPlayback]);

  const handleSeek = useCallback(
    (targetTime: number) => {
      const t = Math.max(0, Math.min(effectiveDuration, targetTime));
      playheadRef.current = t;
      setCurrentTime(t);
      waveRef.current?.seekTo(t);
      seekAudition(t);
    },
    [effectiveDuration],
  );

  /* Spacebar and R keyboard shortcuts for Play, Pause, Replay */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (e.code === 'Space') {
        // Space already activates a focused button / combobox natively.
        if (el?.closest('button, [role="combobox"], [role="option"]')) return;
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        rewind();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, rewind]);

  /* Stop playback whenever the source audio changes. */
  useEffect(() => {
    stopPlayback();
    stopAudition();
    playheadRef.current = 0;
    setCurrentTime(0);
  }, [audioUrl, stopPlayback]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /* Re-schedule the synth when the note set or octave changes mid-playback. */
  useEffect(() => {
    if (!playing || !soloSynth) return;
    scheduleAudition(notes, {
      octaveOffset: octaveOffset,
      fromTime: playheadRef.current,
    });
  }, [notes, octaveOffset, soloSynth, playing]);

  /** Waveform time updates: follow the audio while idle so the synth stays cued. */
  const handleWaveTime = useCallback(
    (t: number) => {
      if (!audioUrl) return;
      playheadRef.current = t;
      setCurrentTime(t);
      if (!playing) seekAudition(t);
    },
    [audioUrl, playing],
  );

  const handleWaveFinish = useCallback(() => {
    stopPlayback();
    playheadRef.current = effectiveDuration;
    setCurrentTime(effectiveDuration);
  }, [stopPlayback, effectiveDuration]);

  const toggleSoloSynth = useCallback(() => setSoloSynth((s) => !s), []);
  const toggleSoloAudio = useCallback(() => setSoloAudio((s) => !s), []);

  return {
    playheadRef,
    playing,
    currentTime,
    volume,
    setVolume,
    soloSynth,
    soloAudio,
    toggleSoloSynth,
    toggleSoloAudio,
    togglePlay,
    rewind,
    seek: handleSeek,
    handleWaveTime,
    handleWaveFinish,
  };
}
