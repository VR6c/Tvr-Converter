import type { KeyBpmAnalysis } from '@/types/key-bpm';
import { variantKeyword, type SanitizedTitle } from '@/lib/youtube/sanitizer';

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MIN_MATCH_SCORE = 0.6;
const TIMEOUT_MS = 4000;

interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
}

interface SpotifyAudioFeatures {
  tempo: number;
  key: number;  // -1 when undetected
  mode: number; // 1 = major, 0 = minor
}

/* ---------------- token (client credentials, cached until expiry) ---------------- */
let token: { value: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string> | null = null;

async function getAccessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now()) return token.value;
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const id = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Spotify token exchange failed (${res.status})`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    // Refresh a minute early so in-flight requests never carry a stale token.
    token = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return token.value;
  })().finally(() => {
    tokenRequest = null;
  });

  return tokenRequest;
}

async function spotifyGet<T>(path: string): Promise<T | null> {
  const request = async () =>
    fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${await getAccessToken()}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let res = await request();
  if (res.status === 401) {
    token = null;
    res = await request();
  }
  if (res.status === 403) throw new SpotifyForbiddenError(path);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

class SpotifyForbiddenError extends Error {
  constructor(path: string) {
    super(`Spotify denied ${path} (403)`);
  }
}

/* ---------------- match scoring ---------------- */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // fold Latin accents only
      .toLowerCase()
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .filter(Boolean),
  );
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((t) => {
    if (b.has(t)) shared++;
  });
  return (2 * shared) / (a.size + b.size);
}

/** Fraction of `needle` tokens present in `haystack`. */
function containment(needle: Set<string>, haystack: Set<string>): number {
  if (!needle.size) return 0;
  let shared = 0;
  needle.forEach((t) => {
    if (haystack.has(t)) shared++;
  });
  return shared / needle.size;
}

function scoreMatch(
  candidate: SpotifyTrack,
  query: SanitizedTitle,
  channel: string,
): number {
  // Derivative uploads must match a Spotify release of the same kind.
  if (query.variant) {
    const wanted = variantKeyword(query.variant);
    if (wanted && variantKeyword(candidate.name) !== wanted) return 0;
  }

  // "Song - Remastered 2011" / "Song (feat. X)" -> "Song"
  const baseName = candidate.name.replace(/\(.*?\)|\[.*?\]/g, ' ').split(' - ')[0];
  const trackScore = dice(tokens(query.track), tokens(baseName));

  const context = tokens(`${query.artist} ${query.rawClean} ${channel}`);
  const artistScore = Math.max(
    0,
    ...candidate.artists.map((a) => containment(tokens(a.name), context)),
  );

  return 0.6 * trackScore + 0.4 * artistScore;
}

/* ---------------- public API ---------------- */
// Spotify closed /audio-features to apps registered after 2024-11-27; those
// apps get 403 on every call. Back off instead of paying the round trip.
let featuresBlockedUntil = 0;

export function isSpotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

/**
 * Tier 2 fast path. Returns null on any miss (no confident match, features
 * unavailable, network error) so the caller can fall through to DSP.
 */
export async function lookupSpotifyKeyBpm(
  query: SanitizedTitle,
  channel = '',
): Promise<KeyBpmAnalysis | null> {
  if (!isSpotifyConfigured() || !query.track) return null;
  if (Date.now() < featuresBlockedUntil) return null;

  try {
    const q = [query.artist || channel, query.track, query.variant ?? '']
      .filter(Boolean)
      .join(' ');
    const search = await spotifyGet<{ tracks: { items: SpotifyTrack[] } }>(
      `/search?type=track&limit=5&q=${encodeURIComponent(q)}`,
    );

    let best: SpotifyTrack | null = null;
    let bestScore = 0;
    for (const item of search?.tracks.items ?? []) {
      const score = scoreMatch(item, query, channel);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    if (!best || bestScore < MIN_MATCH_SCORE) return null;

    const features = await spotifyGet<SpotifyAudioFeatures>(
      `/audio-features/${best.id}`,
    );
    if (!features || features.key < 0 || !(features.tempo > 0)) return null;

    return {
      bpm: Math.round(features.tempo),
      key: PITCH_CLASSES[features.key],
      scale: features.mode === 1 ? 'major' : 'minor',
      confidence: Math.round(Math.min(1, bestScore) * 100) / 100,
      title: best.name,
      artist: best.artists.map((a) => a.name).join(', '),
    };
  } catch (err) {
    if (err instanceof SpotifyForbiddenError) {
      featuresBlockedUntil = Date.now() + 60 * 60 * 1000;
      console.warn(
        '[spotify] audio-features returned 403 — this app has no access to the endpoint. Skipping the metadata tier for 1h.',
      );
    } else {
      console.warn('[spotify] lookup failed:', err);
    }
    return null;
  }
}
