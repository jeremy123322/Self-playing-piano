import { describe, expect, it } from "vitest";
import type { ReportedState } from "@spp/contracts";
import { reconcileRealtimeStatus } from "./realtime-status";

const status = (overrides: Partial<ReportedState> = {}): ReportedState => ({
  pianoId: "00000000-0000-0000-0000-000000000001",
  state: "idle",
  online: true,
  positionMs: 0,
  durationMs: 0,
  firmwareVersion: "test",
  profileId: "legacy-v1",
  profileVersion: 2,
  lastAppliedRevision: 1,
  lastHandledRevision: 1,
  reportedAt: new Date().toISOString(),
  ...overrides,
});

describe("reconcileRealtimeStatus", () => {
  it("does not hide a cloud-reserved session behind a stale device heartbeat", () => {
    const current = status({ state: "preparing", sessionId: "00000000-0000-0000-0000-000000000010" });
    expect(reconcileRealtimeStatus(current, status()).sessionId).toBe(current.sessionId);
  });

  it("accepts a matching device session", () => {
    const sessionId = "00000000-0000-0000-0000-000000000010";
    expect(reconcileRealtimeStatus(status({ state: "preparing", sessionId }), status({ state: "playing", sessionId })).state).toBe("playing");
  });

  it("accepts an explicit newer rejection", () => {
    const current = status({ state: "preparing", sessionId: "00000000-0000-0000-0000-000000000010" });
    const incoming = status({ lastHandledRevision: 2, acknowledgement: { commandId: "00000000-0000-0000-0000-000000000020", revision: 2, result: "rejected" } });
    expect(reconcileRealtimeStatus(current, incoming).state).toBe("idle");
  });

  it("does not regress to an older revision or timestamp", () => {
    const current = status({
      state: "playing",
      positionMs: 500,
      lastAppliedRevision: 3,
      lastHandledRevision: 3,
      reportedAt: "2026-01-01T00:00:10Z",
    });
    expect(reconcileRealtimeStatus(current, status({
      state: "preparing",
      lastAppliedRevision: 2,
      lastHandledRevision: 2,
      reportedAt: "2026-01-01T00:00:11Z",
    }))).toBe(current);
    expect(reconcileRealtimeStatus(current, status({
      state: "preparing",
      lastAppliedRevision: 3,
      lastHandledRevision: 3,
      reportedAt: "2026-01-01T00:00:09Z",
    }))).toBe(current);
  });

  it("ignores a status for another piano", () => {
    const current = status();
    expect(reconcileRealtimeStatus(current, status({
      pianoId: "00000000-0000-4000-8000-000000000099",
      lastHandledRevision: 2,
    }))).toBe(current);
  });
});
