import { useEffect, useRef, useState } from "react";
import { Loader2, Music, Pause, Play, Search, Volume2, X } from "lucide-react";
import { CURATED_LIVING_ROOM_TV, CURATED_SPOTIFY_TARGET } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { searchTracks, type SpotifyTrack } from "../../lib/spotify";
import { useSpotifyNowPlaying } from "./useSpotifyNowPlaying";

const DEBOUNCE_MS = 400;
// How long to give the TV to finish waking up before asking it to play —
// only applied when it was actually off; skipped if it's already on.
const TV_WAKE_MS = 3000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SpotifySearchModal({ onClose }: { onClose: () => void }) {
  const { entities, callService } = useHa();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const player = useSpotifyNowPlaying();
  const track = player?.item;
  const playing = player?.is_playing === true;
  const volume = player?.device?.volume_percent;
  const albumArt = track?.album.images.at(-1)?.url ?? null;

  // Best-effort: Spotcast itself has no pause/volume actions (it's scoped to
  // "start/transfer playback" only), so this falls back to the standard
  // media_player services on its entity in case they happen to be wired up.
  function controlCall(service: string, data: Record<string, unknown> = {}) {
    callService("media_player", service, data, { entity_id: CURATED_SPOTIFY_TARGET }).catch(
      () => {},
    );
  }

  const isEmpty = !query.trim();

  useEffect(() => {
    if (isEmpty) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchTracks(query)
        .then(setResults)
        .catch((err) => setError(err instanceof Error ? err.message : "Search failed."))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isEmpty]);

  async function play(track: SpotifyTrack) {
    setPlayingId(track.id);
    setPlayError(null);
    try {
      const tvWasOff = entities[CURATED_LIVING_ROOM_TV]?.state === "off";
      // The Spotcast entity can't power the TV on itself, so wake it via its
      // own (androidtv_remote) entity first if needed, and give it a moment
      // to actually come up before asking it to start playing.
      await callService("media_player", "turn_on", {}, { entity_id: CURATED_LIVING_ROOM_TV });
      if (tvWasOff) await wait(TV_WAKE_MS);

      // Spotcast (Mincka fork, v6) doesn't use HA's standard target
      // mechanism — the device goes inside `data.media_player.entity_id`.
      await callService("spotcast", "play_media", {
        media_player: { entity_id: CURATED_SPOTIFY_TARGET },
        spotify_uri: track.uri,
      });
    } catch {
      setPlayError("Couldn't start playback — is Spotcast installed and configured?");
    } finally {
      setPlayingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" data-tv-scope>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      <div
        className="relative flex h-[85vh] w-full max-w-lg flex-col gap-4 rounded-t-[26px] border border-border bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:h-[80vh] sm:rounded-[26px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-text">Play on Living Room TV</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-dim hover:bg-chip hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        {track && (
          <div className="flex flex-col gap-3 rounded-2xl bg-chip p-3">
            <div className="flex items-center gap-3">
              {albumArt ? (
                <img src={albumArt} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface text-[#1DB954]">
                  <Music size={18} strokeWidth={1.75} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text">{track.name}</div>
                <div className="truncate text-xs text-text-dim">
                  {track.artists.map((a) => a.name).join(", ")}
                </div>
              </div>
              <button
                onClick={() => controlCall(playing ? "media_pause" : "media_play")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-text shadow-sm hover:bg-surface-hover active:scale-95"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
            </div>
            {typeof volume === "number" && (
              <div className="flex items-center gap-2.5 px-1">
                <Volume2 size={15} className="shrink-0 text-text-dim" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) =>
                    controlCall("volume_set", { volume_level: Number(e.target.value) / 100 })
                  }
                  className="w-full min-w-0 flex-1"
                  aria-label="Volume"
                />
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text-dim">{volume}</span>
              </div>
            )}
          </div>
        )}

        {
          <>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
              />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search songs, artists..."
                className="w-full rounded-xl border border-border bg-bg py-2.5 pl-9 pr-3 text-sm text-text outline-none focus:border-accent"
              />
            </div>

            {playError && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {playError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {isEmpty ? (
                <div className="flex h-full items-center justify-center text-sm text-text-dim">
                  Search for something to play.
                </div>
              ) : loading ? (
                <div className="flex h-full items-center justify-center text-text-dim">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : error ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-danger">
                  {error}
                </div>
              ) : results.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-text-dim">
                  No results.
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {results.map((track) => (
                    <button
                      key={track.id}
                      onClick={() => play(track)}
                      disabled={playingId === track.id}
                      className="flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-chip disabled:opacity-60"
                    >
                      {track.albumArt ? (
                        <img
                          src={track.albumArt}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded-md bg-chip" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text">{track.name}</div>
                        <div className="truncate text-xs text-text-dim">{track.artists}</div>
                      </div>
                      {playingId === track.id ? (
                        <Loader2 size={16} className="shrink-0 animate-spin text-text-dim" />
                      ) : (
                        <Play size={16} className="shrink-0 text-text-dim" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        }
      </div>
    </div>
  );
}
