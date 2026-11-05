export const PIANO_MIDI_START = 21;
export const PIANO_KEY_COUNT = 88;
export const ARTIFACT_MAGIC = "SPP1";
export const ARTIFACT_VERSION = 2;
export const ARTIFACT_HEADER_SIZE = 16;
export const ARTIFACT_RECORD_SIZE = 12;
export const MAX_ARTIFACT_BYTES = 128 * 1024;
export const MAX_TIMELINE_MS = 0x7fff_ffff;
export const MAX_COMMAND_REVISION = 0xffff_ffff;

export const pianoStates = [
  "booting",
  "provisioning",
  "connecting",
  "idle",
  "preparing",
  "ready",
  "playing",
  "paused",
  "stopping",
  "error",
  "offline",
] as const;

export type PianoState = (typeof pianoStates)[number];

export const commandTypes = [
  "play",
  "pause",
  "resume",
  "restart",
  "stop",
  "emergency_recover",
  "restart_controller",
  "enter_provisioning",
] as const;
export type CommandType = (typeof commandTypes)[number];

export interface PianoProfile {
  id: string;
  version: number;
  name: string;
  midiStart: number;
  keyCount: number;
  maxPolyphony: number;
  retriggerGapMs: number;
  leadInMs: number;
  activationLeadMs: number;
  keyMap: readonly number[];
}

export const LEGACY_V1_KEY_MAP: readonly number[] = Object.freeze([
  ...Array.from({ length: 73 }, (_, index) => index + 8),
  ...Array.from({ length: 14 }, (_, index) => index + 82),
  -1,
]);

export const LEGACY_V1_PROFILE: PianoProfile = {
  id: "legacy-v1",
  version: 2,
  name: "Legacy six-board wiring",
  midiStart: PIANO_MIDI_START,
  keyCount: PIANO_KEY_COUNT,
  maxPolyphony: 10,
  retriggerGapMs: 100,
  leadInMs: 5_000,
  activationLeadMs: 20,
  keyMap: LEGACY_V1_KEY_MAP,
};

export const artifactProfileCompatible = (
  artifactVersion: number,
  profileVersion: number,
  currentProfileVersion = LEGACY_V1_PROFILE.version,
) => (artifactVersion === 1 && profileVersion === 1) ||
  (artifactVersion === ARTIFACT_VERSION && profileVersion === currentProfileVersion);

export interface ArtifactNote {
  startMs: number;
  durationMs: number;
  keyIndex: number;
  velocity: number;
  flags: number;
  activationLeadMs: number;
}

export interface ArtifactDocument {
  version: number;
  profileVersion: number;
  durationMs: number;
  notes: ArtifactNote[];
}

export interface DesiredCommand {
  commandId: string;
  revision: number;
  sessionId: string;
  type: CommandType;
  pianoId: string;
  issuedAtEpochSeconds: number;
  songId?: string;
  artifactId?: string;
  artifactSha256?: string;
  artifactBytes?: number;
  artifactVersion?: number;
  profileId?: string;
  profileVersion?: number;
  expiresAt: string;
  expiresAtEpochSeconds: number;
}

export interface ReportedError {
  code: string;
  message: string;
}

export const commandResults = ["accepted", "rejected"] as const;
export type CommandResult = (typeof commandResults)[number];

export const sessionOutcomes = ["completed", "stopped", "failed"] as const;
export type SessionOutcome = (typeof sessionOutcomes)[number];

export interface CommandAcknowledgement {
  commandId: string;
  revision: number;
  result: CommandResult;
  error?: ReportedError;
}

export interface ReportedState {
  pianoId: string;
  state: PianoState;
  online: boolean;
  sessionId?: string;
  songId?: string;
  positionMs: number;
  durationMs: number;
  firmwareVersion: string;
  profileId: string;
  profileVersion: number;
  lastAppliedRevision: number;
  lastHandledRevision: number;
  acknowledgement?: CommandAcknowledgement;
  sessionOutcome?: SessionOutcome;
  reportedAt: string;
  error?: ReportedError;
  statusDelivery?: {
    state: "healthy" | "retrying" | "backpressure";
    pendingReports: number;
  };
}

