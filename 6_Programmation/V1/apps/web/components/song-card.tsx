"use client";

import { AudioLinesIcon, MusicIcon } from "lucide-react";
import type { SongSummary } from "@spp/contracts";
import { formatDuration } from "@/lib/format";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

interface SongCardProps {
  song: SongSummary;
  isSelected: boolean;
  isNowPlaying: boolean;
  onSelect: () => void;
}

export const SongCard = ({ song, isSelected, isNowPlaying, onSelect }: SongCardProps) => {
  const { t } = useLocale();

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-0 cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors",
        "hover:bg-muted/60",
        isSelected && "border-primary/60 bg-muted ring-1 ring-primary/30",
        isNowPlaying && "now-playing-highlight border-primary bg-primary/10 ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
            isNowPlaying && "bg-primary/20 text-primary",
          )}
        >
          {isNowPlaying ? <AudioLinesIcon className="size-4.5 motion-safe:animate-pulse" /> : <MusicIcon className="size-4.5" />}
        </span>
        {isNowPlaying && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <span className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
            {t("library.nowPlaying")}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{song.title}</p>
        <p className="truncate text-xs text-muted-foreground">{song.artist ?? t("library.unknownArtist")}</p>
      </div>
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground tabular-nums">
        <span>{t("library.notes", { count: song.noteCount })}</span>
        <span aria-hidden>·</span>
        <span>{formatDuration(song.durationMs)}</span>
      </div>
    </button>
  );
};
