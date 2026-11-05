import { describe, expect, it } from "vitest";
import { enforceReportedProfile, profileMismatchMessage, profilesMatch } from "./profile-compatibility";

describe("profile compatibility", () => {
  const configured = { id: "legacy-v1", version: 2 };

  it("requires both profile id and version to match", () => {
    expect(profilesMatch(configured, { id: "legacy-v1", version: 2 })).toBe(true);
    expect(profilesMatch(configured, { id: "legacy-v1", version: 1 })).toBe(false);
    expect(profilesMatch(configured, { id: "other", version: 2 })).toBe(false);
    expect(profilesMatch(configured, { id: "legacy-v1", version: undefined })).toBe(false);
  });

  it("produces an actionable mismatch diagnostic", () => {
    expect(profileMismatchMessage(configured, { id: "legacy-v1", version: undefined }))
      .toContain("legacy-v1@unknown");
  });

  it("quarantines a live report from an incompatible firmware profile", () => {
    const reported = {
      pianoId: "00000000-0000-4000-8000-000000000001",
      state: "idle" as const,
      online: true,
      positionMs: 0,
      durationMs: 0,
      firmwareVersion: "test",
      profileId: "legacy-v1",
      profileVersion: 1,
      lastAppliedRevision: 0,
      lastHandledRevision: 0,
      reportedAt: "2026-01-01T00:00:00Z",
    };
    expect(enforceReportedProfile(configured, reported)).toMatchObject({
      state: "error",
      error: { code: "profile_mismatch" },
    });
  });
});
