"use client";

import { Loader2Icon, LockIcon, PauseIcon, PlayIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import type { CommandType, PianoState, SongSummary } from "@spp/contracts";
import type { ViewerRole } from "@/lib/authorization";
import type { MessageKey } from "@/lib/i18n/messages";
import { usePianoSession } from "@/hooks/use-piano-session";
import { usePlaybackPosition } from "@/hooks/use-playback-position";
import { useLocale } from "@/hooks/use-locale";
import { formatDuration } from "@/lib/format";
import { STATE_LABEL_KEY } from "@/lib/piano-state-display";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PianoRollFrame } from "@/components/piano-roll-frame";

type PianoControlPanelVariant = "compact" | "fullscreen";

interface PianoControlPanelProps {
  songs: SongSummary[];
  viewerRole: ViewerRole;
  variant?: PianoControlPanelVariant;
  className?: string;
}

const rollHeightClass = (variant: PianoControlPanelVariant) => (variant === "fullscreen" ? "min-h-0 flex-1" : "h-56 sm:h-64");

/**
 * The headline above the song title must reflect what the piano is actually doing, not just
 * whichever song happens to be selected in the library. Only fall back to the friendly
 * "ready when you are" copy while the piano is genuinely idle with nothing in progress -
 * any other state (busy, offline, booting, or erroring with no session) gets its real label.
 */
const panelHeadlineKey = (busy: boolean, state: PianoState) => (!busy && state === "idle" ? "panel.readyWhenYouAre" : STATE_LABEL_KEY[state]);

export const PianoControlPanel = ({ songs, viewerRole, variant = "compact", className }: PianoControlPanelProps) => {
  const {
    status,
    notes,
    notesLoading,
    selectedSongId,
    effectiveSongId,
    busy,
    commandPending,
    pendingCommandType,
    message,
    loginRequired,
    recoverySessionId,
    sendCommand,
  } = usePianoSession();
  const playbackPosition = usePlaybackPosition(status);
  const { t } = useLocale();

  const activeSong = songs.find((song) => song.id === effectiveSongId);
  const isAuthorized = viewerRole === "controller" || viewerRole === "admin";
  const displayPosition = busy ? playbackPosition : 0;
  const totalDurationMs = busy ? status.durationMs || activeSong?.durationMs || 0 : activeSong?.durationMs || 0;
  const isFullscreen = variant === "fullscreen";
  const visibleNotes = activeSong ? notes : [];

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t(panelHeadlineKey(busy, status.state))}
        </p>
        <h2 className={cn("truncate font-semibold", isFullscreen ? "text-3xl sm:text-4xl" : "text-lg")}>
          {activeSong?.title ?? t("panel.chooseSong")}
        </h2>
        {activeSong?.artist && <p className="truncate text-sm text-muted-foreground">{activeSong.artist}</p>}
      </div>

      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground tabular-nums">
        <span>{formatDuration(displayPosition)}</span>
        <span>{formatDuration(totalDurationMs)}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full origin-left rounded-full bg-primary transition-none will-change-transform"
          style={{ transform: `scaleX(${totalDurationMs ? Math.min(1, displayPosition / totalDurationMs) : 0})` }}
        />
      </div>

      <div className={cn("overflow-hidden rounded-lg", rollHeightClass(variant))}>
        <PianoRollFrame
          notes={visibleNotes}
          positionMs={displayPosition}
          playing={status.state === "playing"}
          loading={Boolean(activeSong) && notesLoading}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!isAuthorized ? (
          <TransportLocked />
        ) : (
          <TransportControls
            busy={busy}
            state={status.state}
            selectedSongId={selectedSongId}
            online={status.online}
            commandPending={commandPending}
            pendingCommandType={pendingCommandType}
            recoverySessionId={recoverySessionId}
            sendCommand={sendCommand}
            isFullscreen={isFullscreen}
          />
        )}
      </div>

      {pendingCommandType && (
        <span className="sr-only" role="status" aria-live="polite">
          {t(pendingCommandLabel(pendingCommandType))}
        </span>
      )}

      {(message || loginRequired) && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {message}
          {loginRequired && (
            <>
              {" "}
              <a href="/login" className="underline">
                {t("session.signIn")}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
};

const TransportLocked = () => {
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
      <LockIcon className="size-4" />
      <span>{t("panel.locked")}</span>
      <a href="/login" className="font-medium text-primary underline">
        {t("header.enterAccessCode")}
      </a>
    </div>
  );
};

interface TransportControlsProps {
  busy: boolean;
  state: string;
  selectedSongId: string | undefined;
  online: boolean;
  commandPending: boolean;
  pendingCommandType: CommandType | undefined;
  recoverySessionId: string | undefined;
  sendCommand: (type: "play" | "pause" | "resume" | "restart" | "stop") => Promise<void>;
  isFullscreen?: boolean | undefined;
}

interface TransportButtonProps {
  labelKey: MessageKey;
  tooltipKey?:
    | "transport.tooltip.play"
    | "transport.tooltip.pause"
    | "transport.tooltip.resume"
    | "transport.tooltip.restart"
    | "transport.tooltip.stop"
    | "transport.tooltip.acknowledgeError";
  icon: React.ReactNode;
  variant?: "default" | "outline";
  size: "default" | "lg";
  disabled: boolean;
  loading?: boolean;
  onClick: () => void;
}

const TransportButton = ({ labelKey, tooltipKey, icon, variant = "default", size, disabled, loading = false, onClick }: TransportButtonProps) => {
  const { t } = useLocale();
  const button = (
    <Button variant={variant} size={size} disabled={disabled} aria-busy={loading} onClick={onClick}>
      {loading ? <Loader2Icon className="size-4 animate-spin" /> : icon}
      {t(labelKey)}
    </Button>
  );
  if (!tooltipKey) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{t(tooltipKey)}</TooltipContent>
    </Tooltip>
  );
};

