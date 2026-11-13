import type { ConverterSettings, TranscribedNote } from '@/types/audio-midi';
import { clamp } from '@/lib/utils';

/**
 * Serialize transcribed notes into a Standard MIDI File (Type 1).
 * Applies the audition octave offset so the exported file matches preview.
 */
export async function notesToMidiBytes(
  notes: TranscribedNote[],
  settings: ConverterSettings,
): Promise<Uint8Array> {
  // Loaded on demand: only needed when the user exports.
  const { Midi } = await import('@tonejs/midi');
  const midi = new Midi();
  midi.header.setTempo(settings.tempoBpm);
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: [4, 4] }];
  midi.header.update();

  const track = midi.addTrack();
  track.name = 'Transcription';
  track.channel = 0;

  const octave = clamp(Math.round(settings.octaveOffset), -2, 2) * 12;

  for (const n of notes) {
    if (n.muted) continue;
    // A non-finite time makes the encoder spin forever; skip corrupt notes.
    if (
      !Number.isFinite(n.pitch) ||
      !Number.isFinite(n.startTime) ||
      !Number.isFinite(n.duration)
    ) {
      continue;
    }
    const pitch = clamp(Math.round(n.pitch) + octave, 0, 127);
    track.addNote({
      midi: pitch,
      time: Math.max(0, n.startTime),
      duration: Math.max(0.02, n.duration),
      velocity: clamp(Number.isFinite(n.velocity) ? n.velocity : 0.8, 0.05, 1),
    });

    // Microtonal pitch bend (cents -> normalized +-2 semitone range)
    const cents = n.pitchBendCents?.[0] ?? n.pitchBend?.[0];
    if (cents && Number.isFinite(cents) && Math.abs(cents) > 1) {
      try {
        const ticks = Math.round(
          midi.header.secondsToTicks(Math.max(0, n.startTime)),
        );
        // @tonejs/midi accepts a normalized value in [-1, 1] (+-2 semitones).
        (track as unknown as {
          addPitchBend: (p: { ticks: number; value: number }) => void;
        }).addPitchBend({ ticks, value: clamp(cents / 200, -1, 1) });
      } catch {
        /* Pitch bend is best-effort - never block the export. */
      }
    }
  }

  return midi.toArray();
}

export interface SaveResult {
  method: 'picker' | 'download';
  filename: string;
}

/** Download the MIDI file, preferring the File System Access API. */
export async function saveMidiFile(
  bytes: Uint8Array,
  filename = 'transcription.mid',
): Promise<SaveResult> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<{
        createWritable: () => Promise<{
          write: (data: ArrayBuffer) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;

  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: 'MIDI File',
            accept: { 'audio/midi': ['.mid'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(buffer);
      await writable.close();
      return { method: 'picker', filename };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        throw err; // user cancelled - do not fall through
      }
      /* else fall back to the blob download */
    }
  }

  const blob = new Blob([buffer], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari asks "allow downloads?" first and only then reads the blob, so the
  // URL has to outlive that prompt - revoking after a few seconds fails the download.
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return { method: 'download', filename };
}

