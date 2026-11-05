"use client";

import { useState } from "react";
import { CircleXIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  reprocessAllSongs,
  type ReprocessFailure,
  type ReprocessTarget,
} from "@/lib/reprocess-all";

interface ReprocessAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinished: () => Promise<void> | void;
}

const readError = async (response: Response) => {
  const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
  return payload?.error ?? `HTTP ${response.status}`;
};

export const ReprocessAllDialog = ({ open, onOpenChange, onFinished }: ReprocessAllDialogProps) => {
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentTitle, setCurrentTitle] = useState<string>();
  const [failures, setFailures] = useState<ReprocessFailure[]>([]);
  const { t } = useLocale();

  const reset = () => {
    setRunning(false);
    setFinished(false);
    setProcessed(0);
    setTotal(0);
    setCurrentTitle(undefined);
    setFailures([]);
  };

  const close = () => {
    if (running) return;
    reset();
    onOpenChange(false);
  };

  const run = async () => {
    setRunning(true);
    try {
      const listResponse = await fetch("/api/admin/songs");
      if (!listResponse.ok) throw new Error(await readError(listResponse));
      const { songs } = await listResponse.json() as { songs: ReprocessTarget[] };
      setTotal(songs.length);

      const result = await reprocessAllSongs(songs, {
        reprocess: async (song) => {
          setCurrentTitle(song.title);
          const response = await fetch(`/api/admin/songs/${song.id}`, { method: "POST" });
          if (!response.ok) throw new Error(await readError(response));
        },
        onProgress: (progress) => {
          setCurrentTitle(progress.currentTitle);
          setProcessed(progress.processed);
          setFailures(progress.failures);
        },
      });

      setFinished(true);
      setCurrentTitle(undefined);
      await onFinished();
      if (result.failures.length === 0) toast.success(t("reprocessAll.success", { count: result.succeeded }));
      else toast.error(t("reprocessAll.partial", { failed: result.failures.length, total: songs.length }));
    } catch (error) {
      setFailures([{
        title: t("reprocessAll.library"),
        message: error instanceof Error ? error.message : t("toast.reprocessFailed"),
      }]);
      setFinished(true);
    } finally {
      setRunning(false);
    }
  };

  const progress = total > 0 ? processed / total : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle>{t("reprocessAll.title")}</DialogTitle>
          <DialogDescription>{t("reprocessAll.description")}</DialogDescription>
        </DialogHeader>

        {(running || finished) && (
          <div className="grid gap-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">{currentTitle ?? t("reprocessAll.complete")}</span>
              <span className="shrink-0 font-mono tabular-nums">{processed} / {total}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full origin-left bg-primary transition-transform" style={{ transform: `scaleX(${progress})` }} />
            </div>
          </div>
        )}

        {failures.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-destructive/5 p-2 text-xs text-destructive">
            {failures.map((failure) => (
              <li key={`${failure.title}-${failure.message}`} className="flex gap-2">
                <CircleXIcon className="mt-0.5 size-3.5 shrink-0" />
                <span><strong>{failure.title}:</strong> {failure.message}</span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          {!running && !finished && (
            <>
              <Button variant="outline" onClick={close}>{t("reprocessAll.cancel")}</Button>
              <Button onClick={() => void run()}>
                <RefreshCwIcon className="size-4" />
                {t("reprocessAll.confirm")}
              </Button>
            </>
          )}
          {running && (
            <Button disabled>
              <Loader2Icon className="size-4 animate-spin" />
              {t("reprocessAll.running")}
            </Button>
          )}
          {finished && <Button onClick={close}>{t("reprocessAll.done")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
