import { describe, expect, it } from "vitest";
import {
  artifactProfileCompatible,
  isReportedState,
  MAX_COMMAND_REVISION,
  MAX_TIMELINE_MS,
  parseDesiredCommand,
} from "./index";

const playCommand = () => ({
  commandId: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  sessionId: "00000000-0000-4000-8000-000000000002",
  type: "play",
  pianoId: "00000000-0000-4000-8000-000000000003",
  issuedAtEpochSeconds: 1_800_000_000,
  songId: "00000000-0000-4000-8000-000000000004",
  artifactId: "00000000-0000-4000-8000-000000000005",
  artifactSha256: "a".repeat(64),
  artifactBytes: 100,
  artifactVersion: 2,
  profileId: "legacy-v1",
  profileVersion: 2,
  expiresAt: "2027-01-15T08:00:30.000Z",
  expiresAtEpochSeconds: 1_800_000_030,
});

describe("runtime contracts", () => {
  it("defines the staged artifact/profile compatibility matrix", () => {
    expect(artifactProfileCompatible(1, 1)).toBe(true);
    expect(artifactProfileCompatible(2, 2)).toBe(true);
    expect(artifactProfileCompatible(1, 2)).toBe(false);
    expect(artifactProfileCompatible(2, 1)).toBe(false);
  });

  it("accepts a complete bounded Play command", () => {
    expect(parseDesiredCommand(playCommand())).toBeDefined();
  });

  it("rejects missing compatibility metadata and overflowing revisions", () => {
    expect(parseDesiredCommand({ ...playCommand(), profileVersion: undefined })).toBeUndefined();
    expect(parseDesiredCommand({ ...playCommand(), revision: MAX_COMMAND_REVISION + 1 })).toBeUndefined();
  });

  it("bounds reported state to the database timeline domain", () => {
    const report = {
      pianoId: "00000000-0000-4000-8000-000000000003",
      state: "playing",
      online: true,
      positionMs: MAX_TIMELINE_MS,
      durationMs: MAX_TIMELINE_MS,
      firmwareVersion: "test",
      profileId: "legacy-v1",
      profileVersion: 2,
      lastAppliedRevision: MAX_COMMAND_REVISION,
      lastHandledRevision: MAX_COMMAND_REVISION,
      reportedAt: "2027-01-15T08:00:00Z",
    };
    expect(isReportedState(report)).toBe(true);
    expect(isReportedState({ ...report, durationMs: MAX_TIMELINE_MS + 1 })).toBe(false);
  });
});
