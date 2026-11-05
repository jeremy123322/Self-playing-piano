import type { CommandType, PianoState } from "@spp/contracts";

export type CommandStatusValue = "pending" | "published" | "acknowledged" | "rejected" | "dispatch_failed" | "dispatch_uncertain";
export type SessionStateValue = "dispatching" | "preparing" | "playing" | "paused" | "completed" | "stopped" | "failed";

export interface DiagnosticsPiano {
  id: string;
  name: string;
  state: PianoState;
  online: boolean;
  firmwareVersion: string | null;
  profileId: string;
  profileVersion: number;
  positionMs: number;
  durationMs: number;
  activeSessionId: string | null;
  commandRevision: number;
  lastAppliedRevision: number;
  lastHandledRevision: number;
  lastSeenAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

export interface DiagnosticsCommand {
  id: string;
  type: CommandType;
  revision: number;
  status: CommandStatusValue;
  errorMessage: string | null;
  createdAt: string;
  publishedAt: string | null;
  acknowledgedAt: string | null;
}

export interface DiagnosticsSession {
  id: string;
  state: SessionStateValue;
  songTitle: string | null;
  positionMs: number;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  errorMessage: string | null;
}

export interface DiagnosticsResponse {
  piano: DiagnosticsPiano;
  recentCommands: DiagnosticsCommand[];
  recentSessions: DiagnosticsSession[];
}
