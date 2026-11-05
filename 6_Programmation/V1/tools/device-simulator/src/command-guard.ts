export type CommandGuardResult = "duplicate" | "expired" | "new";

export const guardCommand = (
  lastHandledRevision: number,
  revision: number,
  expiresAtEpochSeconds: number,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): CommandGuardResult => {
  if (revision <= lastHandledRevision) return "duplicate";
  if (!Number.isInteger(expiresAtEpochSeconds) || expiresAtEpochSeconds <= nowEpochSeconds) return "expired";
  return "new";
};

export const completedPosition = (durationMs: number) => Math.max(0, durationMs);
