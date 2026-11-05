import { describe, expect, it } from "vitest";
import type { ReportedState } from "@spp/contracts";
import { uncertainCommandResolved, type UncertainCommand } from "./recovery-session";

const command: UncertainCommand = {
  sessionId: "00000000-0000-0000-0000-000000000010",
  revision: 5,
};

const status = (overrides: Partial<ReportedState> = {}): ReportedState => ({
  pianoId: "00000000-0000-0000-0000-000000000001",
  state: "idle",
  online: true,
  positionMs: 0,
  durationMs: 0,
  firmwareVersion: "test",
  profileId: "legacy-v1",
  profileVersion: 2,
  lastAppliedRevision: 4,
  lastHandledRevision: 4,
  reportedAt: new Date().toISOString(),
  ...overrides,
});

describe("uncertainCommandResolved", () => {
  it("keeps recovery controls while the device has not handled the revision", () => {
    expect(uncertainCommandResolved(command, status({
      sessionId: command.sessionId,
      sessionOutcome: "completed",
    }))).toBe(false);
  });

  it("clears recovery after the matching session is accepted", () => {
    expect(uncertainCommandResolved(command, status({
      state: "playing",
      sessionId: command.sessionId,
      lastAppliedRevision: 5,
      lastHandledRevision: 5,
    }))).toBe(true);
  });

  it("clears recovery after the command is rejected", () => {
    expect(uncertainCommandResolved(command, status({
      lastHandledRevision: 5,
      acknowledgement: {
        commandId: "00000000-0000-0000-0000-000000000020",
        revision: 5,
        result: "rejected",
      },
    }))).toBe(true);
  });

  it("clears recovery when a later report supersedes the uncertain command", () => {
    expect(uncertainCommandResolved(command, status({
      lastHandledRevision: 6,
      sessionOutcome: "stopped",
    }))).toBe(true);
  });
});
