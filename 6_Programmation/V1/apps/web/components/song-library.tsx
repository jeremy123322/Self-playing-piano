"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpDownIcon, LayoutGridIcon, ListIcon, SearchIcon } from "lucide-react";
import type { SongSummary } from "@spp/contracts";
import { usePianoSession } from "@/hooks/use-piano-session";
import { useLocale } from "@/hooks/use-locale";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SongRow } from "@/components/song-row";
import { SongCard } from "@/components/song-card";

interface SongLibraryProps {
  songs: SongSummary[];
  loading: boolean;
  query: string;
  onQueryChange: (value: string) => void;
}

type SortKey = "newest" | "title" | "duration";
type ViewMode = "rows" | "cards";

const SORT_LABEL_KEYS: Record<SortKey, "library.sort.newest" | "library.sort.title" | "library.sort.duration"> = {
  newest: "library.sort.newest",
  title: "library.sort.title",
  duration: "library.sort.duration",
};

const VIEW_MODE_STORAGE_KEY = "spp:library-view-mode";
const isViewMode = (value: string | null): value is ViewMode => value === "rows" || value === "cards";

const sortSongs = (songs: SongSummary[], sortKey: SortKey) => {
  const sorted = [...songs];
  if (sortKey === "title") return sorted.sort((a, b) => a.title.localeCompare(b.title));
  if (sortKey === "duration") return sorted.sort((a, b) => b.durationMs - a.durationMs);
  return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

/** Remembers the visitor's preferred library layout across visits. */
const useViewModePreference = () => {
  const [viewMode, setViewMode] = useState<ViewMode>("rows");

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    // One-time read of a client-only preference; there's no server-rendered value to sync from.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isViewMode(stored)) setViewMode(stored);
  }, []);

  const updateViewMode = (next: ViewMode) => {
    setViewMode(next);
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
  };

  return [viewMode, updateViewMode] as const;
};

const ViewModeToggle = ({ viewMode, onChange }: { viewMode: ViewMode; onChange: (mode: ViewMode) => void }) => {
  const { t } = useLocale();

  return (
    <div className="flex shrink-0 items-center rounded-md border border-border p-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={viewMode === "rows" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={t("library.view.rows")}
            aria-pressed={viewMode === "rows"}
            onClick={() => onChange("rows")}
          >
            <ListIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("library.view.rows")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={viewMode === "cards" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={t("library.view.cards")}
            aria-pressed={viewMode === "cards"}
            onClick={() => onChange("cards")}
          >
            <LayoutGridIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("library.view.cards")}</TooltipContent>
      </Tooltip>
    </div>
  );
};

export const SongLibrary = ({ songs, loading, query, onQueryChange }: SongLibraryProps) => {
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [viewMode, setViewMode] = useViewModePreference();
  const { selectedSongId, setSelectedSongId, activeSongId } = usePianoSession();
  const { t, tCount } = useLocale();
  const sortedSongs = useMemo(() => sortSongs(songs, sortKey), [songs, sortKey]);

  return (
    <section className="min-w-0 w-full flex-1">
      <div className="flex w-full flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{t("library.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? t("library.loading") : tCount("library.count", songs.length)}
          </p>
        </div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:w-auto sm:shrink-0">
          <div className="relative col-span-2 w-full sm:col-span-1 sm:w-auto">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t("library.searchAria")}
              placeholder={t("library.searchPlaceholder")}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="w-full pl-8 sm:w-72"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-full min-w-0 justify-start sm:w-auto sm:min-w-28">
                <ArrowUpDownIcon className="size-4" />
                {t(SORT_LABEL_KEYS[sortKey])}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                {Object.entries(SORT_LABEL_KEYS).map(([key, labelKey]) => (
                  <DropdownMenuRadioItem key={key} value={key}>
                    {t(labelKey)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Fixed-width results frame so empty/loading/view-mode swaps never shrink the column. */}
      <div className="w-full min-w-0">
        {loading && (
          <div className={viewMode === "cards" ? "grid w-full grid-cols-2 gap-3 sm:grid-cols-3" : "flex w-full flex-col gap-1"}>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className={viewMode === "cards" ? "h-28 w-full rounded-xl" : "h-14 w-full rounded-lg"} />
            ))}
          </div>
        )}

        {!loading && sortedSongs.length > 0 && viewMode === "rows" && (
          <div className="flex w-full flex-col gap-1">
            {sortedSongs.map((song, index) => (
              <SongRow
                key={song.id}
                song={song}
                index={index}
                isSelected={song.id === selectedSongId}
                isNowPlaying={song.id === activeSongId}
                onSelect={() => setSelectedSongId(song.id)}
              />
            ))}
          </div>
        )}

        {!loading && sortedSongs.length > 0 && viewMode === "cards" && (
          <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
            {sortedSongs.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                isSelected={song.id === selectedSongId}
                isNowPlaying={song.id === activeSongId}
                onSelect={() => setSelectedSongId(song.id)}
              />
            ))}
          </div>
        )}

        {!loading && sortedSongs.length === 0 && (
          <p className="w-full py-10 text-center text-sm text-muted-foreground">{t("library.empty")}</p>
        )}
      </div>
    </section>
  );
};
