export interface SanitizedTitle {
  artist: string;
  track: string;
  rawClean: string;
  /**
   * Set when the upload is a derivative take (remix, live, sped up…). The
   * studio recording's key/BPM would be wrong for it, so metadata matches
   * must carry the same marker or be rejected.
   */
  variant: string | null;
}

/** Markers that are only trusted inside brackets ("Live Forever" is not a live take). */
const BRACKET_VARIANT =
  /\b(remix|live|acoustic|cover|sped\s*up|slowed|nightcore|mashup|bootleg|karaoke|8d|reverb|demo|unplugged)\b/i;
/** Markers that are unambiguous anywhere in the title. */
const TITLE_VARIANT = /\b(remix|sped\s*up|slowed|nightcore|mashup|bootleg|karaoke)\b/i;

const NOISE =
  /\b(official\s*(music\s*)?(video|audio|mv|lyrics?\s*video|visuali[sz]er)|lyrics?(\s*video)?|visuali[sz]er|audio|m\/v|mv|4k|hd|hq|explicit)\b/gi;

export function variantKeyword(text: string): string | null {
  const m = text.match(BRACKET_VARIANT);
  return m ? m[1].toLowerCase().replace(/\s+/g, ' ') : null;
}

export function sanitizeYoutubeTitle(rawTitle: string): SanitizedTitle {
  let variant: string | null = null;
  for (const m of rawTitle.matchAll(/\[(.*?)\]|\((.*?)\)/g)) {
    const inner = m[1] ?? m[2] ?? '';
    if (BRACKET_VARIANT.test(inner)) {
      variant = inner.trim();
      break;
    }
  }
  if (!variant) variant = rawTitle.match(TITLE_VARIANT)?.[1] ?? null;

  const clean = rawTitle
    .replace(/\[.*?\]|\(.*?\)|【.*?】/g, ' ') // remove brackets & parentheses
    .replace(/\bprod(uced)?\.?\s*by\b.*/i, ' ')
    .split(/\s[|｜]\s/)[0] // "Artist - Track | Channel clutter"
    .replace(NOISE, ' ')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '');

  // Standard "Artist - Track" convention. Requires spaced dashes so
  // hyphenated names (Jay-Z, Ne-Yo) stay intact.
  const parts = clean.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      track: stripFeaturing(parts.slice(1).join(' - ')),
      rawClean: clean,
      variant,
    };
  }

  return { artist: '', track: stripFeaturing(clean), rawClean: clean, variant };
}

function stripFeaturing(track: string): string {
  return track.replace(/\s+\b(feat\.?|ft\.?|featuring)\s.*$/i, '').trim();
}

/** "ArtistVEVO" / "Artist - Topic" / "Artist Official" -> "Artist" */
export function cleanChannelName(author: string): string {
  return author
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\b(official|music|channel|tv)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
