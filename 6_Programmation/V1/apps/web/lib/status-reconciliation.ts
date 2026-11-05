import type { SessionOutcome } from "@spp/contracts";

interface StoredPiano {
  activeSessionId: string | null;
  commandRevision: number;
  lastHandledRevision: number;
}

interface ReconciliationReport {
  state: string;
  lastHandledRevision: number;
  sessionId?: string | undefined;
  sessionOutcome?: SessionOutcome | undefined;
}

export const planStatusReconciliation = (piano: StoredPiano, reported: ReconciliationReport) => {
  const currentOrNewer = reported.lastHandledRevision >= piano.lastHandledRevision;
  const activeSessionMatches = Boolean(piano.activeSessionId && reported.sessionId === piano.activeSessionId);
  const mayRecoverOrphanedSession = Boolean(
    piano.activeSessionId &&
    reported.state === "idle" &&
    !reported.sessionId &&
    reported.lastHandledRevision >= piano.commandRevision,
  );
  return {
    currentOrNewer,
    activeSessionMatches,
    mayRecoverOrphanedSession,
    mayApplyRuntime: currentOrNewer && (!piano.activeSessionId || activeSessionMatches || mayRecoverOrphanedSession),
    mayFinishSession: activeSessionMatches && Boolean(reported.sessionOutcome),
    mayClearActiveSession: activeSessionMatches && Boolean(reported.sessionOutcome) && reported.sessionOutcome !== "failed",
  };
};
