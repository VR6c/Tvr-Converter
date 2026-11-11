export type KeyBpmSource = 'cache' | 'metadata' | 'dsp_fallback';

export interface KeyBpmResult {
  source: KeyBpmSource;
  videoId: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;         // e.g., "D#", "C", "A"
  scale: 'major' | 'minor';
  confidence: number;  // 0.0 - 1.0
  cachedAt?: string;
}

export interface DetectKeyBpmRequest {
  url: string;
  forceRefresh?: boolean;
}

export type DetectKeyBpmErrorCode =
  | 'invalid_url'
  | 'video_not_found'
  | 'dsp_unavailable'
  | 'youtube_blocked'
  | 'dsp_failed';

export interface DetectKeyBpmError {
  error: string;
  code: DetectKeyBpmErrorCode;
}

/** What a detection tier produces before the route stamps videoId / source. */
export interface KeyBpmAnalysis {
  bpm: number;
  key: string;
  scale: 'major' | 'minor';
  confidence: number;
  title?: string;
  artist?: string;
}
