import { execFile } from 'node:child_process';
import { accessSync, constants, readdirSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export const CLIP_SAMPLE_RATE = 22050;
const CLIP_SECONDS = 45;
const PREFERRED_START = 30; // skip intros
const MIN_SECONDS = 5;
const YTDLP_TIMEOUT_MS = 40_000;
const FFMPEG_TIMEOUT_MS = 15_000;

export class YoutubeAudioError extends Error {
  constructor(
    public code: 'dsp_unavailable' | 'dsp_failed' | 'youtube_blocked',
    message: string,
  ) {
    super(message);
  }
}

/* ---------------- binary discovery ---------------- */
// The dev server's PATH is not always the login shell's, so also look in the
// usual install locations (Homebrew, pip --user, python.org framework builds).
function searchDirs(): string[] {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  dirs.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin');
  dirs.push(path.join(homedir(), '.local', 'bin'));
  const framework = '/Library/Frameworks/Python.framework/Versions';
  try {
    for (const v of readdirSync(framework)) dirs.push(path.join(framework, v, 'bin'));
  } catch {
    // not a python.org install
  }
  return dirs;
}

// Copies shipped with the deployment (see scripts/fetch-yt-dlp.mjs and
// outputFileTracingIncludes in next.config.mjs). Machine installs win so local
// dev keeps using an up-to-date yt-dlp.
const BUNDLED: Record<string, string> = {
  'yt-dlp': path.join(process.cwd(), 'bin', 'yt-dlp'),
  ffmpeg: path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
};

const resolved = new Map<string, string | null>();

function findBinary(name: string, override?: string): string | null {
  if (override) return override;
  if (resolved.has(name)) return resolved.get(name)!;
  let found: string | null = null;
  const candidates = searchDirs().map((dir) => path.join(dir, name));
  candidates.push(BUNDLED[name]);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      found = candidate;
      break;
    } catch {
      // keep looking
    }
  }
  resolved.set(name, found);
  return found;
}

function run(
  file: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: Buffer; stderr: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ stdout, stderr: stderr.toString().trim(), ok: !err });
      },
    );
  });
}

/* ---------------- clip fetch + decode ---------------- */
// What YouTube answers when it distrusts the server's IP (common on cloud hosts).
const BOT_CHECK = /not a bot|Sign in to confirm|HTTP Error 429|Too Many Requests/i;

async function fetchWindow(
  ytDlp: string,
  ffmpeg: string,
  videoId: string,
  start: number,
): Promise<Float32Array> {
  const dir = await mkdtemp(path.join(tmpdir(), 'yt-keybpm-'));
  try {
    // yt-dlp does the transfer itself: handing its stream URL to a bare
    // ffmpeg gets intermittent 403s from YouTube's CDN.
    const download = await run(
      ytDlp,
      [
        `https://www.youtube.com/watch?v=${videoId}`,
        '--format', 'bestaudio/best',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        '--no-progress',
        '--match-filter', '!is_live',
        '--download-sections', `*${start}-${start + CLIP_SECONDS}`,
        '--ffmpeg-location', ffmpeg,
        // YouTube's player challenges need a JS runtime; Node is always here.
        '--js-runtimes', `node:${process.execPath}`,
        // The default cache dir is under $HOME, which is read-only on Vercel.
        '--cache-dir', path.join(tmpdir(), 'yt-dlp-cache'),
        ...(process.env.YT_DLP_PROXY ? ['--proxy', process.env.YT_DLP_PROXY] : []),
        '--output', path.join(dir, 'clip.%(ext)s'),
      ],
      YTDLP_TIMEOUT_MS,
    );

    const file = (await readdir(dir)).find(
      (f) => f.startsWith('clip.') && !f.endsWith('.part'),
    );
    if (!file) {
      throw new YoutubeAudioError(
        BOT_CHECK.test(download.stderr) ? 'youtube_blocked' : 'dsp_failed',
        download.stderr.split('\n').pop() || 'yt-dlp produced no audio',
      );
    }

    const decoded = await run(
      ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-i', path.join(dir, file),
        '-t', String(CLIP_SECONDS),
        '-vn', '-f', 'f32le', '-acodec', 'pcm_f32le',
        '-ac', '1', '-ar', String(CLIP_SAMPLE_RATE), 'pipe:1',
      ],
      FFMPEG_TIMEOUT_MS,
    );
    if (!decoded.ok) {
      throw new YoutubeAudioError('dsp_failed', decoded.stderr || 'ffmpeg decode failed');
    }

    // Copy out of Node's pooled Buffer so the Float32Array is aligned.
    const bytes = decoded.stdout.byteLength - (decoded.stdout.byteLength % 4);
    const samples = new Float32Array(bytes / 4);
    new Uint8Array(samples.buffer).set(decoded.stdout.subarray(0, bytes));
    return samples;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Mono 22.05 kHz PCM for ~45s of the video, taken past the intro when possible. */
export async function fetchYoutubeClip(videoId: string): Promise<Float32Array> {
  const ytDlp = findBinary('yt-dlp', process.env.YT_DLP_PATH);
  const ffmpeg = findBinary('ffmpeg', process.env.FFMPEG_PATH);
  if (!ytDlp || !ffmpeg) {
    throw new YoutubeAudioError(
      'dsp_unavailable',
      `${!ytDlp ? 'yt-dlp' : 'ffmpeg'} is not installed on the server`,
    );
  }

  const minSamples = CLIP_SAMPLE_RATE * MIN_SECONDS;
  let samples: Float32Array | null = null;
  try {
    samples = await fetchWindow(ytDlp, ffmpeg, videoId, PREFERRED_START);
  } catch (err) {
    if (!(err instanceof YoutubeAudioError) || err.code === 'youtube_blocked') throw err;
  }
  // Videos shorter than the preferred window fail or come back near-empty:
  // take it from the top instead.
  if (!samples || samples.length < minSamples) {
    samples = await fetchWindow(ytDlp, ffmpeg, videoId, 0);
  }
  if (samples.length < minSamples) {
    throw new YoutubeAudioError('dsp_failed', 'too little audio decoded');
  }
  return samples;
}
