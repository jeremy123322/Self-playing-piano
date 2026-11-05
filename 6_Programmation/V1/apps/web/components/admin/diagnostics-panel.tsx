"use client";

import { RefreshCwIcon } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { useDiagnosticsData } from "@/hooks/use-diagnostics-data";
import { usePianoSession } from "@/hooks/use-piano-session";
import { mergeLivePianoStatus } from "@/lib/live-diagnostics";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PianoStatusCard } from "@/components/admin/diagnostics/piano-status-card";
import { DeviceActionsCard } from "@/components/admin/diagnostics/device-actions-card";
import { CommandHistoryCard } from "@/components/admin/diagnostics/command-history-card";
import { SessionHistoryCard } from "@/components/admin/diagnostics/session-history-card";

export const DiagnosticsPanel = () => {
  const { t } = useLocale();
  const { data, loading, failed, refresh } = useDiagnosticsData();
  const { status } = usePianoSession();

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">{failed ? t("diagnostics.loadFailed") : null}</p>
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCwIcon className="size-4" />
          {t("diagnostics.refresh")}
        </Button>
      </div>
    );
  }

  const piano = mergeLivePianoStatus(data.piano, status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          <RefreshCwIcon className={loading ? "size-4 animate-spin" : "size-4"} />
          {t("diagnostics.refresh")}
        </Button>
      </div>
      <PianoStatusCard piano={piano} durablePiano={data.piano} liveStatus={status} />
      <DeviceActionsCard piano={piano} onActionCompleted={() => void refresh()} />
      <div className="grid gap-4 lg:grid-cols-2">
        <CommandHistoryCard commands={data.recentCommands} />
        <SessionHistoryCard sessions={data.recentSessions} />
      </div>
    </div>
  );
};
