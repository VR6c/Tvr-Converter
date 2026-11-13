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

type WritableHandle = {
  createWritable: () => Promise<{
    write: (data: ArrayBuffer) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/**
 * Save the MIDI file, preferring the File System Access API.
 *
 * The picker needs a fresh user gesture, so it is opened before the bytes are
 * built: encoding first (which lazy-loads @tonejs/midi) can outlast the click's
 * activation window, and Chrome then refuses the picker.
 */
export async function saveMidiFile(
  buildBytes: () => Promise<Uint8Array>,
  filename = 'transcription.mid',
): Promise<SaveResult> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<WritableHandle>;
    }
  ).showSaveFilePicker;

  let handle: WritableHandle | null = null;
  if (typeof picker === 'function') {
    try {
      handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: 'MIDI File',
            accept: { 'audio/midi': ['.mid'] },
          },
        ],
      });
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        throw err; // user cancelled - do not fall through
      }
      console.warn('[export] save picker unavailable, downloading instead', err);
    }
  }

  const buffer = toArrayBuffer(await buildBytes());

  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(buffer);
    await writable.close();
    return { method: 'picker', filename };
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
