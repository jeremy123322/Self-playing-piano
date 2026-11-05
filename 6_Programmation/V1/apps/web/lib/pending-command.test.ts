import { describe, expect, it } from "vitest";
import type { ReportedState } from "@spp/contracts";
import { pendingCommandOutcome, type PendingCommand } from "./pending-command";

const command: PendingCommand = { type: "pause", revision: 4 };
const status = (overrides: Partial<ReportedState> = {}): ReportedState => ({
  pianoId: "00000000-0000-0000-0000-000000000001",
  state: "playing",
  online: true,
  positionMs: 100,
  durationMs: 1_000,
  firmwareVersion: "test",
  profileId: "legacy-v1",
  profileVersion: 2,
  lastAppliedRevision: 3,
  lastHandledRevision: 3,
  statusDelivery: { state: "healthy", pendingReports: 0 },
  reportedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("pending command feedback", () => {
  it("waits for both a server revision and device handling", () => {
    expect(pendingCommandOutcome({ type: "pause", revision: undefined }, status())).toBe("pending");
    expect(pendingCommandOutcome(command, status())).toBe("pending");
  });

  it("waits until the handled revision is also durable", () => {
    expect(pendingCommandOutcome(command, status({
      lastHandledRevision: 4,
      statusDelivery: { state: "healthy", pendingReports: 1 },
    }))).toBe("pending");
  });

  it("resolves when the device handles the revision and drains durable delivery", () => {
    expect(pendingCommandOutcome(command, status({ lastHandledRevision: 4 }))).toBe("accepted");
  });

  it("preserves an explicit device rejection", () => {
    expect(pendingCommandOutcome(command, status({
      lastHandledRevision: 4,
      acknowledgement: {
        commandId: "00000000-0000-0000-0000-000000000002",
        revision: 4,
        result: "rejected",
      },
    }))).toBe("rejected");
  });
});
