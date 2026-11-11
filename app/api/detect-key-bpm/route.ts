import { NextResponse } from 'next/server';
import type {
  DetectKeyBpmError,
  DetectKeyBpmErrorCode,
  DetectKeyBpmRequest,
  KeyBpmAnalysis,
  KeyBpmResult,
} from '@/types/key-bpm';
import { cacheGet, cacheSet } from '@/lib/cache/redis';
import { lookupSpotifyKeyBpm } from '@/lib/providers/spotifyMetadata';
import { cleanChannelName, sanitizeYoutubeTitle } from '@/lib/youtube/sanitizer';
import { extractVideoId } from '@/lib/youtube/videoId';
import { detectKeyFromAudio } from '@/lib/dsp/audioKey';
import { detectTempo } from '@/lib/dsp/tempo';
import {
  CLIP_SAMPLE_RATE,
  YoutubeAudioError,
  fetchYoutubeClip,
} from '@/lib/server/youtubeAudio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

const cacheKey = (videoId: string) => `yt:key_bpm:${videoId}`;

function fail(code: DetectKeyBpmErrorCode, error: string, status: number) {
  return NextResponse.json<DetectKeyBpmError>({ code, error }, { status });
}

interface VideoInfo {
  title: string;
  author: string;
}

/** null = video does not exist; empty strings = exists but oEmbed is withheld. */
async function fetchVideoInfo(videoId: string): Promise<VideoInfo | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { cache: 'no-store', signal: AbortSignal.timeout(4000) },
    );
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) return { title: '', author: '' }; // 401/403: embedding disabled
    const data = (await res.json()) as { title?: string; author_name?: string };
    return { title: data.title ?? '', author: data.author_name ?? '' };
  } catch {
    return { title: '', author: '' };
  }
}

/** Tier 3: pull a clip with yt-dlp/ffmpeg and analyze it in-process. */
async function analyzeAudio(
  videoId: string,
): Promise<KeyBpmAnalysis | DetectKeyBpmErrorCode> {
  try {
    const samples = await fetchYoutubeClip(videoId);
    const key = detectKeyFromAudio(samples, CLIP_SAMPLE_RATE);
    const tempo = detectTempo({ samples, sampleRate: CLIP_SAMPLE_RATE });
    if (!key || tempo.confidence <= 0) return 'dsp_failed';

    // Onset periodicity can't tell a beat from its subdivision; report the
    // octave people actually count.
    let bpm = tempo.bpmExact;
    while (bpm > 155) bpm /= 2;
    while (bpm < 60) bpm *= 2;

    return {
      bpm: Math.round(bpm),
      key: key.key,
      scale: key.scale,
      confidence: (key.confidence + tempo.confidence) / 2,
    };
  } catch (err) {
    console.error('[detect-key-bpm] audio analysis failed:', err);
    return err instanceof YoutubeAudioError ? err.code : 'dsp_failed';
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as DetectKeyBpmRequest | null;
  const videoId = typeof body?.url === 'string' ? extractVideoId(body.url) : null;
  if (!videoId) {
    return fail('invalid_url', 'Enter a valid YouTube video URL.', 400);
  }

  // Tier 1 — cache
  if (!body?.forceRefresh) {
    const cached = await cacheGet<KeyBpmResult>(cacheKey(videoId));
    if (cached) {
      return NextResponse.json<KeyBpmResult>({ ...cached, source: 'cache' });
    }
  }

  const info = await fetchVideoInfo(videoId);
  if (!info) {
    return fail('video_not_found', 'That YouTube video could not be found.', 404);
  }
  const channel = cleanChannelName(info.author);
  const sanitized = sanitizeYoutubeTitle(info.title);

  const finish = async (
    source: 'metadata' | 'dsp_fallback',
    analysis: KeyBpmAnalysis,
  ) => {
    const result: KeyBpmResult = {
      source,
      videoId,
      title: analysis.title || sanitized.track || info.title,
      artist: analysis.artist || sanitized.artist || channel,
      bpm: Math.round(analysis.bpm),
      key: analysis.key,
      scale: analysis.scale,
      confidence: Math.round(Math.min(1, Math.max(0, analysis.confidence ?? 0)) * 100) / 100,
      cachedAt: new Date().toISOString(),
    };
    await cacheSet(cacheKey(videoId), result, CACHE_TTL_SECONDS);
    return NextResponse.json<KeyBpmResult>(result);
  };

  // Tier 2 — metadata fast path
  const metadata = info.title ? await lookupSpotifyKeyBpm(sanitized, channel) : null;
  if (metadata) return finish('metadata', metadata);

  // Tier 3 — audio DSP
  const dsp = await analyzeAudio(videoId);
  if (dsp === 'dsp_unavailable') {
    return fail(
      'dsp_unavailable',
      'Audio analysis needs yt-dlp and ffmpeg installed on the server.',
      503,
    );
  }
  if (dsp === 'youtube_blocked') {
    return fail(
      'youtube_blocked',
      'YouTube refused this server\'s request for the audio. Try again in a few minutes.',
      503,
    );
  }
  if (typeof dsp === 'string') {
    return fail(
      'dsp_failed',
      'The audio for this video could not be analyzed (it may be private, age-restricted, live, or region-locked).',
      502,
    );
  }
  return finish('dsp_fallback', dsp);
}
