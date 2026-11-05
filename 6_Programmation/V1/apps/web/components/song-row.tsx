"use client";

import { AudioLinesIcon } from "lucide-react";
import type { SongSummary } from "@spp/contracts";
import { formatDuration } from "@/lib/format";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

interface SongRowProps {
  song: SongSummary;
  index: number;
  isSelected: boolean;
  isNowPlaying: boolean;
  onSelect: () => void;
}

export const SongRow = ({ song, index, isSelected, isNowPlaying, onSelect }: SongRowProps) => {
  const { t } = useLocale();

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full cursor-pointer grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors sm:grid-cols-[2rem_1fr_auto_auto]",
        "hover:bg-muted/60",
        isSelected && "border-border bg-muted",
        isNowPlaying && "now-playing-highlight border-primary bg-primary/10 ring-1 ring-primary/40",
      )}
    >
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {isNowPlaying ? <AudioLinesIcon className="size-4 text-primary motion-safe:animate-pulse" /> : String(index + 1).padStart(2, "0")}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{song.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{song.artist ?? t("library.unknownArtist")}</span>
      </span>
      <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground tabular-nums">
        <span>{t("library.notes", { count: song.noteCount })}</span>
        <span>{formatDuration(song.durationMs)}</span>
      </span>
    </button>
  );
};
