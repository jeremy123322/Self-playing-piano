import type { PianoState } from "@spp/contracts";

interface PlaybackTimingStatus {
  state: PianoState;
  sessionId?: string;
  positionMs: number;
  durationMs: number;
  lastAppliedRevision: number;
  reportedAt: string;
}

export interface PlaybackClock {
  state: PianoState;
  sessionId: string | undefined;
  positionMs: number;
  durationMs: number;
  lastAppliedRevision: number;
  anchoredAtMs: number;
  sourceReportedAt: string;
  earlySyncApplied: boolean;
}

export const playbackPositionAt = (clock: PlaybackClock, nowMs: number) => {
  const position = clock.positionMs +
    (clock.state === "playing" ? Math.max(0, nowMs - clock.anchoredAtMs) : 0);
  return Math.min(clock.durationMs || Number.MAX_SAFE_INTEGER, Math.max(0, position));
};

export const rebasePlaybackClock = (
  previous: PlaybackClock | undefined,
  status: PlaybackTimingStatus,
  nowMs: number,
): PlaybackClock => {
  const continuousPlayback = previous?.state === "playing" &&
    status.state === "playing" &&
    previous.sessionId === status.sessionId &&
    previous.lastAppliedRevision === status.lastAppliedRevision;
  if (continuousPlayback) {
    const newDeviceSample = previous.sourceReportedAt !== status.reportedAt ||
      previous.positionMs !== status.positionMs;
    if (!previous.earlySyncApplied && newDeviceSample) {
      return {
        state: status.state,
        sessionId: status.sessionId,
        positionMs: status.positionMs,
        durationMs: status.durationMs || previous.durationMs,
        lastAppliedRevision: status.lastAppliedRevision,
        anchoredAtMs: nowMs,
        sourceReportedAt: status.reportedAt,
        earlySyncApplied: true,
      };
    }
    return {
      ...previous,
      durationMs: status.durationMs || previous.durationMs,
    };
  }

  return {
    state: status.state,
    sessionId: status.sessionId,
    positionMs: status.positionMs,
    durationMs: status.durationMs,
    lastAppliedRevision: status.lastAppliedRevision,
    anchoredAtMs: nowMs,
    sourceReportedAt: status.reportedAt,
    earlySyncApplied: false,
  };
};