const TransportControls = ({
  busy,
  state,
  selectedSongId,
  online,
  commandPending,
  pendingCommandType,
  recoverySessionId,
  sendCommand,
  isFullscreen,
}: TransportControlsProps) => {
  const buttonSize = isFullscreen ? "lg" : "default";

  if (!busy && recoverySessionId) {
    return (
      <TransportButton
        labelKey="transport.cancelUncertain"
        icon={<SquareIcon className="size-4" />}
        variant="outline"
        size={buttonSize}
        disabled={commandPending}
        loading={pendingCommandType === "stop"}
        onClick={() => void sendCommand("stop")}
      />
    );
  }

  return (
    <>
      {!busy && (
        <TransportButton
          labelKey="transport.play"
          tooltipKey="transport.tooltip.play"
          icon={<PlayIcon className="size-4" />}
          size={buttonSize}
          disabled={!selectedSongId || !online || state !== "idle" || commandPending}
          loading={pendingCommandType === "play"}
          onClick={() => void sendCommand("play")}
        />
      )}
      {state === "playing" && (
        <TransportButton
          labelKey="transport.pause"
          tooltipKey="transport.tooltip.pause"
          icon={<PauseIcon className="size-4" />}
          variant="outline"
          size={buttonSize}
          disabled={commandPending}
          loading={pendingCommandType === "pause"}
          onClick={() => void sendCommand("pause")}
        />
      )}
      {state === "paused" && (
        <TransportButton
          labelKey="transport.resume"
          tooltipKey="transport.tooltip.resume"
          icon={<PlayIcon className="size-4" />}
          size={buttonSize}
          disabled={commandPending}
          loading={pendingCommandType === "resume"}
          onClick={() => void sendCommand("resume")}
        />
      )}
      {busy && state !== "error" && (
        <TransportButton
          labelKey="transport.restart"
          tooltipKey="transport.tooltip.restart"
          icon={<RotateCcwIcon className="size-4" />}
          variant="outline"
          size={buttonSize}
          disabled={commandPending}
          loading={pendingCommandType === "restart"}
          onClick={() => void sendCommand("restart")}
        />
      )}
      {busy && (
        <TransportButton
          labelKey={state === "error" ? "transport.acknowledgeError" : "transport.stop"}
          tooltipKey={state === "error" ? "transport.tooltip.acknowledgeError" : "transport.tooltip.stop"}
          icon={<SquareIcon className="size-4" />}
          variant="outline"
          size={buttonSize}
          disabled={commandPending}
          loading={pendingCommandType === "stop"}
          onClick={() => void sendCommand("stop")}
        />
      )}
    </>
  );
};

const pendingCommandLabel = (type: CommandType): MessageKey => {
  if (type === "play") return "transport.pending.play";
  if (type === "pause") return "transport.pending.pause";
  if (type === "resume") return "transport.pending.resume";
  if (type === "restart") return "transport.pending.restart";
  return "transport.pending.stop";
};
