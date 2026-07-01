const ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extract an 11-character YouTube video id from common URL shapes (watch,
 * youtu.be, embed, shorts) or accept a bare id. Returns null if none is found.
 */
export function parseVideoId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (ID_RE.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtu.be') {
    return idOrNull(url.pathname.slice(1));
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v');
    if (v) return idOrNull(v);
    const match = url.pathname.match(/^\/(?:embed|shorts|v)\/([^/?#]+)/);
    if (match) return idOrNull(match[1]);
  }

  return null;
}

function idOrNull(candidate: string): string | null {
  return ID_RE.test(candidate) ? candidate : null;
}
