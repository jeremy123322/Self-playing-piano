"use client";

import { EyeIcon, PencilIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import type { SongSummary } from "@spp/contracts";
import { formatDuration } from "@/lib/format";
import { useLocale } from "@/hooks/use-locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SongTableProps {
  songs: SongSummary[];
  loading: boolean;
  reprocessingId: string | undefined;
  onPreview: (song: SongSummary) => void;
  onEdit: (song: SongSummary) => void;
  onReprocess: (song: SongSummary) => void;
  onRequestArchive: (song: SongSummary) => void;
}

const STATUS_VARIANT: Record<SongSummary["status"], "default" | "secondary" | "destructive"> = {
  ready: "secondary",
  processing: "default",
  invalid: "destructive",
};

const formatDate = (isoDate: string) => new Date(isoDate).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

interface RowActionButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

const RowActionButton = ({ label, icon, onClick, disabled }: RowActionButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
        {icon}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

export const SongTable = ({ songs, loading, reprocessingId, onPreview, onEdit, onReprocess, onRequestArchive }: SongTableProps) => {
  const { t } = useLocale();

  if (loading) {
    return (
      <div className="flex w-full flex-col gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (songs.length === 0) {
    return <p className="w-full py-10 text-center text-sm text-muted-foreground">{t("admin.noSongs")}</p>;
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      {songs.map((song) => (
        <div key={song.id} className="flex w-full items-center gap-4 rounded-lg border border-transparent px-3 py-3 hover:bg-muted/60">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{song.title}</span>
              <Badge variant={STATUS_VARIANT[song.status]}>{song.status}</Badge>
              {song.warnings.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <TriangleAlertIcon className="size-3.5" />
                      {song.warnings.length}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <ul className="list-disc pl-3">
                      {song.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {song.artist ?? t("library.unknownArtist")} · {t("library.notes", { count: song.noteCount })} ·{" "}
              {formatDuration(song.durationMs)} · {t("admin.uploadedOn", { date: formatDate(song.createdAt) })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <RowActionButton label={t("admin.action.preview")} icon={<EyeIcon className="size-4" />} onClick={() => onPreview(song)} />
            <RowActionButton label={t("admin.action.edit")} icon={<PencilIcon className="size-4" />} onClick={() => onEdit(song)} />
            <RowActionButton
              label={t("admin.action.reprocess")}
              icon={<RefreshCwIcon className={reprocessingId === song.id ? "size-4 animate-spin" : "size-4"} />}
              onClick={() => onReprocess(song)}
              disabled={reprocessingId === song.id}
            />
            <RowActionButton
              label={t("admin.action.archive")}
              icon={<Trash2Icon className="size-4 text-destructive" />}
              onClick={() => onRequestArchive(song)}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
