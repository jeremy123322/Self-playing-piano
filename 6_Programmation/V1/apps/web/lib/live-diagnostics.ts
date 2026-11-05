import type { ReportedState } from "@spp/contracts";
import type { DiagnosticsPiano } from "@/lib/diagnostics-types";

const activeStates = new Set(["preparing", "ready", "playing", "paused", "stopping", "error"]);

export const mergeLivePianoStatus = (stored: DiagnosticsPiano, live: ReportedState): DiagnosticsPiano => {
  if (live.pianoId !== stored.id) return stored;

  const state = live.online ? live.state : "offline";
  return {
    ...stored,
    state,
    online: live.online,
    firmwareVersion: live.firmwareVersion,
    profileId: live.profileId,
    profileVersion: live.profileVersion,
    positionMs: live.positionMs,
    durationMs: live.durationMs,
    activeSessionId: live.sessionId && activeStates.has(state) ? live.sessionId : null,
    lastAppliedRevision: live.lastAppliedRevision,
    lastHandledRevision: live.lastHandledRevision,
    lastSeenAt: live.reportedAt,
    errorCode: live.error?.code ?? null,
    errorMessage: live.error?.message ?? null,
    updatedAt: live.reportedAt,
  };
};

export type SynchronizationState = "synchronized" | "syncing" | "backpressure" | "unavailable";

export const pianoSynchronization = (stored: DiagnosticsPiano, live: ReportedState) => {
  if (live.pianoId !== stored.id || !live.online) {
    return { state: "unavailable" as const, pendingReports: 0 };
  }
  const pendingReports = Math.max(
    live.statusDelivery?.pendingReports ?? 0,
    live.lastHandledRevision - stored.lastHandledRevision,
    stored.commandRevision - live.lastHandledRevision,
    0,
  );
  if (live.statusDelivery?.state === "backpressure") {
    return { state: "backpressure" as const, pendingReports };
  }
  const liveActiveSessionId = activeStates.has(live.state) ? live.sessionId : undefined;
  const runtimeMatches = stored.state === live.state &&
    (stored.activeSessionId ?? undefined) === liveActiveSessionId;
  const synchronized = live.statusDelivery?.state !== "retrying" &&
    pendingReports === 0 && runtimeMatches;
  return {
    state: synchronized ? "synchronized" as const : "syncing" as const,
    pendingReports,
  };
};
