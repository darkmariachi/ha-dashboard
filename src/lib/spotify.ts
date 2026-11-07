import { loadCredentials } from "../ha/connection";

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: string;
  albumArt: string | null;
  durationMs: number;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Client Credentials flow — app-level auth for catalog search only (no user
 * login/consent, no personal data access). The client secret never reaches
 * the browser: /api/spotify-token is proxied to Spotify's token endpoint by
 * the container's nginx (vite's dev server in development), which adds the
 * Basic auth header itself. Token is cached in memory and refetched a little
 * before it actually expires.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  // The proxy only answers callers holding a valid HA token.
  const haToken = loadCredentials()?.token;
  if (!haToken) throw new Error("Sign in to Home Assistant to search Spotify.");
  const res = await fetch("/api/spotify-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${haToken}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    // 503 = the proxy has no credentials; 400/401 = Spotify rejected them.
    throw new Error(
      [400, 401, 503].includes(res.status)
        ? "Spotify search isn't set up on the server. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env (see .env.example)."
        : `Spotify auth failed (${res.status}).`,
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

export async function searchTracks(query: string): Promise<SpotifyTrack[]> {
  if (!query.trim()) return [];
  const token = await getAccessToken();

  // Spotify rejects some limit values (e.g. 12) with "Invalid limit" for
  // apps on the default/unextended API tier — 10 is confirmed to work.
  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Spotify search failed (${res.status}).`);

  const data = (await res.json()) as {
    tracks: {
      items: {
        id: string;
        uri: string;
        name: string;
        duration_ms: number;
        artists: { name: string }[];
        album: { images: { url: string }[] };
      }[];
    };
  };

  return data.tracks.items.map((t) => ({
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(", "),
    albumArt: t.album.images.at(-1)?.url ?? null,
    durationMs: t.duration_ms,
  }));
}