export interface SongSummary {
  id: string;
  title: string;
  artist: string | null;
  durationMs: number;
  noteCount: number;
  warnings: string[];
  status: "processing" | "ready" | "invalid";
  createdAt: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedInteger = (value: unknown, maximum: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;

const isOptionalString = (value: unknown) => value === undefined || typeof value === "string";

export const parseDesiredCommand = (value: unknown): DesiredCommand | undefined => {
  if (!isRecord(value) || !commandTypes.includes(value.type as CommandType)) return undefined;
  if (typeof value.commandId !== "string" || !uuidPattern.test(value.commandId)) return undefined;
  if (typeof value.sessionId !== "string" || !uuidPattern.test(value.sessionId)) return undefined;
  if (typeof value.pianoId !== "string" || !uuidPattern.test(value.pianoId)) return undefined;
  if (!isBoundedInteger(value.revision, MAX_COMMAND_REVISION) || value.revision === 0) return undefined;
  if (!isBoundedInteger(value.issuedAtEpochSeconds, MAX_COMMAND_REVISION)) return undefined;
  if (!isBoundedInteger(value.expiresAtEpochSeconds, MAX_COMMAND_REVISION)) return undefined;
  if (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) return undefined;
  if (!isOptionalString(value.songId) || !isOptionalString(value.artifactId) ||
      !isOptionalString(value.artifactSha256) || !isOptionalString(value.profileId)) return undefined;

  if (value.type === "play") {
    if (typeof value.songId !== "string" || !uuidPattern.test(value.songId)) return undefined;
    if (typeof value.artifactId !== "string" || !uuidPattern.test(value.artifactId)) return undefined;
    if (typeof value.artifactSha256 !== "string" || !sha256Pattern.test(value.artifactSha256)) return undefined;
    if (!isBoundedInteger(value.artifactBytes, MAX_ARTIFACT_BYTES) || value.artifactBytes === 0) return undefined;
    if (!isBoundedInteger(value.artifactVersion, 0xff) || value.artifactVersion === 0) return undefined;
    if (typeof value.profileId !== "string" || value.profileId.length === 0 || value.profileId.length > 100) return undefined;
    if (!isBoundedInteger(value.profileVersion, 0xff) || value.profileVersion === 0) return undefined;
  }

  return value as unknown as DesiredCommand;
};

export const isReportedState = (value: unknown): value is ReportedState => {
  if (!isRecord(value) || !pianoStates.includes(value.state as PianoState)) return false;
  if (typeof value.pianoId !== "string" || !uuidPattern.test(value.pianoId)) return false;
  if (typeof value.online !== "boolean" || typeof value.firmwareVersion !== "string") return false;
  if (typeof value.profileId !== "string" || value.profileId.length === 0 || value.profileId.length > 100) return false;
  if (!isBoundedInteger(value.profileVersion, 0xff)) return false;
  if (!isBoundedInteger(value.positionMs, MAX_TIMELINE_MS) ||
      !isBoundedInteger(value.durationMs, MAX_TIMELINE_MS)) return false;
  if (!isBoundedInteger(value.lastAppliedRevision, MAX_COMMAND_REVISION) ||
      !isBoundedInteger(value.lastHandledRevision, MAX_COMMAND_REVISION)) return false;
  if (typeof value.reportedAt !== "string" || !Number.isFinite(Date.parse(value.reportedAt))) return false;
  if (value.sessionId !== undefined &&
      (typeof value.sessionId !== "string" || !uuidPattern.test(value.sessionId))) return false;
  if (value.songId !== undefined &&
      (typeof value.songId !== "string" || !uuidPattern.test(value.songId))) return false;
  if (value.sessionOutcome !== undefined &&
      !sessionOutcomes.includes(value.sessionOutcome as SessionOutcome)) return false;
  if (value.error !== undefined) {
    if (!isRecord(value.error) || typeof value.error.code !== "string" ||
        typeof value.error.message !== "string") return false;
  }
  if (value.acknowledgement !== undefined) {
    if (!isRecord(value.acknowledgement) ||
        typeof value.acknowledgement.commandId !== "string" ||
        !uuidPattern.test(value.acknowledgement.commandId) ||
        !isBoundedInteger(value.acknowledgement.revision, MAX_COMMAND_REVISION) ||
        value.acknowledgement.revision === 0 ||
        !commandResults.includes(value.acknowledgement.result as CommandResult)) return false;
  }
  if (value.statusDelivery !== undefined) {
    if (!isRecord(value.statusDelivery) ||
        !["healthy", "retrying", "backpressure"].includes(String(value.statusDelivery.state)) ||
        !isBoundedInteger(value.statusDelivery.pendingReports, 0xffff)) return false;
  }
  return true;
};
