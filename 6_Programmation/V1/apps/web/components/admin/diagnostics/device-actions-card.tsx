"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/hooks/use-locale";
import { DEVICE_ACTIONS, type DeviceActionDefinition } from "@/lib/device-actions";
import type { DiagnosticsPiano } from "@/lib/diagnostics-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DeviceActionsCardProps {
  piano: DiagnosticsPiano;
  onActionCompleted: () => void;
}

interface CommandApiResponse {
  error?: string;
  delivery?: "confirmed" | "uncertain";
}

const sendDeviceCommand = async (pianoId: string, action: DeviceActionDefinition): Promise<CommandApiResponse> => {
  const response = await fetch(`/api/pianos/${pianoId}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: action.type }),
  });
  const payload = ((await response.json().catch(() => null)) as CommandApiResponse | null) ?? {};
  if (!response.ok) throw new Error(payload.error ?? "Action failed");
  return payload;
};

export const DeviceActionsCard = ({ piano, onActionCompleted }: DeviceActionsCardProps) => {
  const { t } = useLocale();
  const [pendingAction, setPendingAction] = useState<DeviceActionDefinition>();
  const [runningType, setRunningType] = useState<string>();

  const runAction = async (action: DeviceActionDefinition) => {
    setPendingAction(undefined);
    setRunningType(action.type);
    try {
      const result = await sendDeviceCommand(piano.id, action);
      if (result.delivery === "uncertain") toast.warning(t("diagnostics.actions.uncertain"));
      else toast.success(t("diagnostics.actions.sent"));
      onActionCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("diagnostics.actions.failed"));
    } finally {
      setRunningType(undefined);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("diagnostics.actions.title")}</CardTitle>
        <CardDescription>{t("diagnostics.actions.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {DEVICE_ACTIONS.map((action) => (
          <DeviceActionRow
            key={action.type}
            action={action}
            available={action.isAvailable(piano)}
            running={runningType === action.type}
            onRequestRun={() => setPendingAction(action)}
          />
        ))}
      </CardContent>

      <AlertDialog open={Boolean(pendingAction)} onOpenChange={(open) => !open && setPendingAction(undefined)}>
        <AlertDialogContent>
          {pendingAction && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t(pendingAction.confirmTitleKey)}</AlertDialogTitle>
                <AlertDialogDescription>{t(pendingAction.confirmDescriptionKey)}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("diagnostics.actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void runAction(pendingAction)}>
                  {t(pendingAction.confirmActionKey)}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

interface DeviceActionRowProps {
  action: DeviceActionDefinition;
  available: boolean;
  running: boolean;
  onRequestRun: () => void;
}

const DeviceActionRow = ({ action, available, running, onRequestRun }: DeviceActionRowProps) => {
  const { t } = useLocale();
  const Icon = action.icon;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{t(action.labelKey)}</p>
        <p className="text-sm text-muted-foreground">{t(action.descriptionKey)}</p>
        {!available && <p className="mt-1 text-xs text-warning">{t("diagnostics.actions.requiresIdle")}</p>}
      </div>
      <Button variant="outline" className="shrink-0" disabled={!available || running} onClick={onRequestRun}>
        <Icon className={running ? "size-4 animate-pulse" : "size-4"} />
        {t("diagnostics.actions.run")}
      </Button>
    </div>
  );
};
