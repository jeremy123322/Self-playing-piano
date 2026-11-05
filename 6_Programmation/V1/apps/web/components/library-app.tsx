"use client";

import { useCallback, useEffect, useState } from "react";
import type { SongSummary } from "@spp/contracts";
import type { ViewerRole } from "@/lib/authorization";
import { usePianoSession } from "@/hooks/use-piano-session";
import { useLocale } from "@/hooks/use-locale";
import { visibleSelection } from "@/lib/song-selection";
import { SongLibrary } from "@/components/song-library";
import { PianoDock } from "@/components/piano-dock";

interface LibraryAppProps {
  viewerRole: ViewerRole;
}

const SEARCH_DEBOUNCE_MS = 250;

export const LibraryApp = ({ viewerRole }: LibraryAppProps) => {
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [query, setQuery] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string>();
  const { setSelectedSongId } = usePianoSession();
  const { t } = useLocale();

  const loadSongs = useCallback(
    async (searchTerm: string) => {
      const response = await fetch(`/api/songs?q=${encodeURIComponent(searchTerm)}`);
      if (!response.ok) throw new Error(t("library.error.unavailable"));
      const payload = (await response.json()) as { songs: SongSummary[] };
      setSongs(payload.songs);
    },
    [t],
  );

  // Keep the previous result list visible while searching so the library width/height
  // don't thrash between skeletons and content. Skeletons only show on the first load.
  useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        loadSongs(query)
          .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t("library.error.loadFailed")))
          .finally(() => setInitialLoading(false));
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [loadSongs, query, t]);

  useEffect(() => {
    setSelectedSongId((current) => visibleSelection(songs, current));
  }, [songs, setSelectedSongId]);

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      {error && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-start">
        <SongLibrary songs={songs} loading={initialLoading} query={query} onQueryChange={setQuery} />
        <PianoDock songs={songs} viewerRole={viewerRole} />
      </div>
    </main>
  );
};
